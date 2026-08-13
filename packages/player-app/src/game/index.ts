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
