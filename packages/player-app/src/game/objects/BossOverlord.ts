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
  lastSpecialFireTime = 0;
  fireAngle = 0;
  difficultyMultiplier = 1.0;
  shieldGraphic!: Phaser.GameObjects.Graphics;
  thrusterParticles!: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, x: number, y = 150, isHardcore = false) {
    BossOverlord.generateBossTextures(scene);
    super(scene, x, y, 'boss_overlord_dreadnought');

    this.difficultyMultiplier = isHardcore ? 1.4 : 1.0;
    this.maxHp = isHardcore ? 22000 : 15000;
    this.currentHp = this.maxHp;

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setDepth(15);
    this.setDisplaySize(340, 180);
    this.setCollideWorldBounds(true);
    if (this.body) {
      this.body.setSize(300, 140);
      this.body.enable = true;
    }

    // Boss Bullets Pool (High Capacity for Bullet Hell)
    this.bullets = scene.physics.add.group({
      defaultKey: 'bullet_boss_plasma',
      maxSize: 500
    });

    this.shieldGraphic = scene.add.graphics();
    this.shieldGraphic.setDepth(16);

    this.thrusterParticles = scene.add.graphics();
    this.thrusterParticles.setDepth(14);

    this.setScale(1.0);
    this.setAlpha(1.0);
    this.isInvulnerable = false;
    this.triggerEntranceShockwave();
    scene.cameras.main.shake(600, 0.03);
  }

  static generateBossTextures(scene: Phaser.Scene): void {
    if (!scene.textures.exists('boss_overlord_dreadnought')) {
      const g = scene.make.graphics({ x: 0, y: 0 });

      // 1. Titanium Dark Stealth Wings (340x180 Retina crisp vector)
      g.fillStyle(0x07090f, 1);
      g.lineStyle(3, 0x38bdf8, 1);
      g.beginPath();
      g.moveTo(170, 172); // Nose tip
      g.lineTo(245, 120);
      g.lineTo(335, 92);  // Right wing tip
      g.lineTo(320, 25);
      g.lineTo(260, 45);
      g.lineTo(220, 15);
      g.lineTo(170, 35);  // Center top
      g.lineTo(120, 15);
      g.lineTo(80, 45);
      g.lineTo(20, 25);
      g.lineTo(5, 92);    // Left wing tip
      g.lineTo(95, 120);
      g.closePath();
      g.fillPath();
      g.strokePath();

      // 2. Armor Plating Panels (Solar Amber Chamfers)
      g.fillStyle(0x111827, 1);
      g.lineStyle(2, 0xff9e0b, 1);
      g.beginPath();
      g.moveTo(170, 146);
      g.lineTo(232, 100);
      g.lineTo(292, 80);
      g.lineTo(256, 48);
      g.lineTo(170, 62);
      g.lineTo(84, 48);
      g.lineTo(48, 80);
      g.lineTo(108, 100);
      g.closePath();
      g.fillPath();
      g.strokePath();

      // 3. Carbon Wing Vents & Intake Grilles
      g.fillStyle(0x1e293b, 1);
      g.fillRect(60, 55, 30, 8);
      g.fillRect(250, 55, 30, 8);

      // 4. Quad Heavy Plasma Cannon Pods
      g.fillStyle(0x0f172a, 1);
      g.lineStyle(2, 0x38bdf8, 1);
      // Wingtip Pods
      g.fillRect(32, 65, 20, 52);
      g.strokeRect(32, 65, 20, 52);
      g.fillRect(288, 65, 20, 52);
      g.strokeRect(288, 65, 20, 52);
      // Inner Heavy Cannons
      g.fillRect(108, 85, 24, 58);
      g.strokeRect(108, 85, 24, 58);
      g.fillRect(208, 85, 24, 58);
      g.strokeRect(208, 85, 24, 58);

      // Cannon Muzzle Glowing Tips
      g.fillStyle(0xff9e0b, 1);
      g.fillRect(34, 110, 16, 7);
      g.fillRect(290, 110, 16, 7);
      g.fillRect(110, 136, 20, 7);
      g.fillRect(210, 136, 20, 7);

      // 5. Central Hexagonal Cyber Reactor Core
      g.fillStyle(0xff9e0b, 1);
      g.lineStyle(2.5, 0xffffff, 1);
      const cX = 170;
      const cY = 82;
      const r = 25;
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (i * Math.PI) / 3;
        const x = cX + r * Math.cos(angle);
        const y = cY + (r * 0.85) * Math.sin(angle);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      g.fillPath();
      g.strokePath();

      // Inner Glowing Core
      g.fillStyle(0xffffff, 1);
      g.fillCircle(cX, cY, 9);

      g.generateTexture('boss_overlord_dreadnought', 340, 180);
      g.destroy();
    }

    if (!scene.textures.exists('bullet_boss_plasma')) {
      const g = scene.make.graphics({ x: 0, y: 0 });
      g.fillStyle(0xff9e0b, 1);
      g.fillCircle(8, 8, 8);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(8, 8, 4);
      g.generateTexture('bullet_boss_plasma', 16, 16);
      g.destroy();
    }

    if (!scene.textures.exists('bullet_boss_laser')) {
      const g = scene.make.graphics({ x: 0, y: 0 });
      g.fillStyle(0x38bdf8, 1);
      g.fillRect(2, 0, 6, 24);
      g.fillStyle(0xffffff, 1);
      g.fillRect(3, 2, 4, 20);
      g.generateTexture('bullet_boss_laser', 10, 24);
      g.destroy();
    }

    if (!scene.textures.exists('bullet_boss_seeker')) {
      const g = scene.make.graphics({ x: 0, y: 0 });
      g.fillStyle(0xec4899, 1);
      g.fillCircle(9, 9, 9);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(9, 9, 4);
      g.generateTexture('bullet_boss_seeker', 18, 18);
      g.destroy();
    }
  }

  private triggerEntranceShockwave(): void {
    const shockwave = this.scene.add.circle(this.x, this.y, 30, 0x38bdf8, 0.9);
    shockwave.setDepth(14);
    this.scene.tweens.add({
      targets: shockwave,
      radius: 500,
      alpha: 0,
      duration: 850,
      ease: 'Cubic.easeOut',
      onComplete: () => shockwave.destroy()
    });
  }

  update(time: number, delta: number, playerX = 300, playerY = 680): void {
    if (this.isDead || !this.active) return;

    // Tactical Maneuvering (Aggressive horizontal sweeping)
    const hoverSpeed = this.phase === 3 ? 0.0035 : this.phase === 2 ? 0.0025 : 0.0018;
    const hoverRange = this.phase === 3 ? 5.0 : this.phase === 2 ? 3.8 : 2.6;
    this.x += Math.sin(time * hoverSpeed) * hoverRange;

    // Render Dual Animated Ion Thrusters
    this.thrusterParticles.clear();
    const flameSize = 14 + Math.sin(time * 0.02) * 6;
    const thrusterColor = this.phase === 3 ? 0xef4444 : 0x38bdf8;
    this.thrusterParticles.fillStyle(thrusterColor, 0.75);
    this.thrusterParticles.fillTriangle(
      this.x - 90, this.y - 45,
      this.x - 75, this.y - 45,
      this.x - 82.5, this.y - 45 - flameSize
    );
    this.thrusterParticles.fillTriangle(
      this.x + 75, this.y - 45,
      this.x + 90, this.y - 45,
      this.x + 82.5, this.y - 45 - flameSize
    );

    // Draw Hexagonal Shield Barrier in Phase 1 or during Invulnerability
    this.shieldGraphic.clear();
    if (this.phase === 1 && !this.isDead) {
      this.drawHexShield(this.x, this.y, 145, 0x38bdf8, 0.7 + Math.sin(time * 0.008) * 0.25);
    } else if (this.isInvulnerable) {
      this.drawHexShield(this.x, this.y, 155, 0xff9e0b, 0.95);
    }

    // High-cadence Bullet Hell Pattern Execution
    const fireCooldown = Math.round(
      (this.phase === 3 ? 90 : this.phase === 2 ? 120 : 150) / this.difficultyMultiplier
    );

    if (time - this.lastFireTime > fireCooldown && !this.isInvulnerable) {
      this.lastFireTime = time;
      this.fireAttackPattern(time, playerX, playerY);
    }

    // Secondary / Special Attack cadence (Seeking Torpedoes & Nova Bursts)
    const specialCooldown = this.phase === 3 ? 1200 : this.phase === 2 ? 1800 : 2500;
    if (time - this.lastSpecialFireTime > specialCooldown && !this.isInvulnerable) {
      this.lastSpecialFireTime = time;
      this.fireSpecialPattern(time, playerX, playerY);
    }

    // Clean offscreen bullets & update seeker tracking
    this.bullets.children.iterate((child) => {
      const b = child as Phaser.Physics.Arcade.Sprite;
      if (b && b.active) {
        if (b.y > 920 || b.y < -60 || b.x < -60 || b.x > 700) {
          b.setActive(false);
          b.setVisible(false);
        } else if (b.getData('isSeeker')) {
          // Slow homing turn toward player
          const targetAngle = Phaser.Math.Angle.Between(b.x, b.y, playerX, playerY);
          const currentVelAngle = Math.atan2(b.body?.velocity.y || 0, b.body?.velocity.x || 0);
          const newAngle = Phaser.Math.Angle.RotateTo(currentVelAngle, targetAngle, 0.04);
          const speed = 220;
          b.setVelocity(Math.cos(newAngle) * speed, Math.sin(newAngle) * speed);
        }
      }
      return true;
    });
  }

  private drawHexShield(cx: number, cy: number, radius: number, color: number, alpha: number): void {
    this.shieldGraphic.lineStyle(2.5, color, alpha);
    this.shieldGraphic.fillStyle(color, 0.06);

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
    const bulletSpeed = (this.phase === 3 ? 380 : this.phase === 2 ? 340 : 300) * this.difficultyMultiplier;

    if (this.phase === 1) {
      // Phase 1: Dual Muzzle Sniper Lasers + 5-Way Plasma Fan
      const angleLeft = Phaser.Math.Angle.Between(this.x - 110, this.y + 50, playerX, playerY);
      const angleRight = Phaser.Math.Angle.Between(this.x + 110, this.y + 50, playerX, playerY);

      this.spawnBullet(this.x - 110, this.y + 50, Math.cos(angleLeft) * (bulletSpeed + 80), Math.sin(angleLeft) * (bulletSpeed + 80), 'bullet_boss_laser');
      this.spawnBullet(this.x + 110, this.y + 50, Math.cos(angleRight) * (bulletSpeed + 80), Math.sin(angleRight) * (bulletSpeed + 80), 'bullet_boss_laser');

      // 5-Way Spread from inner cannons
      const angles = [-0.45, -0.22, 0, 0.22, 0.45];
      for (const a of angles) {
        const rad = Math.PI / 2 + a;
        this.spawnBullet(this.x, this.y + 60, Math.cos(rad) * bulletSpeed, Math.sin(rad) * bulletSpeed);
      }

    } else if (this.phase === 2) {
      // Phase 2: Rotating 16-Way Bullet Hell Spiral
      this.fireAngle += 0.22;
      for (let i = 0; i < 16; i++) {
        const rad = this.fireAngle + (i * Math.PI) / 8;
        const vx = Math.cos(rad) * bulletSpeed;
        const vy = Math.sin(rad) * bulletSpeed;
        this.spawnBullet(this.x, this.y + 40, vx, Math.max(70, vy));
      }

      // Fast tracking sniper bursts aimed directly at player
      const aimAngle = Phaser.Math.Angle.Between(this.x, this.y + 40, playerX, playerY);
      this.spawnBullet(this.x - 60, this.y + 40, Math.cos(aimAngle) * (bulletSpeed + 100), Math.sin(aimAngle) * (bulletSpeed + 100), 'bullet_boss_laser');
      this.spawnBullet(this.x + 60, this.y + 40, Math.cos(aimAngle) * (bulletSpeed + 100), Math.sin(aimAngle) * (bulletSpeed + 100), 'bullet_boss_laser');

    } else {
      // Phase 3 BERSERK: 24-Way Starburst Storm + Double Forward Sweepers
      this.fireAngle += 0.28;
      for (let i = 0; i < 24; i++) {
        const rad = this.fireAngle + (i * Math.PI) / 12;
        const vx = Math.cos(rad) * (bulletSpeed + 40);
        const vy = Math.sin(rad) * (bulletSpeed + 40);
        this.spawnBullet(this.x, this.y + 40, vx, vy);
      }

      // Continuous dual death lanes down the flanks
      this.spawnBullet(this.x - 135, this.y + 50, -35, bulletSpeed + 180, 'bullet_boss_laser');
      this.spawnBullet(this.x + 135, this.y + 50, 35, bulletSpeed + 180, 'bullet_boss_laser');
    }
  }

  private fireSpecialPattern(time: number, playerX: number, playerY: number): void {
    if (this.phase === 2 || this.phase === 3) {
      // Launch 2 Tracking Seeker Torpedoes from outer pods
      this.spawnBullet(this.x - 130, this.y + 40, -100, 150, 'bullet_boss_seeker', true);
      this.spawnBullet(this.x + 130, this.y + 40, 100, 150, 'bullet_boss_seeker', true);
    }
  }

  private spawnBullet(x: number, y: number, vx: number, vy: number, texture = 'bullet_boss_plasma', isSeeker = false): void {
    const bullet = this.bullets.get(x, y, texture) as Phaser.Physics.Arcade.Sprite;
    if (bullet) {
      bullet.setActive(true);
      bullet.setVisible(true);
      bullet.setDepth(12);
      bullet.setData('isSeeker', isSeeker);
      if (bullet.body) {
        bullet.body.reset(x, y);
        bullet.body.enable = true;
        bullet.body.checkCollision.none = false;
      }
      bullet.setVelocity(vx, vy);
    }
  }

  takeDamage(amount: number): boolean {
    if (this.isDead || this.isInvulnerable) return false;

    // Cap single-pellet raw damage to prevent instantaneous multi-bullet melting
    const cappedPelletDamage = Math.min(45, amount);

    // Phase 1 Kinetic Hex Shield absorbs 50% damage
    // Phase 2 Titanium Armor absorbs 30% damage
    const mitigation = this.phase === 1 ? 0.50 : this.phase === 2 ? 0.70 : 1.0;
    const actualDamage = Math.max(5, Math.round(cappedPelletDamage * mitigation));
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
      this.thrusterParticles.clear();
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
    shockwave.setDepth(14);
    this.scene.tweens.add({
      targets: shockwave,
      radius: 460,
      alpha: 0,
      duration: 900,
      ease: 'Power2',
      onComplete: () => shockwave.destroy()
    });

    // 1.5s Invulnerability frame during phase transition
    this.scene.time.delayedCall(1500, () => {
      this.isInvulnerable = false;
    });
  }

  destroy(fromScene?: boolean): void {
    if (this.shieldGraphic) {
      this.shieldGraphic.destroy();
    }
    if (this.thrusterParticles) {
      this.thrusterParticles.destroy();
    }
    super.destroy(fromScene);
  }
}
