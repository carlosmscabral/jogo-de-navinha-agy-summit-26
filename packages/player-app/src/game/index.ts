import Phaser from 'phaser';
import { MainGameScene } from './scenes/MainGameScene.js';
import { ShipSpecification } from '@jogo/shared';

export function createGameInstance(containerId: string, shipSpec?: ShipSpecification): Phaser.Game {
  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: containerId,
    width: 600,
    height: 800,
    backgroundColor: '#050512',
    physics: {
      default: 'arcade',
      arcade: {
        gravity: { x: 0, y: 0 },
        debug: false
      }
    },
    scene: [MainGameScene]
  };

  const game = new Phaser.Game(config);

  if (shipSpec) {
    game.scene.start('MainGameScene', { shipSpec });
  }

  return game;
}
