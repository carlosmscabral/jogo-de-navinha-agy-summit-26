import Phaser from 'phaser';
import { audioManager } from '../audio/AudioManager.js';

export class BossOverlord extends Phaser.Physics.Arcade.Sprite {
  maxHp = 7500;
  currentHp = 7500;
  phase: 1 | 2 | 3 = 1;
  isDead = false;
  isInvulnerable = false;

  bullets!: Phaser.Physics.Arcade.Group;
  lastFireTime = 0;
  fireAngle = 0;
  difficultyMultiplier = 1.0;
  shieldGraphic!: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, x: number, y: number, isHardcore = false) {
    super(scene, x, y, 'boss_overlord_tex');

    this.difficultyMultiplier = isHardcore ? 1.3 : 1.0;
    this.maxHp = isHardcore ? 9500 : 7500;
    this.currentHp = this.maxHp;

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setCollideWorldBounds(true);
    this.body?.setSize(210, 110);

    this.bullets = scene.physics.add.group({
      defaultKey: 'bullet_boss',
      maxSize: 220
    });

    this.shieldGraphic = scene.add.graphics();
    this.setupBossTextures();

    // Entrance Animation (Descend from top)
    this.setPosition(x, -120);
    scene.tweens.add({
      targets: this,
      y: 145,
      duration: 2200,
      ease: 'Power2',
      onComplete: () => {
        scene.cameras.main.shake(400, 0.015);
      }
    });
  }

  private setupBossTextures(): void {
    if (!this.scene.textures.exists('boss_overlord_tex')) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 140;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.shadowColor = '#ff0055';
        ctx.shadowBlur = 18;

        // Heavy Dreadnought Hull
        ctx.fillStyle = '#12021c';
        ctx.strokeStyle = '#ff0055';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(128, 130);
        ctx.lineTo(245, 45);
        ctx.lineTo(220, 15);
        ctx.lineTo(128, 45);
        ctx.lineTo(36, 15);
        ctx.lineTo(11, 45);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Twin Heavy Vulcan Cannon Pods
        ctx.fillStyle = '#ff0055';
        ctx.fillRect(25, 45, 30, 45);
        ctx.fillRect(201, 45, 30, 45);

        ctx.strokeStyle = '#00f3ff';
        ctx.strokeRect(25, 45, 30, 45);
        ctx.strokeRect(201, 45, 30, 45);

        // Core Glowing Reactor Eye
        ctx.fillStyle = '#00f3ff';
        ctx.shadowColor = '#00f3ff';
        ctx.shadowBlur = 30;
        ctx.beginPath();
        ctx.arc(128, 70, 22, 0, Math.PI * 2);
        ctx.fill();
      }
      this.scene.textures.addCanvas('boss_overlord_tex', canvas);
      this.setTexture('boss_overlord_tex');
    }

    if (!this.scene.textures.exists('bullet_boss')) {
      const g = this.scene.add.graphics();
      g.fillStyle(0xff0055, 1);
      g.fillCircle(7, 7, 7);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(7, 7, 3);
      g.generateTexture('bullet_boss', 14, 14);
      g.destroy();
    }
  }

  update(time: number, delta: number, playerX = 300, playerY = 680): void {
    if (this.isDead || this.y < 120) return;

    // Side-to-side sweeping motion
    const hoverSpeed = this.phase === 3 ? 0.0035 : this.phase === 2 ? 0.0025 : 0.0016;
    const hoverRange = this.phase === 3 ? 4.2 : this.phase === 2 ? 3.0 : 2.0;
    this.x += Math.sin(time * hoverSpeed) * hoverRange;

    // Shield Matrix Visualizer in Phase 1
    this.shieldGraphic.clear();
    if (this.phase === 1 && !this.isDead) {
      this.shieldGraphic.lineStyle(2, 0x00f3ff, 0.6 + Math.sin(time * 0.008) * 0.3);
      this.shieldGraphic.strokeCircle(this.x, this.y, 85);
    } else if (this.isInvulnerable) {
      this.shieldGraphic.lineStyle(4, 0xffd700, 0.9);
      this.shieldGraphic.strokeCircle(this.x, this.y, 95);
    }

    // Bullet Hell Attack Patterns
    const fireCooldown = Math.round(
      (this.phase === 3 ? 85 : this.phase === 2 ? 125 : 180) / this.difficultyMultiplier
    );

    if (time - this.lastFireTime > fireCooldown && !this.isInvulnerable) {
      this.lastFireTime = time;
      this.fireAttackPattern(time, playerX, playerY);
    }

    // Clean offscreen boss bullets
    this.bullets.children.iterate((child) => {
      const b = child as Phaser.Physics.Arcade.Sprite;
      if (b && b.active && (b.y > 900 || b.y < -50 || b.x < -50 || b.x > 750)) {
        b.setActive(false);
        b.setVisible(false);
      }
      return true;
    });
  }

  private fireAttackPattern(time: number, playerX: number, playerY: number): void {
    const bulletSpeed = 260 * this.difficultyMultiplier;

    if (this.phase === 1) {
      // Phase 1: Dual Focused Laser Snipers + 3-Way Heavy Energy Curtains
      const angleLeft = Phaser.Math.Angle.Between(this.x - 75, this.y + 40, playerX, playerY);
      const angleRight = Phaser.Math.Angle.Between(this.x + 75, this.y + 40, playerX, playerY);

      this.spawnBullet(this.x - 75, this.y + 40, Math.cos(angleLeft) * (bulletSpeed + 60), Math.sin(angleLeft) * (bulletSpeed + 60));
      this.spawnBullet(this.x + 75, this.y + 40, Math.cos(angleRight) * (bulletSpeed + 60), Math.sin(angleRight) * (bulletSpeed + 60));

      // 3-way spread from center
      const centerAngles = [-0.3, 0, 0.3];
      for (const a of centerAngles) {
        const rad = Math.PI / 2 + a;
        this.spawnBullet(this.x, this.y + 50, Math.cos(rad) * bulletSpeed, Math.sin(rad) * bulletSpeed);
      }

    } else if (this.phase === 2) {
      // Phase 2: Rotating 8-Way Bullet Hell Spiral + Twin Turret Barrages
      this.fireAngle += 0.28;
      for (let i = 0; i < 8; i++) {
        const rad = this.fireAngle + (i * Math.PI) / 4;
        const vx = Math.cos(rad) * bulletSpeed;
        const vy = Math.sin(rad) * bulletSpeed;
        this.spawnBullet(this.x, this.y + 35, vx, Math.max(70, vy));
      }

      // Sniper shot aimed at player
      const aimAngle = Phaser.Math.Angle.Between(this.x, this.y + 35, playerX, playerY);
      this.spawnBullet(this.x, this.y + 35, Math.cos(aimAngle) * (bulletSpeed + 90), Math.sin(aimAngle) * (bulletSpeed + 90));

    } else {
      // Phase 3 BERSERK: 12-Way Starburst Storm + Relentless Forward Death Lanes
      this.fireAngle += 0.38;
      for (let i = 0; i < 12; i++) {
        const rad = this.fireAngle + (i * Math.PI) / 6;
        const vx = Math.cos(rad) * (bulletSpeed + 40);
        const vy = Math.sin(rad) * (bulletSpeed + 40);
        this.spawnBullet(this.x, this.y + 35, vx, vy);
      }

      // Direct barrage down player's escape vectors
      this.spawnBullet(this.x - 85, this.y + 45, -30, bulletSpeed + 140);
      this.spawnBullet(this.x + 85, this.y + 45, 30, bulletSpeed + 140);
    }
  }

  private spawnBullet(x: number, y: number, vx: number, vy: number): void {
    const bullet = this.bullets.get(x, y, 'bullet_boss') as Phaser.Physics.Arcade.Sprite;
    if (bullet) {
      bullet.setActive(true);
      bullet.setVisible(true);
      bullet.setPosition(x, y);
      bullet.setVelocity(vx, vy);
      if (bullet.body) bullet.body.checkCollision.none = false;
    }
  }

  takeDamage(amount: number): boolean {
    if (this.isDead || this.isInvulnerable) return false;

    // Phase 1 Kinetic Shield absorbs 25% damage
    const actualDamage = this.phase === 1 ? Math.round(amount * 0.75) : amount;
    this.currentHp -= actualDamage;

    const hpRatio = this.currentHp / this.maxHp;

    // Phase 2 Transition (at 66% HP)
    if (hpRatio <= 0.66 && this.phase === 1) {
      this.triggerPhaseTransition(2);
    }
    // Phase 3 Transition (at 33% HP)
    else if (hpRatio <= 0.33 && this.phase === 2) {
      this.triggerPhaseTransition(3);
    }

    // Flash hit effect
    this.setTintFill(0xffffff);
    this.scene.time.delayedCall(40, () => this.clearTint());

    if (this.currentHp <= 0) {
      this.isDead = true;
      this.shieldGraphic.clear();
      return true;
    }
    return false;
  }

  private triggerPhaseTransition(newPhase: 2 | 3): void {
    this.phase = newPhase;
    this.isInvulnerable = true;

    this.scene.cameras.main.shake(600, 0.025);
    audioManager.playBossWarning();

    // Shockwave ring that pushes player/clears bullets
    const shockwave = this.scene.add.circle(this.x, this.y, 20, newPhase === 3 ? 0xff0055 : 0xffd700, 0.9);
    this.scene.tweens.add({
      targets: shockwave,
      radius: 350,
      alpha: 0,
      duration: 800,
      ease: 'Power2',
      onComplete: () => shockwave.destroy()
    });

    // 1.2s Invulnerability frame during phase transition
    this.scene.time.delayedCall(1200, () => {
      this.isInvulnerable = false;
    });
  }

  destroy(fromScene?: boolean): void {
    if (this.shieldGraphic) {
      this.shieldGraphic.destroy();
    }
    super.destroy(fromScene);
  }
}
