import Phaser from 'phaser';
import { BALANCE, ShipWeapons } from '@jogo/shared';
import { despawnPooled, respawnPooled } from '../objects/pooled-body.js';

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
      maxSize: BALANCE.pools.primary_bullets
    });

    // Secondary missiles
    this.secondaryMissiles = this.scene.physics.add.group({
      defaultKey: 'missile_secondary',
      maxSize: BALANCE.pools.secondary_missiles
    });

    // Create bullet textures if not present
    if (!this.scene.textures.exists('bullet_plasma')) {
      const g = this.scene.add.graphics();
      g.fillStyle(0x38bdf8, 1);
      g.fillCircle(8, 8, 6);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(8, 8, 3);
      g.generateTexture('bullet_plasma', 16, 16);
      g.destroy();
    }

    if (!this.scene.textures.exists('bullet_vulcan')) {
      const g = this.scene.add.graphics();
      g.fillStyle(0xff9e0b, 1);
      g.fillRect(2, 0, 4, 12);
      g.generateTexture('bullet_vulcan', 8, 12);
      g.destroy();
    }

    if (!this.scene.textures.exists('missile_tex')) {
      const g = this.scene.add.graphics();
      g.fillStyle(0x38bdf8, 1);
      g.fillRect(3, 0, 6, 16);
      g.fillStyle(0xffffff, 1);
      g.fillTriangle(6, 0, 2, 8, 10, 8);
      g.generateTexture('missile_tex', 12, 16);
      g.destroy();
    }
  }

  /**
   * Avisa quantos projéteis primários acabaram de sair do cano (3 no `vulcan_spread`, 1 nas
   * demais). Quem conta é o `ScoreCalculator` da cena, dono de `shotsFired`/`shotsHit`: o
   * `WeaponSystem` não conhece a cena e os dois contadores precisam viver no mesmo objeto, senão
   * `accuracy_pct` divide números que podem sair de sincronia.
   */
  onPrimaryShotsFired?: (projectiles: number) => void;

  firePrimary(x: number, y: number, time: number): boolean {
    // [D14] fire_rate já chega validado pelo schema (5 a 12 -- ver BALANCE.ranges);
    // reclampar aqui seria o próprio bug que a Tarefa B2 elimina.
    const effectiveFireRate = this.weaponsSpec.primary.fire_rate;
    const fireIntervalMs = 1000 / effectiveFireRate;

    if (time - this.lastPrimaryFireTime < fireIntervalMs) {
      return false;
    }
    this.lastPrimaryFireTime = time;

    const { type, damage, bullet_speed, spread_angle } = this.weaponsSpec.primary;
    // [D14] damage/bullet_speed já chegam validados pelo schema (15 a 45 / 400 a 800);
    // os valores chegam intactos.
    const balancedDamage = damage;
    const speed = bullet_speed;

    let projectiles = 1;

    if (type === 'laser') {
      // Rapid focused laser pulse
      this.spawnBullet(x, y - 20, 0, -speed, 'bullet_plasma', balancedDamage);
    } else if (type === 'vulcan_spread') {
      // 3-way spread (slightly reduced per-pellet damage for balance)
      const spreadDamage = Math.round(balancedDamage * BALANCE.weapons.primary.vulcan_pellet_factor);
      const angle = (spread_angle && spread_angle < 1.0 && spread_angle > 0)
        ? Phaser.Math.RadToDeg(spread_angle)
        : (spread_angle || BALANCE.weapons.primary.default_spread_deg);
      const angles = [-angle, 0, angle];
      for (const a of angles) {
        const rad = Phaser.Math.DegToRad(a - 90);
        const vx = Math.cos(rad) * speed;
        const vy = Math.sin(rad) * speed;
        this.spawnBullet(x, y - 10, vx, vy, 'bullet_vulcan', spreadDamage);
      }
      projectiles = angles.length;
    } else {
      // Plasma cannon
      this.spawnBullet(x, y - 20, 0, -speed, 'bullet_plasma', balancedDamage);
    }

    this.onPrimaryShotsFired?.(projectiles);

    return true;
  }

  fireSecondary(x: number, y: number, time: number, targets?: Phaser.GameObjects.Sprite[]): boolean {
    const cooldownMs = (this.weaponsSpec.secondary?.cooldown_seconds || 2) * 1000;
    if (this.weaponsSpec.secondary?.type === 'none') return false;
    if (time - this.lastSecondaryFireTime < cooldownMs) {
      return false;
    }
    this.lastSecondaryFireTime = time;

    const { type, damage } = this.weaponsSpec.secondary;
    // [D14] damage já chega validado pelo schema (60 a 150); o valor chega intacto.
    const balancedDamage = damage;

    if (type === 'homing_missiles') {
      this.spawnMissile(x - 20, y, -BALANCE.weapons.secondary.missile_speed_x, BALANCE.weapons.secondary.missile_speed_y, balancedDamage, targets);
      this.spawnMissile(x + 20, y, BALANCE.weapons.secondary.missile_speed_x, BALANCE.weapons.secondary.missile_speed_y, balancedDamage, targets);
    } else if (type === 'emp_burst') {
      this.triggerEmpBurst(x, y, balancedDamage);
    }

    return true;
  }

  getSecondaryStatus(time: number): { isReady: boolean; progress: number; remainingSec: number; type: string } {
    const cooldownMs = (this.weaponsSpec.secondary?.cooldown_seconds || 2) * 1000;
    const elapsed = time - this.lastSecondaryFireTime;
    const isReady = this.lastSecondaryFireTime === 0 || elapsed >= cooldownMs;
    const progress = isReady ? 1.0 : Math.min(1.0, Math.max(0, elapsed / cooldownMs));
    const remainingSec = isReady ? 0 : Math.ceil((cooldownMs - elapsed) / 1000);
    const type = this.weaponsSpec.secondary?.type || 'homing_missiles';

    return { isReady, progress, remainingSec, type };
  }

  private spawnBullet(x: number, y: number, vx: number, vy: number, texture: string, damage: number): void {
    const bullet = this.primaryBullets.get(x, y, texture) as Phaser.Physics.Arcade.Sprite;
    if (bullet) {
      bullet.setData('damage', damage);
      respawnPooled(bullet, x, y, vx, vy);
    }
  }

  private spawnMissile(x: number, y: number, vx: number, vy: number, damage: number, targets?: Phaser.GameObjects.Sprite[]): void {
    const missile = this.secondaryMissiles.get(x, y, 'missile_tex') as Phaser.Physics.Arcade.Sprite;
    if (missile) {
      missile.setData('damage', damage);
      respawnPooled(missile, x, y, vx, vy);
    }
  }

  private triggerEmpBurst(x: number, y: number, damage: number): void {
    const ring = this.scene.add.circle(x, y, 10, 0x38bdf8, 0.4);
    this.scene.tweens.add({
      targets: ring,
      radius: BALANCE.weapons.secondary.emp_radius_px,
      alpha: 0,
      duration: 500,
      onComplete: () => ring.destroy()
    });
    this.scene.events.emit('secondary-emp-burst', { x, y, damage });
  }

  update(): void {
    // Clean out of bounds bullets
    this.primaryBullets.children.iterate((child) => {
      const b = child as Phaser.Physics.Arcade.Sprite;
      if (b && b.active && (b.y < -50 || b.y > 900 || b.x < -50 || b.x > 850)) {
        despawnPooled(b);
      }
      return true;
    });

    // Clean out of bounds missiles. Without this, the pool of
    // BALANCE.pools.secondary_missiles exhausts after a few volleys and the
    // secondary weapon silently stops spawning anything (D13).
    this.secondaryMissiles.children.iterate((child) => {
      const m = child as Phaser.Physics.Arcade.Sprite;
      if (m && m.active && (m.y < -50 || m.y > 900 || m.x < -50 || m.x > 850)) {
        despawnPooled(m);
      }
      return true;
    });
  }
}

/**
 * Dano do EMP em função da distância ao epicentro. Pura por design: reusada pelo
 * simulador (Tarefa B7) sem instanciar Phaser.
 */
export function computeEmpDamage(baseDamage: number, distance: number): number {
  const { emp_radius_px, emp_edge_falloff } = BALANCE.weapons.secondary;
  if (distance > emp_radius_px) return 0;
  const t = distance / emp_radius_px;
  return baseDamage * (1 - t * (1 - emp_edge_falloff));
}
