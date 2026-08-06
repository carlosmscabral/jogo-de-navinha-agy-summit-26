import Phaser from 'phaser';
import { ShipSpecification, FALLBACK_PRESETS } from '@jogo/shared';
import { PlayerShip } from '../objects/PlayerShip.js';
import { BossOverlord } from '../objects/BossOverlord.js';
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
  isHardcore = false;
  player!: PlayerShip;
  boss?: BossOverlord;
  scoreCalculator = new ScoreCalculator();

  matchTimer = 90;
  elapsedSeconds = 0;
  isGameOver = false;
  isVictory = false;

  enemies!: Phaser.Physics.Arcade.Group;
  enemyBullets!: Phaser.Physics.Arcade.Group;
  stars: StarPoint[] = [];
  starfieldGraphics!: Phaser.GameObjects.Graphics;
  nebulaGraphics!: Phaser.GameObjects.Graphics;

  // HUD Elements
  hudTextScore!: Phaser.GameObjects.Text;
  hudTextTimer!: Phaser.GameObjects.Text;
  hudTextCombo!: Phaser.GameObjects.Text;
  hudHpBars: Phaser.GameObjects.Rectangle[] = [];
  hudShieldBars: Phaser.GameObjects.Rectangle[] = [];

  // Boss HUD
  bossHudContainer?: Phaser.GameObjects.Container;
  bossHpBarFill?: Phaser.GameObjects.Rectangle;
  bossPhaseText?: Phaser.GameObjects.Text;
  bossHpNumbersText?: Phaser.GameObjects.Text;

  overlayContainer?: Phaser.GameObjects.Container;

  constructor() {
    super({ key: 'MainGameScene' });
  }

  init(data: { shipSpec?: ShipSpecification; isHardcore?: boolean }): void {
    if (data?.shipSpec) {
      this.shipSpec = data.shipSpec;
    }
    this.isHardcore = !!data?.isHardcore;
    this.isGameOver = false;
    this.isVictory = false;
    this.elapsedSeconds = 0;
    this.matchTimer = 90;
    this.scoreCalculator = new ScoreCalculator();
    this.boss = undefined;
    audioManager.setBossMode(false);
  }

  create(): void {
    // 1. Cosmic Deep Space Background
    this.createCosmicBackground();

    // 2. Generate Ship & Enemy Textures
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

    // 4. Enemy and Enemy Bullet Pools
    this.enemies = this.physics.add.group({
      defaultKey: 'drone_tex',
      maxSize: 45
    });

    if (!this.textures.exists('bullet_enemy')) {
      const g = this.add.graphics();
      g.fillStyle(0xff0044, 1);
      g.fillCircle(5, 5, 5);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(5, 5, 2);
      g.generateTexture('bullet_enemy', 10, 10);
      g.destroy();
    }

    this.enemyBullets = this.physics.add.group({
      defaultKey: 'bullet_enemy',
      maxSize: 120
    });

    // 5. Collisions & Weapon Overlaps
    this.setupCollisions();

    // 6. Modern Sci-Fi HUD
    this.setupModernHud();

    // 7. Match Clock
    this.time.addEvent({
      delay: 1000,
      callback: () => this.handleMatchTick(),
      loop: true
    });

    // 8. Dynamic Enemy Wave Spawner (until boss spawns at 45s)
    this.time.addEvent({
      delay: this.isHardcore ? 550 : 750,
      callback: () => {
        if (!this.isGameOver && !this.isVictory && this.elapsedSeconds < 45) {
          this.spawnWaveEnemies();
        }
      },
      loop: true
    });

    // 9. Enemy Firing Event
    this.time.addEvent({
      delay: this.isHardcore ? 800 : 1200,
      callback: () => {
        if (!this.isGameOver && !this.isVictory && this.elapsedSeconds < 45) {
          this.triggerEnemyShots();
        }
      },
      loop: true
    });

    // Key R to restart
    if (this.input.keyboard) {
      this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R).on('down', () => {
        if (this.isGameOver || this.isVictory) {
          this.scene.restart({ shipSpec: this.shipSpec, isHardcore: this.isHardcore });
        }
      });
    }

    // Audio unlock on click / key
    this.input.keyboard?.on('keydown', () => audioManager.unlockAudio());
    this.input.on('pointerdown', () => {
      audioManager.unlockAudio();
      if (this.isGameOver || this.isVictory) {
        this.scene.restart({ shipSpec: this.shipSpec, isHardcore: this.isHardcore });
      }
    });

    audioManager.unlockAudio();
  }

  private handleMatchTick(): void {
    if (this.isGameOver || this.isVictory) return;

    this.elapsedSeconds += 1;
    this.matchTimer = Math.max(0, 90 - this.elapsedSeconds);

    // Boss appears at 45 seconds (42s warning)
    if (this.elapsedSeconds === 42) {
      this.triggerBossWarning();
    } else if (this.elapsedSeconds === 45) {
      this.spawnBoss();
    }

    if (this.matchTimer <= 0 && !this.isVictory) {
      this.triggerTimeoutEnd();
    }
  }

  private spawnWaveEnemies(): void {
    const isWave2 = this.elapsedSeconds >= 20;
    const squadType = Phaser.Math.Between(1, 3);

    if (squadType === 1) {
      // V-Formation (3 Drones)
      const centerX = Phaser.Math.Between(120, this.scale.width - 120);
      this.createSingleDrone(centerX, -30, 0, 190, 30, 'drone');
      this.createSingleDrone(centerX - 45, -60, -20, 190, 30, 'drone');
      this.createSingleDrone(centerX + 45, -60, 20, 190, 30, 'drone');
    } else if (squadType === 2 && isWave2) {
      // Elite Cruiser + Escorts
      const x = Phaser.Math.Between(100, this.scale.width - 100);
      this.createSingleDrone(x, -40, 0, 130, 140, 'cruiser');
      this.createSingleDrone(x - 50, -20, -15, 200, 30, 'drone');
      this.createSingleDrone(x + 50, -20, 15, 200, 30, 'drone');
    } else {
      // Kamikaze Fast Dive Squadron (2 Drones)
      const x1 = Phaser.Math.Between(80, this.scale.width / 2 - 20);
      const x2 = Phaser.Math.Between(this.scale.width / 2 + 20, this.scale.width - 80);
      this.createSingleDrone(x1, -30, 15, 320, 25, 'kamikaze');
      this.createSingleDrone(x2, -30, -15, 320, 25, 'kamikaze');
    }
  }

  private createSingleDrone(x: number, y: number, vx: number, vy: number, hp: number, type: string): void {
    const drone = this.enemies.get(x, y, 'drone_tex') as Phaser.Physics.Arcade.Sprite;
    if (drone) {
      drone.setActive(true);
      drone.setVisible(true);
      drone.setPosition(x, y);
      drone.setData('hp', this.isHardcore ? Math.round(hp * 1.3) : hp);
      drone.setData('type', type);

      if (type === 'cruiser') {
        drone.setScale(1.3);
        drone.setTint(0xffaa00);
      } else if (type === 'kamikaze') {
        drone.setScale(0.75);
        drone.setTint(0xff00ff);
      } else {
        drone.setScale(0.85);
        drone.clearTint();
      }

      drone.setVelocity(vx, this.isHardcore ? vy * 1.2 : vy);
    }
  }

  private triggerEnemyShots(): void {
    const pX = this.player.x;
    const pY = this.player.y;

    this.enemies.children.iterate((child) => {
      const e = child as Phaser.Physics.Arcade.Sprite;
      if (e && e.active && e.y > 20 && e.y < this.scale.height - 180) {
        const type = e.getData('type') as string;
        const angle = Phaser.Math.Angle.Between(e.x, e.y, pX, pY);
        const bulletSpeed = this.isHardcore ? 280 : 220;

        if (type === 'cruiser') {
          const spreads = [-0.25, 0, 0.25];
          for (const s of spreads) {
            const rad = angle + s;
            this.spawnEnemyBullet(e.x, e.y + 10, Math.cos(rad) * bulletSpeed, Math.sin(rad) * bulletSpeed);
          }
        } else if (type !== 'kamikaze' && Math.random() > 0.4) {
          this.spawnEnemyBullet(e.x, e.y + 10, Math.cos(angle) * bulletSpeed, Math.sin(angle) * bulletSpeed);
        }
      }
      return true;
    });
  }

  private spawnEnemyBullet(x: number, y: number, vx: number, vy: number): void {
    const bullet = this.enemyBullets.get(x, y, 'bullet_enemy') as Phaser.Physics.Arcade.Sprite;
    if (bullet) {
      bullet.setActive(true);
      bullet.setVisible(true);
      bullet.setPosition(x, y);
      bullet.setVelocity(vx, vy);
      if (bullet.body) bullet.body.checkCollision.none = false;
    }
  }

  private triggerBossWarning(): void {
    audioManager.playBossWarning();
    this.cameras.main.shake(600, 0.025);

    const banner = this.add.text(this.scale.width / 2, 220, '⚠️ AVISO: AMEAÇA NÍVEL OMEGA // THE CYBER OVERLORD ⚠️', {
      fontFamily: '"Google Sans Flex", "Share Tech Mono", sans-serif',
      fontSize: '16px',
      color: '#ff0055'
    }).setOrigin(0.5);

    this.tweens.add({
      targets: banner,
      alpha: 0.1,
      yoyo: true,
      repeat: 5,
      duration: 180,
      onComplete: () => banner.destroy()
    });
  }

  private spawnBoss(): void {
    audioManager.setBossMode(true);
    this.boss = new BossOverlord(this, this.scale.width / 2, 140, this.isHardcore);
    this.setupBossHud();

    // Primary Bullets vs Boss
    this.physics.add.overlap(
      this.player.weaponSystem.primaryBullets,
      this.boss,
      (bulletObj) => {
        if (!this.boss || this.boss.isDead) return;
        const bullet = bulletObj as Phaser.Physics.Arcade.Sprite;
        const damage = (bullet.getData('damage') as number) || 30;

        bullet.setActive(false);
        bullet.setVisible(false);

        const isKilled = this.boss.takeDamage(damage);
        audioManager.playHit();
        this.createHitSpark(bullet.x, bullet.y);

        if (isKilled) {
          this.triggerBossDefeated();
        }
      }
    );

    // Secondary Missiles vs Boss
    this.physics.add.overlap(
      this.player.weaponSystem.secondaryMissiles,
      this.boss,
      (missileObj) => {
        if (!this.boss || this.boss.isDead) return;
        const missile = missileObj as Phaser.Physics.Arcade.Sprite;
        const damage = (missile.getData('damage') as number) || 120;

        missile.setActive(false);
        missile.setVisible(false);

        this.createExplosionFX(missile.x, missile.y, true);
        const isKilled = this.boss.takeDamage(damage);
        audioManager.playExplosion();

        if (isKilled) {
          this.triggerBossDefeated();
        }
      }
    );

    // Boss Bullets vs Player
    this.physics.add.overlap(this.player, this.boss.bullets, (_, bulletObj) => {
      if (this.isGameOver || this.isVictory) return;
      const bullet = bulletObj as Phaser.Physics.Arcade.Sprite;
      bullet.setActive(false);
      bullet.setVisible(false);

      const isDead = this.player.takeDamage(1);
      this.scoreCalculator.registerDamageTaken();
      audioManager.playHit();

      if (isDead) {
        this.triggerPlayerDeath();
      }
    });
  }

  private setupBossHud(): void {
    const width = this.scale.width;
    this.bossHudContainer = this.add.container(0, 0);

    const bg = this.add.graphics();
    bg.fillStyle(0x050515, 0.92);
    bg.lineStyle(1.5, 0xff0055, 0.7);
    bg.fillRoundedRect(width / 2 - 200, 80, 400, 32, 8);
    bg.strokeRoundedRect(width / 2 - 200, 80, 400, 32, 8);

    this.bossPhaseText = this.add.text(width / 2 - 190, 85, 'FASE 1 // ESCUDO CINÉTICO', {
      fontFamily: '"Google Sans Code", monospace',
      fontSize: '11px',
      color: '#00f3ff'
    });

    this.bossHpNumbersText = this.add.text(width / 2 + 190, 85, '7.500 / 7.500 HP', {
      fontFamily: '"Google Sans Code", monospace',
      fontSize: '11px',
      color: '#ffd700'
    }).setOrigin(1, 0);

    this.bossHpBarFill = this.add.rectangle(width / 2 - 194, 98, 388, 10, 0x00f3ff).setOrigin(0, 0);
    this.bossHudContainer.add([bg, this.bossPhaseText, this.bossHpNumbersText, this.bossHpBarFill]);
  }

  private triggerBossDefeated(): void {
    this.isVictory = true;
    audioManager.setBossMode(false);
    audioManager.playVictoryJingle();

    if (this.boss) {
      this.createExplosionFX(this.boss.x, this.boss.y, true);
      this.createExplosionFX(this.boss.x - 70, this.boss.y + 20, true);
      this.createExplosionFX(this.boss.x + 70, this.boss.y + 20, true);
      this.createExplosionFX(this.boss.x, this.boss.y - 40, true);
      this.boss.setActive(false);
      this.boss.setVisible(false);
    }

    this.scoreCalculator.registerKill('boss');
    this.cameras.main.shake(1000, 0.035);

    this.time.delayedCall(1200, () => this.showVictoryOverlay());
  }

  private showVictoryOverlay(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    const scoreResult = this.scoreCalculator.calculateFinalScore({
      bossDefeated: true,
      remainingTimeSeconds: this.matchTimer,
      remainingHp: this.player.currentHp,
      synergyBonusUnlocked: true
    });

    this.overlayContainer = this.add.container(0, 0);
    const bg = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.85);

    const card = this.add.graphics();
    card.fillStyle(0x0a0a25, 0.96);
    card.lineStyle(2, 0x00ff88, 0.9);
    card.fillRoundedRect(width / 2 - 240, height / 2 - 200, 480, 400, 16);
    card.strokeRoundedRect(width / 2 - 240, height / 2 - 200, 480, 400, 16);

    const title = this.add.text(width / 2, height / 2 - 150, 'MISSÃO CUMPRIDA!', {
      fontFamily: '"Google Sans Flex", sans-serif',
      fontSize: '30px',
      color: '#00ff88'
    }).setOrigin(0.5);

    const subtitle = this.add.text(width / 2, height / 2 - 110, 'CYBER OVERLORD DESTRUÍDO // FORJA SUPREMA', {
      fontFamily: '"Google Sans Code", monospace',
      fontSize: '12px',
      color: '#00f3ff'
    }).setOrigin(0.5);

    const finalScore = this.add.text(
      width / 2,
      height / 2 - 50,
      `PONTUAÇÃO: ${scoreResult.finalScore.toLocaleString()} PTS`,
      {
        fontFamily: '"Google Sans Flex", sans-serif',
        fontSize: '24px',
        color: '#ffd700'
      }
    ).setOrigin(0.5);

    const breakdown = this.add.text(
      width / 2,
      height / 2 + 25,
      `Combate: ${scoreResult.breakdown.combatScore.toLocaleString()} | Boss: +10.000\nBônus Tempo: +${scoreResult.breakdown.timeBonus} (${this.matchTimer}s restantes)\nSobrevivência: +${scoreResult.breakdown.survivalBonus} (${this.player.currentHp} HP)`,
      {
        fontFamily: '"Google Sans Code", monospace',
        fontSize: '12px',
        color: '#cceeff',
        align: 'center'
      }
    ).setOrigin(0.5);

    const restartPrompt = this.add.text(width / 2, height / 2 + 140, '▶ PRESSIONE [ R ] OU CLIQUE PARA NOVA PARTIDA', {
      fontFamily: '"Google Sans Code", monospace',
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

    this.overlayContainer.add([bg, card, title, subtitle, finalScore, breakdown, restartPrompt]);
  }

  private triggerTimeoutEnd(): void {
    this.isGameOver = true;
    this.showGameOverOverlay('TEMPO ESGOTADO', 'SINAL PERDIDO // RECUO TÁTICO');
  }

  private triggerPlayerDeath(): void {
    this.isGameOver = true;
    audioManager.setBossMode(false);
    this.createExplosionFX(this.player.x, this.player.y, true);
    audioManager.playExplosion(true);

    this.player.setActive(false);
    this.player.setVisible(false);

    this.time.delayedCall(500, () => this.showGameOverOverlay('SINAL PERDIDO', 'FUSELAGEM DESTRUÍDA EM COMBATE'));
  }

  private showGameOverOverlay(titleText: string, subtitleText: string): void {
    const width = this.scale.width;
    const height = this.scale.height;

    this.overlayContainer = this.add.container(0, 0);
    const bg = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.82);

    const card = this.add.graphics();
    card.fillStyle(0x0a0a20, 0.95);
    card.lineStyle(2, 0xff0055, 0.8);
    card.fillRoundedRect(width / 2 - 230, height / 2 - 170, 460, 340, 16);
    card.strokeRoundedRect(width / 2 - 230, height / 2 - 170, 460, 340, 16);

    const title = this.add.text(width / 2, height / 2 - 110, titleText, {
      fontFamily: '"Google Sans Flex", sans-serif',
      fontSize: '32px',
      color: '#ff0055'
    }).setOrigin(0.5);

    const subtitle = this.add.text(width / 2, height / 2 - 70, subtitleText, {
      fontFamily: '"Google Sans Code", monospace',
      fontSize: '12px',
      color: '#ff88aa'
    }).setOrigin(0.5);

    const finalScore = this.add.text(
      width / 2,
      height / 2,
      `PONTUAÇÃO: ${this.scoreCalculator.currentScore.toLocaleString()} PTS`,
      {
        fontFamily: '"Google Sans Flex", sans-serif',
        fontSize: '24px',
        color: '#00f3ff'
      }
    ).setOrigin(0.5);

    const kills = this.add.text(
      width / 2,
      height / 2 + 45,
      `ALVOS ABATIDOS: ${this.scoreCalculator.totalKills} | COMBO: ${this.scoreCalculator.comboMultiplier.toFixed(1)}x`,
      {
        fontFamily: '"Google Sans Code", monospace',
        fontSize: '13px',
        color: '#ffd700'
      }
    ).setOrigin(0.5);

    const restartPrompt = this.add.text(width / 2, height / 2 + 115, '▶ PRESSIONE [ R ] OU CLIQUE PARA REINICIAR', {
      fontFamily: '"Google Sans Code", monospace',
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

    this.overlayContainer.add([bg, card, title, subtitle, finalScore, kills, restartPrompt]);
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

  private setupCollisions(): void {
    // Player Bullets vs Enemies
    this.physics.add.overlap(
      this.player.weaponSystem.primaryBullets,
      this.enemies,
      (bulletObj, enemyObj) => {
        if (this.isGameOver || this.isVictory) return;
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
          const type = (enemy.getData('type') as 'drone' | 'cruiser') || 'drone';
          this.scoreCalculator.registerKill(type);
          audioManager.playExplosion();
        } else {
          enemy.setData('hp', hp);
          this.createHitSpark(bullet.x, bullet.y);
          audioManager.playHit();
        }
      }
    );

    // Enemy Bullets vs Player Ship
    this.physics.add.overlap(this.player, this.enemyBullets, (_, bulletObj) => {
      if (this.isGameOver || this.isVictory) return;
      const bullet = bulletObj as Phaser.Physics.Arcade.Sprite;
      bullet.setActive(false);
      bullet.setVisible(false);

      const isDead = this.player.takeDamage(1);
      this.scoreCalculator.registerDamageTaken();
      audioManager.playHit();

      if (isDead) {
        this.triggerPlayerDeath();
      }
    });

    // Enemy Ramming vs Player Ship
    this.physics.add.overlap(this.player, this.enemies, (_, enemyObj) => {
      if (this.isGameOver || this.isVictory) return;
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
    hudBg.fillStyle(0x050515, 0.88);
    hudBg.lineStyle(1, 0x00f3ff, 0.3);
    hudBg.fillRoundedRect(16, 12, this.scale.width - 32, 60, 8);
    hudBg.strokeRoundedRect(16, 12, this.scale.width - 32, 60, 8);

    this.hudTextScore = this.add.text(32, 22, 'SCORE: 0', {
      fontFamily: '"Google Sans Code", monospace',
      fontSize: '20px',
      color: '#00f3ff'
    });

    this.hudTextTimer = this.add.text(this.scale.width / 2, 22, '90s', {
      fontFamily: '"Google Sans Flex", sans-serif',
      fontSize: '22px',
      color: '#ffd700'
    }).setOrigin(0.5, 0);

    this.hudTextCombo = this.add.text(this.scale.width - 150, 22, '1.0x COMBO', {
      fontFamily: '"Google Sans Code", monospace',
      fontSize: '18px',
      color: '#ff0055'
    });

    this.add.text(32, 50, 'HULL:', {
      fontFamily: '"Google Sans Code", monospace',
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
      fontFamily: '"Google Sans Code", monospace',
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

    if (!this.isGameOver && !this.isVictory && this.player && this.player.active) {
      this.player.update(time, delta);
    }

    if (this.boss && this.boss.active) {
      this.boss.update(time, delta, this.player.x, this.player.y);
      if (this.bossHpBarFill) {
        const pct = Math.max(0, this.boss.currentHp / this.boss.maxHp);
        this.bossHpBarFill.width = 388 * pct;

        if (this.boss.phase === 1) {
          this.bossHpBarFill.setFillStyle(0x00f3ff);
          this.bossPhaseText?.setText('FASE 1 // ESCUDO CINÉTICO');
          this.bossPhaseText?.setColor('#00f3ff');
        } else if (this.boss.phase === 2) {
          this.bossHpBarFill.setFillStyle(0xffd700);
          this.bossPhaseText?.setText('FASE 2 // BLINDAGEM REFORÇADA');
          this.bossPhaseText?.setColor('#ffd700');
        } else {
          this.bossHpBarFill.setFillStyle(0xff0055);
          this.bossPhaseText?.setText('FASE 3 // NÚCLEO BERSERK');
          this.bossPhaseText?.setColor('#ff0055');
        }

        this.bossHpNumbersText?.setText(
          `${this.boss.currentHp.toLocaleString()} / ${this.boss.maxHp.toLocaleString()} HP`
        );
      }
    }

    // Clean off-screen enemy bullets
    this.enemyBullets.children.iterate((child) => {
      const b = child as Phaser.Physics.Arcade.Sprite;
      if (b && b.active && (b.y > this.scale.height + 30 || b.y < -30 || b.x < -30 || b.x > this.scale.width + 30)) {
        b.setActive(false);
        b.setVisible(false);
      }
      return true;
    });

    // Clean off-screen enemies
    this.enemies.children.iterate((child) => {
      const e = child as Phaser.Physics.Arcade.Sprite;
      if (e && e.active && e.y > this.scale.height + 60) {
        e.setActive(false);
        e.setVisible(false);
      }
      return true;
    });

    if (this.hudTextScore) {
      this.hudTextScore.setText(`SCORE: ${this.scoreCalculator.currentScore.toLocaleString()}`);
      this.hudTextTimer.setText(`${this.matchTimer}s`);
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
