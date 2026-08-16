import Phaser from 'phaser';
import { MainGameScene } from './scenes/MainGameScene.js';
import { ShipSpecification, MatchTelemetry, ScoreBreakdown, randomSeed } from '@jogo/shared';

export interface MatchCompleteData {
  finalScore: number;
  victory: boolean;
  breakdown: ScoreBreakdown;
  telemetry: MatchTelemetry;
}

export interface GameOptions {
  shipSpec?: ShipSpecification;
  isHardcore?: boolean;
  /** PRNG seed. Omitted in production → randomly drawn and recorded in telemetry. */
  seed?: number;
  onMatchComplete?: (data: MatchCompleteData) => void;
}

/**
 * Superset of `GameOptions` consumed only by the standalone dev harness
 * (Task B4, Spec 09 §4). `createGameInstance` is the single entry point for
 * both production (`App.tsx`, passing plain `GameOptions`) and the harness
 * (passing this type) — there is no separate `createDevGameInstance`.
 */
export interface DevGameOptions extends GameOptions {
  /** Starts the match at this second. 45 = boss already on screen. */
  startAtSeconds?: number;
  /** Boss enters already in this phase. Requires startAtSeconds >= BALANCE.match.boss_spawn_s. */
  startAtBossPhase?: 1 | 2 | 3;
  godMode?: boolean;
  /**
   * Segura o disparo primário desde o primeiro quadro, sem ninguém no teclado. Existe para a
   * captura de conformidade, onde o tempo de reação humano entre pular para o boss e apertar
   * `ESPAÇO` entrava inteiro no `boss_ttk_s` medido. Ver Spec 09 §5.8.
   */
  autoFirePrimary?: boolean;
  timeScale?: number;
  physicsDebug?: boolean;
  /** Called every frame with observable state. Only the harness uses this. */
  onTelemetryFrame?: (frame: DevTelemetryFrame) => void;
}

export interface DevTelemetryFrame {
  fps: number;
  elapsedSeconds: number;
  playerHp: number;
  playerShield: number;
  combo: number;
  score: number;
  bossHp: number | null;
  bossMaxHp: number | null;
  bossPhase: 1 | 2 | 3 | null;
  bossDpsInstant: number;
  bossDpsAverage: number;
  pools: { primaryBullets: number; secondaryMissiles: number; enemyBullets: number; bossBullets: number; enemies: number };
  poolCaps: { primaryBullets: number; secondaryMissiles: number; enemyBullets: number; bossBullets: number; enemies: number };
}

export function createGameInstance(container: HTMLElement | string, options: GameOptions = {}): Phaser.Game {
  const seed = options.seed ?? randomSeed();

  class CustomGameScene extends MainGameScene {
    constructor() {
      super();
      if (options.shipSpec) {
        this.shipSpec = options.shipSpec;
      }
      this.isHardcore = !!options.isHardcore;
      this.seed = seed;
      this.onMatchComplete = options.onMatchComplete;
      // Always set: harmless in production, where the extra fields are simply undefined.
      this.devOptions = options as DevGameOptions;
    }
  }

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: container,
    width: 600,
    height: 800,
    backgroundColor: '#050512',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH
    },
    physics: {
      default: 'arcade',
      arcade: {
        gravity: { x: 0, y: 0 },
        debug: false
      }
    },
    scene: [CustomGameScene]
  };

  return new Phaser.Game(config);
}
