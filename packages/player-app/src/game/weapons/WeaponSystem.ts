import Phaser from 'phaser';
import { ShipWeapons } from '@jogo/shared';

export class WeaponSystem {
  scene: Phaser.Scene;
  weaponsSpec: ShipWeapons;
  lastPrimaryFireTime = 0;
  lastSecondaryFireTime = 0;

  primaryBullets!: Phaser.Physics.Arcade.Group;
  secondaryMissiles!: Phaser.Physics.Arcade.Group;

  constructor(scene: Phaser.Scene, weaponsSpec: ShipWeapons) {
    this.scene = scene;
    this.weaponsSpec = weaponsSpec;
    this.initBulletPools();
  }

  private initBulletPools(): void {
    // Primary bullets
    this.primaryBullets = this.scene.physics.add.group({
      defaultKey: 'bullet_primary',
      maxSize: 100
    });

    // Secondary missiles
    this.secondaryMissiles = this.scene.physics.add.group({
      defaultKey: 'missile_secondary',
      maxSize: 20
    });

    // Create bullet textures if not present
    if (!this.scene.textures.exists('bullet_plasma')) {
      const g = this.scene.add.graphics();
      g.fillStyle(0x00f3ff, 1);
      g.fillCircle(8, 8, 6);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(8, 8, 3);
      g.generateTexture('bullet_plasma', 16, 16);
      g.destroy();
    }

    if (!this.scene.textures.exists('bullet_vulcan')) {
      const g = this.scene.add.graphics();
      g.fillStyle(0xffe600, 1);
      g.fillRect(2, 0, 4, 12);
      g.generateTexture('bullet_vulcan', 8, 12);
      g.destroy();
    }

    if (!this.scene.textures.exists('missile_tex')) {
      const g = this.scene.add.graphics();
      g.fillStyle(0xff0055, 1);
      g.fillRect(3, 0, 6, 16);
      g.fillStyle(0xffffff, 1);
      g.fillTriangle(6, 0, 2, 8, 10, 8);
      g.generateTexture('missile_tex', 12, 16);
      g.destroy();
    }
  }

  firePrimary(x: number, y: number, time: number): boolean {
    const fireIntervalMs = 1000 / this.weaponsSpec.primary.fire_rate;
    if (time - this.lastPrimaryFireTime < fireIntervalMs) {
      return false;
    }
    this.lastPrimaryFireTime = time;

    const { type, damage, bullet_speed, spread_angle } = this.weaponsSpec.primary;

    if (type === 'laser') {
      // High-cadence beam simulation
      this.spawnBullet(x, y - 20, 0, -bullet_speed, 'bullet_plasma', damage);
    } else if (type === 'vulcan_spread') {
      // 3-way spread
      const angles = [-spread_angle, 0, spread_angle];
      for (const angle of angles) {
        const rad = Phaser.Math.DegToRad(angle - 90);
        const vx = Math.cos(rad) * bullet_speed;
        const vy = Math.sin(rad) * bullet_speed;
        this.spawnBullet(x, y - 10, vx, vy, 'bullet_vulcan', damage);
      }
    } else {
      // Plasma cannon
      this.spawnBullet(x, y - 20, 0, -bullet_speed, 'bullet_plasma', damage);
    }

    return true;
  }

  fireSecondary(x: number, y: number, time: number, targets?: Phaser.GameObjects.Sprite[]): boolean {
    const cooldownMs = this.weaponsSpec.secondary.cooldown_seconds * 1000;
    if (this.weaponsSpec.secondary.type === 'none') return false;
    if (time - this.lastSecondaryFireTime < cooldownMs) {
      return false;
    }
    this.lastSecondaryFireTime = time;

    const { type, damage } = this.weaponsSpec.secondary;

    if (type === 'homing_missiles') {
      this.spawnMissile(x - 20, y, -100, -300, damage, targets);
      this.spawnMissile(x + 20, y, 100, -300, damage, targets);
    } else if (type === 'emp_burst') {
      this.triggerEmpBurst(x, y, damage);
    }

    return true;
  }

  private spawnBullet(x: number, y: number, vx: number, vy: number, texture: string, damage: number): void {
    const bullet = this.primaryBullets.get(x, y, texture) as Phaser.Physics.Arcade.Sprite;
    if (bullet) {
      bullet.setActive(true);
      bullet.setVisible(true);
      bullet.setPosition(x, y);
      bullet.setVelocity(vx, vy);
      bullet.setData('damage', damage);
      if (bullet.body) {
        bullet.body.checkCollision.none = false;
      }
    }
  }

  private spawnMissile(x: number, y: number, vx: number, vy: number, damage: number, targets?: Phaser.GameObjects.Sprite[]): void {
    const missile = this.secondaryMissiles.get(x, y, 'missile_tex') as Phaser.Physics.Arcade.Sprite;
    if (missile) {
      missile.setActive(true);
      missile.setVisible(true);
      missile.setPosition(x, y);
      missile.setVelocity(vx, vy);
      missile.setData('damage', damage);
    }
  }

  private triggerEmpBurst(x: number, y: number, damage: number): void {
    const ring = this.scene.add.circle(x, y, 10, 0x00f3ff, 0.4);
    this.scene.tweens.add({
      targets: ring,
      radius: 300,
      alpha: 0,
      duration: 500,
      onComplete: () => ring.destroy()
    });
  }

  update(): void {
    // Clean out of bounds bullets
    this.primaryBullets.children.iterate((child) => {
      const b = child as Phaser.Physics.Arcade.Sprite;
      if (b && b.active && (b.y < -50 || b.y > 900 || b.x < -50 || b.x > 850)) {
        b.setActive(false);
        b.setVisible(false);
      }
      return true;
    });
  }
}
