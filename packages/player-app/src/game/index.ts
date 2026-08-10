import Phaser from 'phaser';
import { MainGameScene } from './scenes/MainGameScene.js';
import { ShipSpecification, MatchTelemetry, ScoreBreakdown } from '@jogo/shared';

export interface MatchCompleteData {
  finalScore: number;
  victory: boolean;
  breakdown: ScoreBreakdown;
  telemetry: MatchTelemetry;
}

export function createGameInstance(
  container: HTMLElement | string,
  shipSpec?: ShipSpecification,
  isHardcore = false,
  onMatchComplete?: (data: MatchCompleteData) => void
): Phaser.Game {
  class CustomGameScene extends MainGameScene {
    constructor() {
      super();
      if (shipSpec) {
        this.shipSpec = shipSpec;
      }
      this.isHardcore = isHardcore;
      this.onMatchComplete = onMatchComplete;
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
