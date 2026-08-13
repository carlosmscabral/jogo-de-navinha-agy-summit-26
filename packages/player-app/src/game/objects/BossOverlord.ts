import Phaser from 'phaser';
import { BALANCE } from '@jogo/shared';
import { audioManager } from '../audio/AudioManager.js';

export class BossOverlord extends Phaser.Physics.Arcade.Sprite {
  maxHp: number = BALANCE.boss.max_hp;
  currentHp: number = BALANCE.boss.max_hp;
  phase: 1 | 2 | 3 = 1;
  isDead = false;
  isInvulnerable = false;

  bullets!: Phaser.Physics.Arcade.Group;
  lastFireTime = 0;
  fireAngle = 0;
  difficultyMultiplier = 1.0;
  shieldGraphic!: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, x: number, y = 150, isHardcore = false) {
    BossOverlord.generateBossTextures(scene);
    super(scene, x, y, 'boss_overlord_dreadnought');

    this.difficultyMultiplier = isHardcore ? BALANCE.boss.hardcore_difficulty_factor : 1.0;
    this.maxHp = isHardcore ? BALANCE.boss.max_hp_hardcore : BALANCE.boss.max_hp;
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

    // Boss Bullets Pool
    this.bullets = scene.physics.add.group({
      defaultKey: 'bullet_boss_plasma',
      maxSize: BALANCE.pools.boss_bullets
    });

    this.shieldGraphic = scene.add.graphics();
    this.shieldGraphic.setDepth(16);

    // Warp Entrance Flash
    this.setScale(1.0);
    this.setAlpha(1.0);
    this.isInvulnerable = false;
    this.triggerEntranceShockwave();
    scene.cameras.main.shake(600, 0.03);
  }

  static generateBossTextures(scene: Phaser.Scene): void {
    if (!scene.textures.exists('boss_overlord_dreadnought')) {
      const g = scene.make.graphics({ x: 0, y: 0 });

      // 1. Titanium Dark Stealth Wings
      g.fillStyle(0x0a0d16, 1);
      g.lineStyle(3, 0x38bdf8, 1);
      g.beginPath();
      g.moveTo(170, 170); // Nose tip
      g.lineTo(240, 120);
      g.lineTo(335, 90);  // Right wing tip
      g.lineTo(320, 30);
      g.lineTo(260, 45);
      g.lineTo(220, 20);
      g.lineTo(170, 40);  // Center top
      g.lineTo(120, 20);
      g.lineTo(80, 45);
      g.lineTo(20, 30);
      g.lineTo(5, 90);   // Left wing tip
      g.lineTo(100, 120);
      g.closePath();
      g.fillPath();
      g.strokePath();

      // 2. Armor Plating Panels (Amber Facets)
      g.fillStyle(0x141a29, 1);
      g.lineStyle(2, 0xff9e0b, 1);
      g.beginPath();
      g.moveTo(170, 145);
      g.lineTo(230, 100);
      g.lineTo(290, 80);
      g.lineTo(255, 50);
      g.lineTo(170, 65);
      g.lineTo(85, 50);
      g.lineTo(50, 80);
      g.lineTo(110, 100);
      g.closePath();
      g.fillPath();
      g.strokePath();

      // 3. Quad Heavy Plasma Cannon Pods
      g.fillStyle(0x0f172a, 1);
      g.lineStyle(2, 0x38bdf8, 1);
      // Wingtip Pods
      g.fillRect(35, 65, 18, 50);
      g.strokeRect(35, 65, 18, 50);
      g.fillRect(287, 65, 18, 50);
      g.strokeRect(287, 65, 18, 50);
      // Inner Cannons
      g.fillRect(110, 85, 22, 55);
      g.strokeRect(110, 85, 22, 55);
      g.fillRect(208, 85, 22, 55);
      g.strokeRect(208, 85, 22, 55);

      // Cannon Muzzle Glowing Tips
      g.fillStyle(0xff9e0b, 1);
      g.fillRect(37, 108, 14, 7);
      g.fillRect(289, 108, 14, 7);
      g.fillRect(112, 133, 18, 7);
      g.fillRect(210, 133, 18, 7);

      // 4. Central Hexagonal Cyber Reactor Core
      g.fillStyle(0xff9e0b, 1);
      g.lineStyle(2.5, 0xffffff, 1);
      const cX = 170;
      const cY = 82;
      const r = 24;
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
      g.fillCircle(cX, cY, 8);

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
      g.fillRect(2, 0, 6, 22);
      g.fillStyle(0xffffff, 1);
      g.fillRect(3, 2, 4, 18);
      g.generateTexture('bullet_boss_laser', 10, 22);
      g.destroy();
    }
  }

  private triggerEntranceShockwave(): void {
    const shockwave = this.scene.add.circle(this.x, this.y, 30, 0x38bdf8, 0.9);
    shockwave.setDepth(14);
    this.scene.tweens.add({
      targets: shockwave,
      radius: 480,
      alpha: 0,
      duration: 850,
      ease: 'Cubic.easeOut',
      onComplete: () => shockwave.destroy()
    });
  }

  update(time: number, delta: number, playerX = 300, playerY = 680): void {
    if (this.isDead || !this.active) return;

    // Tactical Maneuvering (Aggressive horizontal sweeping)
    const hoverSpeed = this.phase === 3 ? BALANCE.boss.hover_speed.phase3 : this.phase === 2 ? BALANCE.boss.hover_speed.phase2 : BALANCE.boss.hover_speed.phase1;
    const hoverRange = this.phase === 3 ? BALANCE.boss.hover_range_px.phase3 : this.phase === 2 ? BALANCE.boss.hover_range_px.phase2 : BALANCE.boss.hover_range_px.phase1;
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
      (this.phase === 3 ? BALANCE.boss.fire_cooldown_ms.phase3 : this.phase === 2 ? BALANCE.boss.fire_cooldown_ms.phase2 : BALANCE.boss.fire_cooldown_ms.phase1) / this.difficultyMultiplier
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
    const bulletSpeed = (this.phase === 3 ? BALANCE.boss.bullet_speed.phase3 : this.phase === 2 ? BALANCE.boss.bullet_speed.phase2 : BALANCE.boss.bullet_speed.phase1) * this.difficultyMultiplier;

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
      bullet.setDepth(12);
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
    const cappedPelletDamage = Math.min(BALANCE.boss.max_damage_per_primary_hit, amount);

    // Phase 1 Kinetic Hex Shield absorbs 35% damage (BALANCE.boss.mitigation.phase1, Task B8)
    // Phase 2 Titanium Armor absorbs 30% damage
    const mitigation = this.phase === 1 ? BALANCE.boss.mitigation.phase1 : this.phase === 2 ? BALANCE.boss.mitigation.phase2 : BALANCE.boss.mitigation.phase3;
    const actualDamage = Math.max(BALANCE.boss.min_damage_per_hit, Math.round(cappedPelletDamage * mitigation));
    this.currentHp -= actualDamage;

    const hpRatio = this.currentHp / this.maxHp;

    // Phase 2 Transition (at 66% HP)
    if (hpRatio <= BALANCE.boss.phase2_hp_ratio && this.phase === 1) {
      this.triggerPhaseTransition(2);
    }
    // Phase 3 Transition (at 33% HP)
    else if (hpRatio <= BALANCE.boss.phase3_hp_ratio && this.phase === 2) {
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
    shockwave.setDepth(14);
    this.scene.tweens.add({
      targets: shockwave,
      radius: 420,
      alpha: 0,
      duration: 1000,
      ease: 'Power2',
      onComplete: () => shockwave.destroy()
    });

    // Invulnerability frame during phase transition
    this.scene.time.delayedCall(BALANCE.boss.phase_transition_invuln_ms, () => {
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
