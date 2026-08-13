import Phaser from 'phaser';
import { BALANCE, ShipAttributes, ShipWeapons, ShipVisuals } from '@jogo/shared';
import { WeaponSystem } from '../weapons/WeaponSystem.js';

export class PlayerShip extends Phaser.Physics.Arcade.Sprite {
  attributes: ShipAttributes;
  weaponSystem: WeaponSystem;
  visuals: ShipVisuals;

  currentHp: number;
  currentShield: number;
  isInvulnerable = false;

  shieldGraphics?: Phaser.GameObjects.Graphics;
  thrusterEmitter?: Phaser.GameObjects.Particles.ParticleEmitter;

  cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  keyW!: Phaser.Input.Keyboard.Key;
  keyA!: Phaser.Input.Keyboard.Key;
  keyS!: Phaser.Input.Keyboard.Key;
  keyD!: Phaser.Input.Keyboard.Key;
  keySpace!: Phaser.Input.Keyboard.Key;
  keyShift!: Phaser.Input.Keyboard.Key;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    textureKey: string,
    attributes: ShipAttributes,
    weapons: ShipWeapons,
    visuals: ShipVisuals
  ) {
    super(scene, x, y, textureKey);

    this.attributes = attributes;
    this.visuals = visuals;
    this.currentHp = attributes.max_hp;
    this.currentShield = attributes.shield_capacity;

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setScale(BALANCE.player.sprite_scale); // Crisp 83px scale
    this.setCollideWorldBounds(true);

    // Circular graze body at cockpit center (8 to 16px radius)
    const radius = attributes.hitbox_radius;
    this.body?.setCircle(radius, (this.width - radius * 2) / 2, (this.height - radius * 2) / 2);

    this.weaponSystem = new WeaponSystem(scene, weapons);
    this.setupThrusters();
    this.setupShieldGraphics();
    this.setupControls();
  }

  private setupThrusters(): void {
    // Generate particle texture if needed
    if (!this.scene.textures.exists('particle_flame')) {
      const g = this.scene.add.graphics();
      g.fillStyle(0xffffff, 1);
      g.fillCircle(4, 4, 3);
      g.generateTexture('particle_flame', 8, 8);
      g.destroy();
    }

    const flameColor = Phaser.Display.Color.HexStringToColor(this.visuals.engine_trail_color || '#00f3ff').color;

    const particles = this.scene.add.particles(0, 0, 'particle_flame', {
      speedY: { min: 80, max: 180 },
      speedX: { min: -15, max: 15 },
      scale: { start: 0.8, end: 0 },
      alpha: { start: 0.9, end: 0 },
      tint: flameColor,
      lifespan: 250,
      blendMode: 'ADD',
      frequency: 20
    });

    particles.startFollow(this, 0, 30);
    this.scene.events.once('shutdown', () => particles.destroy());
  }

  private setupShieldGraphics(): void {
    this.shieldGraphics = this.scene.add.graphics();
  }

  private setupControls(): void {
    if (this.scene.input.keyboard) {
      this.cursors = this.scene.input.keyboard.createCursorKeys();
      this.keyW = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
      this.keyA = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
      this.keyS = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S);
      this.keyD = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);
      this.keySpace = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
      this.keyShift = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    }
  }

  update(time: number, delta: number): void {
    this.weaponSystem.update();

    // Movement & Banking
    const speed = this.attributes.speed_px_s;
    let vx = 0;
    let vy = 0;
    let targetAngle = 0;

    if (this.cursors.left.isDown || this.keyA.isDown) {
      vx -= speed;
      targetAngle = -BALANCE.player.bank_angle_deg; // Bank left
    }
    if (this.cursors.right.isDown || this.keyD.isDown) {
      vx += speed;
      targetAngle = BALANCE.player.bank_angle_deg; // Bank right
    }
    if (this.cursors.up.isDown || this.keyW.isDown) vy -= speed;
    if (this.cursors.down.isDown || this.keyS.isDown) vy += speed;

    this.setVelocity(vx, vy);

    // Smooth tilt banking
    this.angle = Phaser.Math.Linear(this.angle, targetAngle, 0.2);

    // Draw Shield Aura if active
    if (this.shieldGraphics) {
      this.shieldGraphics.clear();
      if (this.currentShield > 0) {
        const pulse = Math.sin(time * 0.008) * 3;
        this.shieldGraphics.lineStyle(2, 0x00f3ff, 0.75);
        this.shieldGraphics.fillStyle(0x00f3ff, 0.08);
        this.shieldGraphics.strokeCircle(this.x, this.y, BALANCE.player.shield_aura_radius_px + pulse);
        this.shieldGraphics.fillCircle(this.x, this.y, BALANCE.player.shield_aura_radius_px + pulse);
      }
    }

    // Primary fire (Spacebar)
    if (this.keySpace.isDown || this.cursors.space.isDown) {
      this.weaponSystem.firePrimary(this.x, this.y, time);
    }

    // Secondary fire (Shift)
    if (Phaser.Input.Keyboard.JustDown(this.keyShift)) {
      this.weaponSystem.fireSecondary(this.x, this.y, time);
    }
  }

  takeDamage(amount = 1): boolean {
    if (this.isInvulnerable) return false;

    // Absorb with shield first
    if (this.currentShield > 0) {
      this.currentShield -= 1;
    } else {
      this.currentHp -= amount;
    }

    // Trigger invulnerability frames. The yoyo tween runs 5 up/down cycles
    // (repeat: 4 -> 5 total passes), each pass covering the tween twice
    // (there and back), so total runtime = duration * 2 * 5. To land on
    // BALANCE.player.invulnerability_ms exactly, duration = invulnerability_ms / 10.
    this.isInvulnerable = true;
    this.scene.tweens.add({
      targets: this,
      alpha: 0.25,
      yoyo: true,
      repeat: 4,
      duration: BALANCE.player.invulnerability_ms / 10,
      onComplete: () => {
        this.setAlpha(1);
        this.isInvulnerable = false;
      }
    });

    return this.currentHp <= 0;
  }

  destroy(fromScene?: boolean): void {
    if (this.shieldGraphics) {
      this.shieldGraphics.destroy();
    }
    super.destroy(fromScene);
  }
}
