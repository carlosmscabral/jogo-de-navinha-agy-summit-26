import Phaser from 'phaser';
import { audioManager } from '../audio/AudioManager.js';

export class BossOverlord extends Phaser.Physics.Arcade.Sprite {
  maxHp = 15000;
  currentHp = 15000;
  phase: 1 | 2 | 3 = 1;
  isDead = false;
  isInvulnerable = false;

  bullets!: Phaser.Physics.Arcade.Group;
  lastFireTime = 0;
  fireAngle = 0;
  difficultyMultiplier = 1.0;
  shieldGraphic!: Phaser.GameObjects.Graphics;
  corePulseGraphic!: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, x: number, y: number, isHardcore = false) {
    // Generate texture first before super() instantiation
    BossOverlord.ensureTextures(scene);
    super(scene, x, y, 'boss_overlord_dreadnought');

    this.difficultyMultiplier = isHardcore ? 1.4 : 1.0;
    this.maxHp = isHardcore ? 22000 : 15000;
    this.currentHp = this.maxHp;

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setCollideWorldBounds(true);
    this.body?.setSize(280, 130);

    this.bullets = scene.physics.add.group({
      defaultKey: 'bullet_boss_plasma',
      maxSize: 400
    });

    this.shieldGraphic = scene.add.graphics();
    this.corePulseGraphic = scene.add.graphics();

    // Entrance Animation: Dramatic warp descend
    this.setPosition(x, -160);
    this.isInvulnerable = true;
    scene.tweens.add({
      targets: this,
      y: 155,
      duration: 2600,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        this.isInvulnerable = false;
        scene.cameras.main.shake(600, 0.025);
        this.triggerEntranceShockwave();
      }
    });
  }

  static ensureTextures(scene: Phaser.Scene): void {
    if (!scene.textures.exists('boss_overlord_dreadnought')) {
      const canvas = document.createElement('canvas');
      canvas.width = 340;
      canvas.height = 170;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, 340, 170);

        // 1. Heavy Titanium Outer Wings (Angular Stealth Silhouette)
        ctx.fillStyle = '#0a0d16';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 3;
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 12;

        ctx.beginPath();
        // Nose tip
        ctx.moveTo(170, 160);
        // Right wing sweep
        ctx.lineTo(240, 110);
        ctx.lineTo(330, 85);
        ctx.lineTo(315, 30);
        ctx.lineTo(260, 45);
        ctx.lineTo(220, 20);
        ctx.lineTo(170, 40);
        // Left wing sweep
        ctx.lineTo(120, 20);
        ctx.lineTo(80, 45);
        ctx.lineTo(25, 30);
        ctx.lineTo(10, 85);
        ctx.lineTo(100, 110);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 2. Armor Plating Plates (Dark Slate Layer)
        ctx.fillStyle = '#141a29';
        ctx.strokeStyle = '#ff9e0b';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#ff9e0b';
        ctx.shadowBlur = 14;

        ctx.beginPath();
        ctx.moveTo(170, 140);
        ctx.lineTo(225, 95);
        ctx.lineTo(285, 75);
        ctx.lineTo(250, 45);
        ctx.lineTo(170, 60);
        ctx.lineTo(90, 45);
        ctx.lineTo(55, 75);
        ctx.lineTo(115, 95);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // 3. Quad Heavy Plasma Cannon Barrels
        ctx.fillStyle = '#0f172a';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2;
        // Far left & right pods
        ctx.fillRect(40, 65, 18, 45);
        ctx.strokeRect(40, 65, 18, 45);
        ctx.fillRect(282, 65, 18, 45);
        ctx.strokeRect(282, 65, 18, 45);
        // Inner dual heavy cannons
        ctx.fillRect(115, 85, 20, 50);
        ctx.strokeRect(115, 85, 20, 50);
        ctx.fillRect(205, 85, 20, 50);
        ctx.strokeRect(205, 85, 20, 50);

        // Muzzle Glow Tips
        ctx.fillStyle = '#ff9e0b';
        ctx.fillRect(42, 105, 14, 6);
        ctx.fillRect(284, 105, 14, 6);
        ctx.fillRect(117, 130, 16, 6);
        ctx.fillRect(207, 130, 16, 6);

        // 4. Central Hexagonal Cyber Reactor Core (No more weird circles!)
        ctx.shadowColor = '#ff9e0b';
        ctx.shadowBlur = 24;
        ctx.fillStyle = '#ff9e0b';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2.5;

        ctx.beginPath();
        const cX = 170;
        const cY = 82;
        const r = 22;
        for (let i = 0; i < 6; i++) {
          const angle = (i * Math.PI) / 3;
          const x = cX + r * Math.cos(angle);
          const y = cY + r * Math.sin(angle);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Inner Reactor Heart
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(cX, cY, 8, 0, Math.PI * 2);
        ctx.fill();
      }
      scene.textures.addCanvas('boss_overlord_dreadnought', canvas);
    }

    if (!scene.textures.exists('bullet_boss_plasma')) {
      const g = scene.add.graphics();
      g.fillStyle(0xff9e0b, 1);
      g.fillCircle(8, 8, 8);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(8, 8, 4);
      g.generateTexture('bullet_boss_plasma', 16, 16);
      g.destroy();
    }

    if (!scene.textures.exists('bullet_boss_laser')) {
      const g = scene.add.graphics();
      g.fillStyle(0x38bdf8, 1);
      g.fillRect(2, 0, 6, 20);
      g.fillStyle(0xffffff, 1);
      g.fillRect(3, 2, 4, 16);
      g.generateTexture('bullet_boss_laser', 10, 20);
      g.destroy();
    }
  }

  private triggerEntranceShockwave(): void {
    const shockwave = this.scene.add.circle(this.x, this.y, 30, 0x38bdf8, 0.8);
    this.scene.tweens.add({
      targets: shockwave,
      radius: 450,
      alpha: 0,
      duration: 1000,
      ease: 'Cubic.easeOut',
      onComplete: () => shockwave.destroy()
    });
  }

  update(time: number, delta: number, playerX = 300, playerY = 680): void {
    if (this.isDead || this.y < 130) return;

    // Tactical Maneuvering (Aggressive wide sweeping + forward dive pressure)
    const hoverSpeed = this.phase === 3 ? 0.0038 : this.phase === 2 ? 0.0028 : 0.0018;
    const hoverRange = this.phase === 3 ? 4.8 : this.phase === 2 ? 3.6 : 2.5;
    this.x += Math.sin(time * hoverSpeed) * hoverRange;

    // Draw Hexagonal Shield Barrier in Phase 1 or during Invulnerability
    this.shieldGraphic.clear();
    if (this.phase === 1 && !this.isDead) {
      this.drawHexShield(this.x, this.y, 140, 0x38bdf8, 0.7 + Math.sin(time * 0.008) * 0.25);
    } else if (this.isInvulnerable) {
      this.drawHexShield(this.x, this.y, 150, 0xff9e0b, 0.95);
    }

    // High-cadence Bullet Hell Pattern Execution
    const fireCooldown = Math.round(
      (this.phase === 3 ? 80 : this.phase === 2 ? 115 : 150) / this.difficultyMultiplier
    );

    if (time - this.lastFireTime > fireCooldown && !this.isInvulnerable) {
      this.lastFireTime = time;
      this.fireAttackPattern(time, playerX, playerY);
    }

    // Clean offscreen bullets
    this.bullets.children.iterate((child) => {
      const b = child as Phaser.Physics.Arcade.Sprite;
      if (b && b.active && (b.y > 900 || b.y < -60 || b.x < -60 || b.x > 800)) {
        b.setActive(false);
        b.setVisible(false);
      }
      return true;
    });
  }

  private drawHexShield(cx: number, cy: number, radius: number, color: number, alpha: number): void {
    this.shieldGraphic.lineStyle(2.5, color, alpha);
    this.shieldGraphic.fillStyle(color, 0.05);

    const points: { x: number; y: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      points.push({
        x: cx + radius * Math.cos(angle),
        y: cy + (radius * 0.65) * Math.sin(angle)
      });
    }

    this.shieldGraphic.beginPath();
    this.shieldGraphic.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      this.shieldGraphic.lineTo(points[i].x, points[i].y);
    }
    this.shieldGraphic.closePath();
    this.shieldGraphic.strokePath();
    this.shieldGraphic.fillPath();
  }

  private fireAttackPattern(time: number, playerX: number, playerY: number): void {
    const bulletSpeed = (this.phase === 3 ? 360 : this.phase === 2 ? 320 : 280) * this.difficultyMultiplier;

    if (this.phase === 1) {
      // Phase 1: Dual Muzzle Sniper Lasers + 5-Way Plasma Fan
      const angleLeft = Phaser.Math.Angle.Between(this.x - 110, this.y + 50, playerX, playerY);
      const angleRight = Phaser.Math.Angle.Between(this.x + 110, this.y + 50, playerX, playerY);

      this.spawnBullet(this.x - 110, this.y + 50, Math.cos(angleLeft) * (bulletSpeed + 80), Math.sin(angleLeft) * (bulletSpeed + 80), 'bullet_boss_laser');
      this.spawnBullet(this.x + 110, this.y + 50, Math.cos(angleRight) * (bulletSpeed + 80), Math.sin(angleRight) * (bulletSpeed + 80), 'bullet_boss_laser');

      // 5-Way Spread from inner cannons
      const angles = [-0.5, -0.25, 0, 0.25, 0.5];
      for (const a of angles) {
        const rad = Math.PI / 2 + a;
        this.spawnBullet(this.x, this.y + 60, Math.cos(rad) * bulletSpeed, Math.sin(rad) * bulletSpeed);
      }

    } else if (this.phase === 2) {
      // Phase 2: Rotating 12-Way Bullet Hell Spiral + Twin Tracking Lasers
      this.fireAngle += 0.24;
      for (let i = 0; i < 12; i++) {
        const rad = this.fireAngle + (i * Math.PI) / 6;
        const vx = Math.cos(rad) * bulletSpeed;
        const vy = Math.sin(rad) * bulletSpeed;
        this.spawnBullet(this.x, this.y + 40, vx, Math.max(60, vy));
      }

      // Fast tracking sniper bursts aimed at player escape vector
      const aimAngle = Phaser.Math.Angle.Between(this.x, this.y + 40, playerX, playerY);
      this.spawnBullet(this.x - 50, this.y + 40, Math.cos(aimAngle - 0.1) * (bulletSpeed + 110), Math.sin(aimAngle - 0.1) * (bulletSpeed + 110), 'bullet_boss_laser');
      this.spawnBullet(this.x + 50, this.y + 40, Math.cos(aimAngle + 0.1) * (bulletSpeed + 110), Math.sin(aimAngle + 0.1) * (bulletSpeed + 110), 'bullet_boss_laser');

    } else {
      // Phase 3 BERSERK: 18-Way Starburst Storm + Double Forward Sweepers
      this.fireAngle += 0.32;
      for (let i = 0; i < 18; i++) {
        const rad = this.fireAngle + (i * Math.PI) / 9;
        const vx = Math.cos(rad) * (bulletSpeed + 50);
        const vy = Math.sin(rad) * (bulletSpeed + 50);
        this.spawnBullet(this.x, this.y + 40, vx, vy);
      }

      // Continuous dual death lanes down the sides
      this.spawnBullet(this.x - 130, this.y + 50, -40, bulletSpeed + 160, 'bullet_boss_laser');
      this.spawnBullet(this.x + 130, this.y + 50, 40, bulletSpeed + 160, 'bullet_boss_laser');
    }
  }

  private spawnBullet(x: number, y: number, vx: number, vy: number, texture = 'bullet_boss_plasma'): void {
    const bullet = this.bullets.get(x, y, texture) as Phaser.Physics.Arcade.Sprite;
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

    // Phase 1 Kinetic Hex Shield absorbs 50% damage
    const actualDamage = this.phase === 1 ? Math.round(amount * 0.5) : amount;
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

    this.scene.cameras.main.shake(800, 0.035);
    audioManager.playBossWarning();

    // EMP Shockwave ring
    const shockwave = this.scene.add.circle(this.x, this.y, 25, newPhase === 3 ? 0xef4444 : 0xff9e0b, 0.95);
    this.scene.tweens.add({
      targets: shockwave,
      radius: 420,
      alpha: 0,
      duration: 1000,
      ease: 'Power2',
      onComplete: () => shockwave.destroy()
    });

    // 2.0s Invulnerability frame during phase transition
    this.scene.time.delayedCall(2000, () => {
      this.isInvulnerable = false;
    });
  }

  destroy(fromScene?: boolean): void {
    if (this.shieldGraphic) {
      this.shieldGraphic.destroy();
    }
    if (this.corePulseGraphic) {
      this.corePulseGraphic.destroy();
    }
    super.destroy(fromScene);
  }
}
