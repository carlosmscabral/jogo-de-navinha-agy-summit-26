import Phaser from 'phaser';
import { MainGameScene } from './scenes/MainGameScene.js';
import { ShipSpecification } from '@jogo/shared';

export interface MatchCompleteData {
  finalScore: number;
  victory: boolean;
  breakdown: any;
}

export interface GameInstanceOptions {
  container: HTMLElement | string;
  shipSpec?: ShipSpecification;
  isHardcore?: boolean;
  onMatchComplete?: (data: MatchCompleteData) => void;
  onSceneReady?: (scene: MainGameScene) => void;
  devMode?: boolean;
}

export function createGameInstance(
  optionsOrContainer: GameInstanceOptions | HTMLElement | string,
  legacyShipSpec?: ShipSpecification,
  legacyIsHardcore = false,
  legacyOnMatchComplete?: (data: MatchCompleteData) => void
): Phaser.Game {
  let opts: GameInstanceOptions;

  if (typeof optionsOrContainer === 'string' || optionsOrContainer instanceof HTMLElement) {
    opts = {
      container: optionsOrContainer,
      shipSpec: legacyShipSpec,
      isHardcore: legacyIsHardcore,
      onMatchComplete: legacyOnMatchComplete
    };
  } else {
    opts = optionsOrContainer;
  }

  class CustomGameScene extends MainGameScene {
    constructor() {
      super();
      if (opts.shipSpec) {
        this.shipSpec = opts.shipSpec;
      }
      this.isHardcore = !!opts.isHardcore;
      this.onMatchComplete = opts.onMatchComplete;
    }

    create(): void {
      super.create();
      if (opts.onSceneReady) {
        opts.onSceneReady(this);
      }
    }
  }

  const dpr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;

  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: opts.container,
    width: 600,
    height: 800,
    resolution: dpr,
    backgroundColor: '#050512',
    render: {
      antialias: true,
      pixelArt: false,
      roundPixels: false
    },
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
