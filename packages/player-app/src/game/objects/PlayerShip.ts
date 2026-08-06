import Phaser from 'phaser';
import { ShipAttributes, ShipWeapons } from '@jogo/shared';
import { WeaponSystem } from '../weapons/WeaponSystem.js';

export class PlayerShip extends Phaser.Physics.Arcade.Sprite {
  attributes: ShipAttributes;
  weaponSystem: WeaponSystem;

  currentHp: number;
  currentShield: number;
  isInvulnerable = false;

  cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  keyW!: Phaser.Input.Keyboard.Key;
  keyA!: Phaser.Input.Keyboard.Key;
  keyS!: Phaser.Input.Keyboard.Key;
  keyD!: Phaser.Input.Keyboard.Key;
  keySpace!: Phaser.Input.Keyboard.Key;
  keyShift!: Phaser.Input.Keyboard.Key;

  exhaustEmitter?: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    textureKey: string,
    attributes: ShipAttributes,
    weapons: ShipWeapons
  ) {
    super(scene, x, y, textureKey);

    this.attributes = attributes;
    this.currentHp = attributes.max_hp;
    this.currentShield = attributes.shield_capacity;

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setScale(0.5); // Visual 64x64 from 128x128 texture
    this.setCollideWorldBounds(true);

    // Circular graze body at cockpit center (8 to 16px radius)
    const radius = attributes.hitbox_radius;
    this.body?.setCircle(radius, (this.width - radius * 2) / 2, (this.height - radius * 2) / 2);

    this.weaponSystem = new WeaponSystem(scene, weapons);
    this.setupControls();
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

    // Movement
    const speed = this.attributes.speed_px_s;
    let vx = 0;
    let vy = 0;

    if (this.cursors.left.isDown || this.keyA.isDown) vx -= speed;
    if (this.cursors.right.isDown || this.keyD.isDown) vx += speed;
    if (this.cursors.up.isDown || this.keyW.isDown) vy -= speed;
    if (this.cursors.down.isDown || this.keyS.isDown) vy += speed;

    this.setVelocity(vx, vy);

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

    // Trigger invulnerability frames (1.5s)
    this.isInvulnerable = true;
    this.scene.tweens.add({
      targets: this,
      alpha: 0.2,
      yoyo: true,
      repeat: 5,
      duration: 150,
      onComplete: () => {
        this.setAlpha(1);
        this.isInvulnerable = false;
      }
    });

    return this.currentHp <= 0;
  }
}
