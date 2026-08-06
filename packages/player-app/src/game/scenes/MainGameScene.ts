import Phaser from 'phaser';
import { ShipSpecification, FALLBACK_PRESETS } from '@jogo/shared';
import { PlayerShip } from '../objects/PlayerShip.js';
import { ShipTextureFactory } from '../factories/ShipTextureFactory.js';
import { ScoreCalculator } from '../scoring/ScoreCalculator.js';
import { audioManager } from '../audio/AudioManager.js';

export class MainGameScene extends Phaser.Scene {
  shipSpec: ShipSpecification = FALLBACK_PRESETS.interceptor;
  player!: PlayerShip;
  scoreCalculator = new ScoreCalculator();

  enemies!: Phaser.Physics.Arcade.Group;
  starfields: Phaser.GameObjects.TileSprite[] = [];

  hudTextScore!: Phaser.GameObjects.Text;
  hudTextHp!: Phaser.GameObjects.Text;
  hudTextCombo!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: 'MainGameScene' });
  }

  init(data: { shipSpec?: ShipSpecification }): void {
    if (data?.shipSpec) {
      this.shipSpec = data.shipSpec;
    }
  }

  create(): void {
    // 1. Create starfield background
    this.createStarfield();

    // 2. Generate dynamic texture synchronously
    const textureKey = 'player_ship_texture';
    ShipTextureFactory.createShipTexture(this, textureKey, this.shipSpec.visuals);

    // 3. Create Player Ship
    const startX = this.scale.width / 2;
    const startY = this.scale.height - 100;
    this.player = new PlayerShip(
      this,
      startX,
      startY,
      textureKey,
      this.shipSpec.attributes,
      this.shipSpec.weapons
    );

    // 4. Enemy Drone Target Pool
    this.createEnemyDrones();

    // 5. Setup Collisions
    this.setupCollisions();

    // 6. Setup HUD
    this.setupHud();

    // Unlock audio on click/key
    this.input.keyboard?.on('keydown', () => audioManager.unlockAudio());
    this.input.on('pointerdown', () => audioManager.unlockAudio());
  }

  private createStarfield(): void {
    if (!this.textures.exists('star1')) {
      const g = this.add.graphics();
      g.fillStyle(0xffffff, 0.8);
      g.fillCircle(2, 2, 1);
      g.generateTexture('star1', 4, 4);
      g.clear();

      g.fillStyle(0x00f3ff, 0.9);
      g.fillCircle(4, 4, 2);
      g.generateTexture('star2', 8, 8);
      g.destroy();
    }

    const starfield1 = this.add.tileSprite(0, 0, this.scale.width, this.scale.height, 'star1').setOrigin(0, 0);
    const starfield2 = this.add.tileSprite(0, 0, this.scale.width, this.scale.height, 'star2').setOrigin(0, 0);
    this.starfields = [starfield1, starfield2];
  }

  private createEnemyDrones(): void {
    if (!this.textures.exists('drone_tex')) {
      const g = this.add.graphics();
      g.fillStyle(0xff0055, 1);
      g.fillTriangle(16, 32, 0, 0, 32, 0);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(16, 12, 4);
      g.generateTexture('drone_tex', 32, 32);
      g.destroy();
    }

    this.enemies = this.physics.add.group({
      defaultKey: 'drone_tex',
      maxSize: 30
    });

    // Spawn waves periodically
    this.time.addEvent({
      delay: 1200,
      callback: () => this.spawnDroneWave(),
      loop: true
    });
  }

  private spawnDroneWave(): void {
    const x = Phaser.Math.Between(80, this.scale.width - 80);
    const drone = this.enemies.get(x, -30, 'drone_tex') as Phaser.Physics.Arcade.Sprite;
    if (drone) {
      drone.setActive(true);
      drone.setVisible(true);
      drone.setPosition(x, -30);
      drone.setVelocity(Phaser.Math.Between(-20, 20), Phaser.Math.Between(160, 240));
      drone.setData('hp', 30);
    }
  }

  private setupCollisions(): void {
    // Bullets vs Enemies
    this.physics.add.overlap(
      this.player.weaponSystem.primaryBullets,
      this.enemies,
      (bulletObj, enemyObj) => {
        const bullet = bulletObj as Phaser.Physics.Arcade.Sprite;
        const enemy = enemyObj as Phaser.Physics.Arcade.Sprite;
        const damage = (bullet.getData('damage') as number) || 30;

        bullet.setActive(false);
        bullet.setVisible(false);

        let hp = (enemy.getData('hp') as number) || 30;
        hp -= damage;

        if (hp <= 0) {
          enemy.setActive(false);
          enemy.setVisible(false);
          this.scoreCalculator.registerKill('drone');
          audioManager.playExplosion();
        } else {
          enemy.setData('hp', hp);
          audioManager.playHit();
        }
      }
    );

    // Player vs Enemy collision
    this.physics.add.overlap(this.player, this.enemies, (_, enemyObj) => {
      const enemy = enemyObj as Phaser.Physics.Arcade.Sprite;
      enemy.setActive(false);
      enemy.setVisible(false);

      this.player.takeDamage(1);
      this.scoreCalculator.registerDamageTaken();
      audioManager.playHit();
    });
  }

  private setupHud(): void {
    this.hudTextScore = this.add.text(20, 20, 'SCORE: 0', {
      fontFamily: '"Share Tech Mono", monospace',
      fontSize: '22px',
      color: '#00f3ff'
    });

    this.hudTextHp = this.add.text(20, 50, `HP: ${this.player.currentHp} | SHIELD: ${this.player.currentShield}`, {
      fontFamily: '"Share Tech Mono", monospace',
      fontSize: '18px',
      color: '#ffd700'
    });

    this.hudTextCombo = this.add.text(this.scale.width - 180, 20, 'COMBO: 1.0x', {
      fontFamily: '"Share Tech Mono", monospace',
      fontSize: '20px',
      color: '#ff0055'
    });
  }

  update(time: number, delta: number): void {
    // Scroll starfields
    if (this.starfields[0]) this.starfields[0].tilePositionY -= 1.5;
    if (this.starfields[1]) this.starfields[1].tilePositionY -= 3.5;

    // Update Player
    if (this.player && this.player.active) {
      this.player.update(time, delta);
    }

    // Clean off-screen enemies
    this.enemies.children.iterate((child) => {
      const e = child as Phaser.Physics.Arcade.Sprite;
      if (e && e.active && e.y > this.scale.height + 50) {
        e.setActive(false);
        e.setVisible(false);
      }
      return true;
    });

    // Update HUD
    if (this.hudTextScore) {
      this.hudTextScore.setText(`SCORE: ${this.scoreCalculator.currentScore}`);
      this.hudTextHp.setText(`HP: ${this.player.currentHp}/${this.shipSpec.attributes.max_hp}  SHIELD: ${this.player.currentShield}`);
      this.hudTextCombo.setText(`COMBO: ${this.scoreCalculator.comboMultiplier.toFixed(1)}x`);
    }
  }
}
