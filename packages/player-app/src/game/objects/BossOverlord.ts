import Phaser from 'phaser';
import { audioManager } from '../audio/AudioManager.js';

export class BossOverlord extends Phaser.Physics.Arcade.Sprite {
  maxHp = 2000;
  currentHp = 2000;
  phase: 1 | 2 | 3 = 1;
  isDead = false;

  bullets!: Phaser.Physics.Arcade.Group;
  lastFireTime = 0;
  fireAngle = 0;
  difficultyMultiplier = 1.0;

  constructor(scene: Phaser.Scene, x: number, y: number, isHardcore = false) {
    super(scene, x, y, 'boss_overlord_tex');

    this.difficultyMultiplier = isHardcore ? 1.3 : 1.0;
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setCollideWorldBounds(true);
    this.body?.setSize(190, 100);

    this.bullets = scene.physics.add.group({
      defaultKey: 'bullet_boss',
      maxSize: 180
    });

    this.setupBossTextures();
  }

  private setupBossTextures(): void {
    if (!this.scene.textures.exists('boss_overlord_tex')) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.shadowColor = '#ff0055';
        ctx.shadowBlur = 15;

        // Dreadnought Armor Body
        ctx.fillStyle = '#180424';
        ctx.strokeStyle = '#ff0055';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(128, 115);
        ctx.lineTo(240, 35);
        ctx.lineTo(210, 15);
        ctx.lineTo(128, 40);
        ctx.lineTo(46, 15);
        ctx.lineTo(16, 35);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Left & Right Heavy Cannons
        ctx.fillStyle = '#ff0055';
        ctx.fillRect(30, 45, 25, 35);
        ctx.fillRect(201, 45, 25, 35);

        // Core Glowing Eye
        ctx.fillStyle = '#00f3ff';
        ctx.shadowColor = '#00f3ff';
        ctx.shadowBlur = 25;
        ctx.beginPath();
        ctx.arc(128, 65, 18, 0, Math.PI * 2);
        ctx.fill();
      }
      this.scene.textures.addCanvas('boss_overlord_tex', canvas);
      this.setTexture('boss_overlord_tex');
    }

    if (!this.scene.textures.exists('bullet_boss')) {
      const g = this.scene.add.graphics();
      g.fillStyle(0xff0055, 1);
      g.fillCircle(7, 7, 6);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(7, 7, 3);
      g.generateTexture('bullet_boss', 14, 14);
      g.destroy();
    }
  }

  update(time: number, delta: number, playerX = 300, playerY = 680): void {
    if (this.isDead) return;

    // Fast side-to-side hovering motion
    const hoverSpeed = this.phase === 3 ? 0.0028 : 0.0018;
    const hoverRange = this.phase === 3 ? 3.2 : 2.2;
    this.x += Math.sin(time * hoverSpeed) * hoverRange;

    // Relentless bullet hell attacks by phase
    const fireCooldown = Math.round((this.phase === 3 ? 100 : this.phase === 2 ? 140 : 200) / this.difficultyMultiplier);
    if (time - this.lastFireTime > fireCooldown) {
      this.lastFireTime = time;
      this.fireAttackPattern(time, playerX, playerY);
    }

    // Clean offscreen boss bullets
    this.bullets.children.iterate((child) => {
      const b = child as Phaser.Physics.Arcade.Sprite;
      if (b && b.active && (b.y > 900 || b.y < -50 || b.x < -50 || b.x > 700)) {
        b.setActive(false);
        b.setVisible(false);
      }
      return true;
    });
  }

  private fireAttackPattern(time: number, playerX: number, playerY: number): void {
    const bulletSpeed = 240 * this.difficultyMultiplier;

    if (this.phase === 1) {
      // Phase 1: Dual Aimed Turrets + Central 3-way spread
      const angleLeft = Phaser.Math.Angle.Between(this.x - 70, this.y + 35, playerX, playerY);
      const angleRight = Phaser.Math.Angle.Between(this.x + 70, this.y + 35, playerX, playerY);

      this.spawnBullet(this.x - 70, this.y + 35, Math.cos(angleLeft) * (bulletSpeed + 40), Math.sin(angleLeft) * (bulletSpeed + 40));
      this.spawnBullet(this.x + 70, this.y + 35, Math.cos(angleRight) * (bulletSpeed + 40), Math.sin(angleRight) * (bulletSpeed + 40));

      // 3-way curtain from center
      const centerAngles = [-0.25, 0, 0.25];
      for (const a of centerAngles) {
        const rad = Math.PI / 2 + a;
        this.spawnBullet(this.x, this.y + 40, Math.cos(rad) * bulletSpeed, Math.sin(rad) * bulletSpeed);
      }

    } else if (this.phase === 2) {
      // Phase 2: Rotating 8-way spiral bullet hell
      this.fireAngle += 0.3;
      for (let i = 0; i < 8; i++) {
        const rad = this.fireAngle + (i * Math.PI) / 4;
        const vx = Math.cos(rad) * bulletSpeed;
        const vy = Math.sin(rad) * bulletSpeed;
        this.spawnBullet(this.x, this.y + 30, vx, Math.max(60, vy));
      }

      // Sniper shot aimed at player
      const aimAngle = Phaser.Math.Angle.Between(this.x, this.y + 30, playerX, playerY);
      this.spawnBullet(this.x, this.y + 30, Math.cos(aimAngle) * (bulletSpeed + 80), Math.sin(aimAngle) * (bulletSpeed + 80));

    } else {
      // Phase 3 ENRAGE: 12-way starburst storm + dual hyper lasers
      this.fireAngle += 0.4;
      for (let i = 0; i < 12; i++) {
        const rad = this.fireAngle + (i * Math.PI) / 6;
        const vx = Math.cos(rad) * (bulletSpeed + 30);
        const vy = Math.sin(rad) * (bulletSpeed + 30);
        this.spawnBullet(this.x, this.y + 30, vx, vy);
      }

      // Direct barrage down the lanes
      this.spawnBullet(this.x - 75, this.y + 35, 0, bulletSpeed + 120);
      this.spawnBullet(this.x + 75, this.y + 35, 0, bulletSpeed + 120);
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
    if (this.isDead) return true;

    this.currentHp -= amount;

    // Phase transitions
    if (this.currentHp <= 600 && this.phase < 3) {
      this.phase = 3;
      this.scene.cameras.main.shake(400, 0.02);
      audioManager.playBossWarning();
    } else if (this.currentHp <= 1300 && this.phase < 2) {
      this.phase = 2;
      this.scene.cameras.main.shake(300, 0.015);
      audioManager.playBossWarning();
    }

    // Flash hit effect
    this.setTintFill(0xffffff);
    this.scene.time.delayedCall(50, () => this.clearTint());

    if (this.currentHp <= 0) {
      this.isDead = true;
      return true;
    }
    return false;
  }
}
