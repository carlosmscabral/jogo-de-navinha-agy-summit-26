import Phaser from 'phaser';
import { BALANCE, ShipAttributes, ShipWeapons, ShipVisuals } from '@jogo/shared';
import { WeaponSystem } from '../weapons/WeaponSystem.js';

/**
 * Resultado de um projétil que encostou no jogador. São duas perguntas diferentes, e o booleano
 * único de antes só sabia responder a segunda:
 *
 * - `hit`  -- o casco ou o escudo realmente pagaram alguma coisa?
 * - `dead` -- a partida acabou agora?
 *
 * Os i-frames e o god mode devolvem `hit: false`: nada foi pago, então nada deve entrar em
 * `damage_taken` nem tocar o som de acerto. Com o retorno antigo (`boolean` = "morreu"), quem
 * chamava não tinha como distinguir "invulnerável, absorveu" de "levou dano e sobreviveu", e os
 * três handlers de colisão contavam as duas coisas igual -- o interceptor fechou uma partida com
 * `damage_taken: 13` tendo capacidade para 4 acertos, porque cada sobreposição durante os 1500ms
 * de invulnerabilidade virava mais um. A inflação escalava com a densidade de projéteis, ou seja,
 * justamente com o que o campo existe para medir.
 */
export interface PlayerHitResult {
  hit: boolean;
  dead: boolean;
}

export class PlayerShip extends Phaser.Physics.Arcade.Sprite {
  attributes: ShipAttributes;
  weaponSystem: WeaponSystem;
  visuals: ShipVisuals;

  currentHp: number;
  currentShield: number;
  isInvulnerable = false;
  /** Dev-harness-only (Task B4). Always false in production. */
  godMode = false;
  /**
   * Dev-harness-only (Task B4). Segura o gatilho primário desde o primeiro quadro, sem teclado.
   *
   * Existe para a captura de conformidade (Spec 09 §5.8): o operador clicava "Boss (40s)" e só
   * então apertava `ESPAÇO`, e o tempo de reação entre uma coisa e outra entrava inteiro no
   * `boss_ttk_s`. Medido pelos contadores de tiro, esse atraso variou de 0.30s a 1.12s entre as
   * três capturas de 2026-08-16 — sozinho, mais que a tolerância de 5% do teste de conformidade
   * numa luta de 7s. É também o que `fireUptime: 1.0` do perfil de habilidade do teste quer dizer
   * literalmente. Sempre false em produção.
   */
  autoFirePrimary = false;

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

  update(time: number, delta: number, getSecondaryTargets?: () => Phaser.GameObjects.Sprite[]): void {
    this.weaponSystem.update(delta);

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

    // Primary fire (Spacebar, ou o gatilho travado do harness)
    if (this.autoFirePrimary || this.keySpace.isDown || this.cursors.space.isDown) {
      this.weaponSystem.firePrimary(this.x, this.y, time);
    }

    // Secondary fire (Shift). `getSecondaryTargets` só é chamado no quadro que realmente dispara
    // -- ela monta um array novo a cada chamada, e recalcular isso a 60fps para uma tecla que
    // recarrega em segundos seria custo pago sem motivo em todo quadro de partida.
    if (Phaser.Input.Keyboard.JustDown(this.keyShift)) {
      this.weaponSystem.fireSecondary(this.x, this.y, time, getSecondaryTargets?.());
    }
  }

  takeDamage(amount = 1): PlayerHitResult {
    if (this.isInvulnerable || this.godMode) return { hit: false, dead: false };

    // Absorb with shield first. O escudo come o hit inteiro, independente de `amount`
    // (ver BALANCE.boss.bullet_damage) -- 1 pip por acerto, não 1 pip por ponto de dano.
    if (this.currentShield > 0) {
      this.currentShield -= 1;
    } else {
      // Trava em 0: com `amount > 1` o casco passaria do zero, e `currentHp` alimenta o
      // `survival_bonus_per_hp` do placar (`buildMatchResult`) além das pips do HUD.
      this.currentHp = Math.max(0, this.currentHp - amount);
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

    return { hit: true, dead: this.currentHp <= 0 };
  }

  destroy(fromScene?: boolean): void {
    if (this.shieldGraphics) {
      this.shieldGraphics.destroy();
    }
    super.destroy(fromScene);
  }
}
