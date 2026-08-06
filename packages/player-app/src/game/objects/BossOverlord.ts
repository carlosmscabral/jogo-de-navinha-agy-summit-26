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

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'boss_overlord_tex');

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setCollideWorldBounds(true);
    this.body?.setSize(180, 90);

    this.bullets = scene.physics.add.group({
      defaultKey: 'bullet_boss',
      maxSize: 120
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

        // Left & Right Gun Pods
        ctx.fillStyle = '#ff0055';
        ctx.fillRect(35, 45, 20, 30);
        ctx.fillRect(201, 45, 20, 30);

        // Core Glowing Eye
        ctx.fillStyle = '#00f3ff';
        ctx.shadowColor = '#00f3ff';
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.arc(128, 65, 16, 0, Math.PI * 2);
        ctx.fill();
      }
      this.scene.textures.addCanvas('boss_overlord_tex', canvas);
      this.setTexture('boss_overlord_tex');
    }

    if (!this.scene.textures.exists('bullet_boss')) {
      const g = this.scene.add.graphics();
      g.fillStyle(0xff0055, 1);
      g.fillCircle(6, 6, 5);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(6, 6, 2);
      g.generateTexture('bullet_boss', 12, 12);
      g.destroy();
    }
  }

  update(time: number, delta: number): void {
    if (this.isDead) return;

    // Side-to-side hovering motion
    this.x += Math.sin(time * 0.0015) * 1.8;

    // Bullet hell attack patterns by phase
    const fireCooldown = this.phase === 3 ? 120 : this.phase === 2 ? 180 : 250;
    if (time - this.lastFireTime > fireCooldown) {
      this.lastFireTime = time;
      this.fireAttackPattern(time);
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

  private fireAttackPattern(time: number): void {
    if (this.phase === 1) {
      // Dual turret aimed lasers
      this.spawnBullet(this.x - 70, this.y + 30, Phaser.Math.Between(-30, 30), 220);
      this.spawnBullet(this.x + 70, this.y + 30, Phaser.Math.Between(-30, 30), 220);
    } else if (this.phase === 2) {
      // Rotating 4-way spiral
      this.fireAngle += 0.25;
      for (let i = 0; i < 4; i++) {
        const rad = this.fireAngle + (i * Math.PI) / 2;
        const vx = Math.cos(rad) * 200;
        const vy = Math.sin(rad) * 200;
        this.spawnBullet(this.x, this.y + 20, vx, Math.max(80, vy));
      }
    } else {
      // Phase 3 Enraged: 6-way storm + dual lasers
      this.fireAngle += 0.35;
      for (let i = 0; i < 6; i++) {
        const rad = this.fireAngle + (i * Math.PI) / 3;
        const vx = Math.cos(rad) * 240;
        const vy = Math.sin(rad) * 240;
        this.spawnBullet(this.x, this.y + 20, vx, Math.max(100, vy));
      }
      this.spawnBullet(this.x - 60, this.y + 30, 0, 300);
      this.spawnBullet(this.x + 60, this.y + 30, 0, 300);
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
      this.scene.cameras.main.shake(300, 0.015);
      audioManager.playBossWarning();
    } else if (this.currentHp <= 1200 && this.phase < 2) {
      this.phase = 2;
      this.scene.cameras.main.shake(200, 0.01);
      audioManager.playBossWarning();
    }

    // Flash hit effect
    this.setTintFill(0xffffff);
    this.scene.time.delayedCall(60, () => this.clearTint());

    if (this.currentHp <= 0) {
      this.isDead = true;
      return true;
    }
    return false;
  }
}
