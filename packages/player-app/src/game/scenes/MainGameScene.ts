import Phaser from 'phaser';
import { ShipSpecification, FALLBACK_PRESETS } from '@jogo/shared';
import { PlayerShip } from '../objects/PlayerShip.js';
import { ShipTextureFactory } from '../factories/ShipTextureFactory.js';
import { ScoreCalculator } from '../scoring/ScoreCalculator.js';
import { audioManager } from '../audio/AudioManager.js';

interface StarPoint {
  x: number;
  y: number;
  speed: number;
  size: number;
  alpha: number;
  color: number;
}

export class MainGameScene extends Phaser.Scene {
  shipSpec: ShipSpecification = FALLBACK_PRESETS.interceptor;
  player!: PlayerShip;
  scoreCalculator = new ScoreCalculator();
  isGameOver = false;

  enemies!: Phaser.Physics.Arcade.Group;
  stars: StarPoint[] = [];
  starfieldGraphics!: Phaser.GameObjects.Graphics;
  nebulaGraphics!: Phaser.GameObjects.Graphics;

  hudContainer!: Phaser.GameObjects.Container;
  hudTextScore!: Phaser.GameObjects.Text;
  hudTextCombo!: Phaser.GameObjects.Text;
  hudHpBars: Phaser.GameObjects.Rectangle[] = [];
  hudShieldBars: Phaser.GameObjects.Rectangle[] = [];
  gameOverContainer?: Phaser.GameObjects.Container;

  constructor() {
    super({ key: 'MainGameScene' });
  }

  init(data: { shipSpec?: ShipSpecification }): void {
    if (data?.shipSpec) {
      this.shipSpec = data.shipSpec;
    }
    this.isGameOver = false;
    this.scoreCalculator = new ScoreCalculator();
  }

  create(): void {
    // 1. Create Deep Space & Starfield
    this.createCosmicBackground();

    // 2. Generate dynamic ship & enemy textures synchronously
    const textureKey = `ship_${this.shipSpec.visuals.style_name.replace(/\s+/g, '_')}`;
    ShipTextureFactory.createShipTexture(this, textureKey, this.shipSpec.visuals);
    ShipTextureFactory.createEnemyDroneTexture(this);

    // 3. Create Player Ship
    const startX = this.scale.width / 2;
    const startY = this.scale.height - 120;
    this.player = new PlayerShip(
      this,
      startX,
      startY,
      textureKey,
      this.shipSpec.attributes,
      this.shipSpec.weapons,
      this.shipSpec.visuals
    );

    // 4. Enemy Drone Pool
    this.createEnemyDrones();

    // 5. Collisions & FX
    this.setupCollisions();

    // 6. Modern Sci-Fi HUD
    this.setupModernHud();

    // 7. Restart key (R)
    if (this.input.keyboard) {
      this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R).on('down', () => {
        if (this.isGameOver) {
          this.scene.restart({ shipSpec: this.shipSpec });
        }
      });
    }

    // Unlock audio on interaction
    this.input.keyboard?.on('keydown', () => audioManager.unlockAudio());
    this.input.on('pointerdown', () => {
      audioManager.unlockAudio();
      if (this.isGameOver) {
        this.scene.restart({ shipSpec: this.shipSpec });
      }
    });
  }

  private createCosmicBackground(): void {
    this.nebulaGraphics = this.add.graphics();
    this.nebulaGraphics.fillStyle(0x0a0520, 1);
    this.nebulaGraphics.fillRect(0, 0, this.scale.width, this.scale.height);

    const g = this.add.graphics();
    g.fillStyle(0x1a0b36, 0.4);
    g.fillCircle(this.scale.width / 2, 200, 260);
    g.fillStyle(0x002244, 0.3);
    g.fillCircle(this.scale.width / 2 - 100, 500, 220);

    this.starfieldGraphics = this.add.graphics();
    this.stars = [];
    for (let i = 0; i < 80; i++) {
      const isFast = Math.random() > 0.8;
      this.stars.push({
        x: Phaser.Math.Between(0, this.scale.width),
        y: Phaser.Math.Between(0, this.scale.height),
        speed: isFast ? Phaser.Math.FloatBetween(2.5, 4.5) : Phaser.Math.FloatBetween(0.5, 1.8),
        size: isFast ? 2 : Phaser.Math.FloatBetween(0.8, 1.5),
        alpha: Phaser.Math.FloatBetween(0.4, 1.0),
        color: Math.random() > 0.3 ? 0xffffff : 0x00f3ff
      });
    }
  }

  private createEnemyDrones(): void {
    this.enemies = this.physics.add.group({
      defaultKey: 'drone_tex',
      maxSize: 30
    });

    this.time.addEvent({
      delay: 1000,
      callback: () => {
        if (!this.isGameOver) this.spawnDroneSquad();
      },
      loop: true
    });
  }

  private spawnDroneSquad(): void {
    const x = Phaser.Math.Between(60, this.scale.width - 60);
    const drone = this.enemies.get(x, -40, 'drone_tex') as Phaser.Physics.Arcade.Sprite;
    if (drone) {
      drone.setActive(true);
      drone.setVisible(true);
      drone.setPosition(x, -40);
      drone.setScale(0.8);
      drone.setVelocity(Phaser.Math.Between(-25, 25), Phaser.Math.Between(180, 260));
      drone.setData('hp', 30);
    }
  }

  private setupCollisions(): void {
    // Bullets vs Enemies
    this.physics.add.overlap(
      this.player.weaponSystem.primaryBullets,
      this.enemies,
      (bulletObj, enemyObj) => {
        if (this.isGameOver) return;
        const bullet = bulletObj as Phaser.Physics.Arcade.Sprite;
        const enemy = enemyObj as Phaser.Physics.Arcade.Sprite;
        const damage = (bullet.getData('damage') as number) || 30;

        bullet.setActive(false);
        bullet.setVisible(false);

        let hp = (enemy.getData('hp') as number) || 30;
        hp -= damage;

        if (hp <= 0) {
          this.createExplosionFX(enemy.x, enemy.y);
          enemy.setActive(false);
          enemy.setVisible(false);
          this.scoreCalculator.registerKill('drone');
          audioManager.playExplosion();
        } else {
          enemy.setData('hp', hp);
          this.createHitSpark(bullet.x, bullet.y);
          audioManager.playHit();
        }
      }
    );

    // Player vs Enemy collision
    this.physics.add.overlap(this.player, this.enemies, (_, enemyObj) => {
      if (this.isGameOver) return;
      const enemy = enemyObj as Phaser.Physics.Arcade.Sprite;
      this.createExplosionFX(enemy.x, enemy.y);
      enemy.setActive(false);
      enemy.setVisible(false);

      const isDead = this.player.takeDamage(1);
      this.scoreCalculator.registerDamageTaken();
      audioManager.playHit();

      if (isDead) {
        this.triggerPlayerDeath();
      }
    });
  }

  private triggerPlayerDeath(): void {
    this.isGameOver = true;

    // Massive Player Explosion
    this.createExplosionFX(this.player.x, this.player.y, true);
    audioManager.playExplosion();

    this.player.setActive(false);
    this.player.setVisible(false);

    // Show Game Over Glass Overlay
    this.time.delayedCall(500, () => this.showGameOverOverlay());
  }

  private showGameOverOverlay(): void {
    const width = this.scale.width;
    const height = this.scale.height;

    this.gameOverContainer = this.add.container(0, 0);

    // Dark backdrop
    const bg = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.75);

    // Glass Card
    const card = this.add.graphics();
    card.fillStyle(0x0a0a20, 0.95);
    card.lineStyle(2, 0xff0055, 0.8);
    card.fillRoundedRect(width / 2 - 220, height / 2 - 160, 440, 320, 16);
    card.strokeRoundedRect(width / 2 - 220, height / 2 - 160, 440, 320, 16);

    const title = this.add.text(width / 2, height / 2 - 100, 'SINAL PERDIDO', {
      fontFamily: '"Share Tech Mono", monospace',
      fontSize: '32px',
      color: '#ff0055'
    }).setOrigin(0.5);

    const subtitle = this.add.text(width / 2, height / 2 - 60, 'FUSELAGEM DESTRUÍDA EM COMBATE', {
      fontFamily: '"Share Tech Mono", monospace',
      fontSize: '12px',
      color: '#ff88aa'
    }).setOrigin(0.5);

    const finalScore = this.add.text(
      width / 2,
      height / 2,
      `PONTUAÇÃO: ${this.scoreCalculator.currentScore.toLocaleString()}`,
      {
        fontFamily: '"Share Tech Mono", monospace',
        fontSize: '22px',
        color: '#00f3ff'
      }
    ).setOrigin(0.5);

    const kills = this.add.text(
      width / 2,
      height / 2 + 40,
      `ALVOS ABATIDOS: ${this.scoreCalculator.totalKills} | COMBO MÁXIMO: ${this.scoreCalculator.comboMultiplier.toFixed(1)}x`,
      {
        fontFamily: '"Share Tech Mono", monospace',
        fontSize: '13px',
        color: '#ffd700'
      }
    ).setOrigin(0.5);

    const restartPrompt = this.add.text(width / 2, height / 2 + 105, '▶ PRESSIONE [ R ] OU CLIQUE PARA REINICIAR', {
      fontFamily: '"Share Tech Mono", monospace',
      fontSize: '13px',
      color: '#ffffff'
    }).setOrigin(0.5);

    this.tweens.add({
      targets: restartPrompt,
      alpha: 0.2,
      yoyo: true,
      repeat: -1,
      duration: 500
    });

    this.gameOverContainer.add([bg, card, title, subtitle, finalScore, kills, restartPrompt]);
  }

  private createExplosionFX(x: number, y: number, isMajor = false): void {
    const ring = this.add.circle(x, y, 8, isMajor ? 0x00f3ff : 0xff0055, 0.8);
    this.tweens.add({
      targets: ring,
      radius: isMajor ? 90 : 40,
      alpha: 0,
      duration: isMajor ? 450 : 300,
      onComplete: () => ring.destroy()
    });

    const sparkCount = isMajor ? 16 : 6;
    for (let i = 0; i < sparkCount; i++) {
      const spark = this.add.circle(x, y, Phaser.Math.Between(2, 5), isMajor ? 0x00f3ff : 0xffe600, 1);
      const angle = (i / sparkCount) * Math.PI * 2;
      const dist = isMajor ? Phaser.Math.Between(40, 100) : Phaser.Math.Between(25, 50);
      this.tweens.add({
        targets: spark,
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist,
        alpha: 0,
        scale: 0.2,
        duration: isMajor ? 400 : 250,
        onComplete: () => spark.destroy()
      });
    }
  }

  private createHitSpark(x: number, y: number): void {
    const spark = this.add.circle(x, y, 3, 0x00f3ff, 1);
    this.tweens.add({
      targets: spark,
      scale: 2,
      alpha: 0,
      duration: 120,
      onComplete: () => spark.destroy()
    });
  }

  private setupModernHud(): void {
    const hudBg = this.add.graphics();
    hudBg.fillStyle(0x050515, 0.85);
    hudBg.lineStyle(1, 0x00f3ff, 0.3);
    hudBg.fillRoundedRect(16, 12, this.scale.width - 32, 60, 8);
    hudBg.strokeRoundedRect(16, 12, this.scale.width - 32, 60, 8);

    this.hudTextScore = this.add.text(32, 22, 'SCORE: 0', {
      fontFamily: '"Share Tech Mono", monospace',
      fontSize: '22px',
      color: '#00f3ff'
    });

    this.hudTextCombo = this.add.text(this.scale.width - 150, 22, '1.0x COMBO', {
      fontFamily: '"Share Tech Mono", monospace',
      fontSize: '18px',
      color: '#ff0055'
    });

    this.add.text(32, 50, 'HULL:', {
      fontFamily: '"Share Tech Mono", monospace',
      fontSize: '11px',
      color: '#88aacc'
    });

    this.hudHpBars = [];
    const maxHp = this.shipSpec.attributes.max_hp;
    for (let i = 0; i < maxHp; i++) {
      const bar = this.add.rectangle(75 + i * 18, 55, 14, 8, 0x00ff88);
      this.hudHpBars.push(bar);
    }

    this.add.text(220, 50, 'SHIELD:', {
      fontFamily: '"Share Tech Mono", monospace',
      fontSize: '11px',
      color: '#88aacc'
    });

    this.hudShieldBars = [];
    const maxShield = this.shipSpec.attributes.shield_capacity;
    for (let i = 0; i < 3; i++) {
      const bar = this.add.rectangle(275 + i * 18, 55, 14, 8, 0x00f3ff);
      bar.setVisible(i < maxShield);
      this.hudShieldBars.push(bar);
    }
  }

  update(time: number, delta: number): void {
    // Stars scroll
    this.starfieldGraphics.clear();
    for (const star of this.stars) {
      star.y += star.speed;
      if (star.y > this.scale.height) {
        star.y = -5;
        star.x = Phaser.Math.Between(0, this.scale.width);
      }
      this.starfieldGraphics.fillStyle(star.color, star.alpha);
      this.starfieldGraphics.fillCircle(star.x, star.y, star.size);
    }

    // Update Player if alive
    if (!this.isGameOver && this.player && this.player.active) {
      this.player.update(time, delta);
    }

    // Clean off-screen enemies
    this.enemies.children.iterate((child) => {
      const e = child as Phaser.Physics.Arcade.Sprite;
      if (e && e.active && e.y > this.scale.height + 60) {
        e.setActive(false);
        e.setVisible(false);
      }
      return true;
    });

    // Update HUD
    if (this.hudTextScore) {
      this.hudTextScore.setText(`SCORE: ${this.scoreCalculator.currentScore.toLocaleString()}`);
      this.hudTextCombo.setText(`${this.scoreCalculator.comboMultiplier.toFixed(1)}x COMBO`);

      for (let i = 0; i < this.hudHpBars.length; i++) {
        this.hudHpBars[i].setFillStyle(i < this.player.currentHp ? 0x00ff88 : 0x333344);
      }

      for (let i = 0; i < this.hudShieldBars.length; i++) {
        this.hudShieldBars[i].setFillStyle(i < this.player.currentShield ? 0x00f3ff : 0x223344);
      }
    }
  }
}
