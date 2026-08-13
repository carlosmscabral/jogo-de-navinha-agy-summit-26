import Phaser from 'phaser';
import {
  BALANCE,
  ShipSpecification,
  FALLBACK_PRESETS,
  MatchTelemetry,
  ScoreBreakdown,
  ScoreCalculator,
  SeededRandom,
  SynergyName,
  applySynergies,
  regeneratesHp
} from '@jogo/shared';
import { PlayerShip } from '../objects/PlayerShip.js';
import { BossOverlord } from '../objects/BossOverlord.js';
import { ShipTextureFactory } from '../factories/ShipTextureFactory.js';
import { renderSvgShipTexture } from '../factories/SvgShipRenderer.js';
import { audioManager } from '../audio/AudioManager.js';
import { computeEmpDamage } from '../weapons/WeaponSystem.js';
// Type-only: `game/index.ts` imports `MainGameScene` at the value level, so a value import
// here would create a runtime circular dependency. `import type` is erased entirely by the
// compiler/bundler, so no cycle exists at runtime (verified via `npm run build`).
import type { DevGameOptions, DevTelemetryFrame } from '../index.js';

interface StarPoint {
  x: number;
  y: number;
  speed: number;
  size: number;
  alpha: number;
  color: number;
}

export class MainGameScene extends Phaser.Scene {
  shipSpec: ShipSpecification = FALLBACK_PRESETS.interceptor;
  isHardcore = false;
  seed = 0;
  rng!: SeededRandom;
  player!: PlayerShip;
  appliedSynergies: SynergyName[] = [];
  boss?: BossOverlord;
  scoreCalculator = new ScoreCalculator();
  onMatchComplete?: (data: { finalScore: number; victory: boolean; breakdown: ScoreBreakdown; telemetry: MatchTelemetry }) => void;
  /** Set unconditionally by `createGameInstance` (Task B4). Undefined fields are inert in production. */
  devOptions?: DevGameOptions;

  matchTimer: number = BALANCE.match.duration_s;
  elapsedSeconds = 0;
  isGameOver = false;
  isVictory = false;
  hasNotifiedCompletion = false;
  bossKilledAtSeconds: number | null = null;

  // Boss DPS bookkeeping for the dev harness telemetry stream (Task B4). See buildTelemetryFrame's
  // comment for the exact instant/average algorithm. Cheap to maintain even when unused.
  private bossDamageSamples: { t: number; dmg: number }[] = [];
  private bossDamageTotal = 0;
  private bossFightStartMs: number | null = null;

  enemies!: Phaser.Physics.Arcade.Group;
  enemyBullets!: Phaser.Physics.Arcade.Group;
  stars: StarPoint[] = [];
  starfieldGraphics!: Phaser.GameObjects.Graphics;
  nebulaGraphics!: Phaser.GameObjects.Graphics;

  // HUD Elements
  hudTextScore!: Phaser.GameObjects.Text;
  hudTextTimer!: Phaser.GameObjects.Text;
  hudTextCombo!: Phaser.GameObjects.Text;
  hudHpBars: Phaser.GameObjects.Rectangle[] = [];
  hudShieldBars: Phaser.GameObjects.Rectangle[] = [];

  // Secondary Weapon HUD
  hudSecondaryLabel!: Phaser.GameObjects.Text;
  hudSecondaryText!: Phaser.GameObjects.Text;
  hudSecondaryBarBg!: Phaser.GameObjects.Rectangle;
  hudSecondaryBarFill!: Phaser.GameObjects.Rectangle;

  // Bottom Controls Legend
  controlsLegendContainer!: Phaser.GameObjects.Container;

  // Boss HUD
  bossHudContainer?: Phaser.GameObjects.Container;
  bossHpBarFill?: Phaser.GameObjects.Rectangle;
  bossPhaseText?: Phaser.GameObjects.Text;
  bossHpNumbersText?: Phaser.GameObjects.Text;

  overlayContainer?: Phaser.GameObjects.Container;

  constructor() {
    super({ key: 'MainGameScene' });
  }

  init(data: { shipSpec?: ShipSpecification; isHardcore?: boolean }): void {
    if (data?.shipSpec) {
      this.shipSpec = data.shipSpec;
    }
    this.isHardcore = !!data?.isHardcore;
    this.rng = new SeededRandom(this.seed);
    this.isGameOver = false;
    this.isVictory = false;
    this.hasNotifiedCompletion = false;
    this.elapsedSeconds = 0;
    this.matchTimer = BALANCE.match.duration_s;
    this.bossKilledAtSeconds = null;
    this.scoreCalculator = new ScoreCalculator();
    this.boss = undefined;
    audioManager.setBossMode(false);
  }

  create(): void {
    // 1. Deep Obsidian Aerospace Starfield
    this.createCosmicBackground();

    // 2. Generate Ship & Enemy Textures
    const textureKey = `ship_${this.shipSpec.visuals.style_name.replace(/\s+/g, '_')}`;
    if (!renderSvgShipTexture(this, textureKey, this.shipSpec.visuals)) {
      // D17: o casco do agente foi recusado. A nave paramétrica preserva as cores.
      ShipTextureFactory.createShipTexture(this, textureKey, this.shipSpec.visuals);
    }
    ShipTextureFactory.createEnemyDroneTexture(this);
    ShipTextureFactory.createBossTexture(this);

    // 3. Create Player Ship
    const startX = this.scale.width / 2;
    const startY = this.scale.height - 120;
    const synergy = applySynergies(this.shipSpec);
    this.appliedSynergies = synergy.applied;
    this.player = new PlayerShip(
      this,
      startX,
      startY,
      textureKey,
      synergy.attributes,
      synergy.weapons,
      this.shipSpec.visuals
    );
    this.player.godMode = !!this.devOptions?.godMode;

    // 4. Enemy and Enemy Bullet Pools
    this.enemies = this.physics.add.group({
      defaultKey: 'drone_tex',
      maxSize: BALANCE.pools.enemies
    });

    if (!this.textures.exists('bullet_enemy')) {
      const g = this.add.graphics();
      g.fillStyle(0xef4444, 1);
      g.fillCircle(5, 5, 5);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(5, 5, 2);
      g.generateTexture('bullet_enemy', 10, 10);
      g.destroy();
    }

    this.enemyBullets = this.physics.add.group({
      defaultKey: 'bullet_enemy',
      maxSize: BALANCE.pools.enemy_bullets
    });

    // 5. Collisions & Weapon Overlaps
    this.setupCollisions();

    // --- Dev-harness-only hooks (Spec 09 §4). Inert in production. ---
    if (this.devOptions?.startAtSeconds) {
      this.fastForwardTo(this.devOptions.startAtSeconds);
    }
    if (this.devOptions?.timeScale) {
      this.time.timeScale = this.devOptions.timeScale;
      this.physics.world.timeScale = 1 / this.devOptions.timeScale;
    }
    if (this.devOptions?.physicsDebug) {
      this.physics.world.createDebugGraphic();
      this.physics.world.drawDebug = true;
    }

    // 6. Modern Aerospace Flight Deck HUD & Controls Legend
    this.setupModernHud();
    this.setupControlsLegend();

    // 7. Match Clock
    this.time.addEvent({
      delay: 1000,
      callback: () => this.handleMatchTick(),
      loop: true
    });

    // 8. Dynamic Enemy Wave Spawner (until boss spawns)
    this.time.addEvent({
      delay: this.isHardcore ? BALANCE.match.wave_interval_hardcore_ms : BALANCE.match.wave_interval_ms,
      callback: () => {
        if (!this.isGameOver && !this.isVictory && this.elapsedSeconds < BALANCE.match.boss_spawn_s) {
          this.spawnWaveEnemies();
        }
      },
      loop: true
    });

    // 9. Enemy Firing Event
    this.time.addEvent({
      delay: this.isHardcore ? BALANCE.match.enemy_fire_interval_hardcore_ms : BALANCE.match.enemy_fire_interval_ms,
      callback: () => {
        if (!this.isGameOver && !this.isVictory && this.elapsedSeconds < BALANCE.match.boss_spawn_s) {
          this.triggerEnemyShots();
        }
      },
      loop: true
    });

    // Keys and Click handler to transition to debrief when game concludes
    this.input.keyboard?.on('keydown', (e: KeyboardEvent) => {
      audioManager.unlockAudio();
      if ((this.isGameOver || this.isVictory) && (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyR')) {
        this.finishMatchAndTransition();
      }
    });

    this.input.on('pointerdown', () => {
      audioManager.unlockAudio();
      if (this.isGameOver || this.isVictory) {
        this.finishMatchAndTransition();
      }
    });

    audioManager.unlockAudio();
  }

  private handleMatchTick(): void {
    if (this.isGameOver || this.isVictory) return;

    this.elapsedSeconds += 1;
    this.matchTimer = Math.max(0, BALANCE.match.duration_s - this.elapsedSeconds);

    // Boss appears at boss_spawn_s (with a boss_warning_s heads-up)
    if (this.elapsedSeconds === BALANCE.match.boss_warning_s) {
      this.triggerBossWarning();
    } else if (this.elapsedSeconds === BALANCE.match.boss_spawn_s) {
      this.spawnBoss();
    }

    if (
      regeneratesHp(this.appliedSynergies) &&
      this.elapsedSeconds > 0 &&
      this.elapsedSeconds % BALANCE.synergies.titan_fortress.regen_interval_s === 0 &&
      this.player.currentHp < this.player.attributes.max_hp
    ) {
      this.player.currentHp += 1;
    }

    if (this.matchTimer <= 0 && !this.isVictory) {
      this.triggerTimeoutEnd();
    }
  }

  private spawnWaveEnemies(): void {
    const isWave2 = this.elapsedSeconds >= BALANCE.match.wave2_starts_s;
    const squadType = this.rng.between(1, 3);

    if (squadType === 1) {
      // V-Formation (3 Drones)
      const centerX = this.rng.between(120, this.scale.width - 120);
      this.createSingleDrone(centerX, -30, 0, BALANCE.enemies.drone.speed_y, BALANCE.enemies.drone.hp, 'drone');
      this.createSingleDrone(centerX - 45, -60, -20, BALANCE.enemies.drone.speed_y, BALANCE.enemies.drone.hp, 'drone');
      this.createSingleDrone(centerX + 45, -60, 20, BALANCE.enemies.drone.speed_y, BALANCE.enemies.drone.hp, 'drone');
    } else if (squadType === 2 && isWave2) {
      // Elite Cruiser + Escorts
      const x = this.rng.between(100, this.scale.width - 100);
      this.createSingleDrone(x, -40, 0, BALANCE.enemies.cruiser.speed_y, BALANCE.enemies.cruiser.hp, 'cruiser');
      this.createSingleDrone(x - 50, -20, -15, 200, BALANCE.enemies.drone.hp, 'drone');
      this.createSingleDrone(x + 50, -20, 15, 200, BALANCE.enemies.drone.hp, 'drone');
    } else {
      // Kamikaze Fast Dive Squadron (2 Drones)
      const x1 = this.rng.between(80, this.scale.width / 2 - 20);
      const x2 = this.rng.between(this.scale.width / 2 + 20, this.scale.width - 80);
      this.createSingleDrone(x1, -30, 15, BALANCE.enemies.kamikaze.speed_y, BALANCE.enemies.kamikaze.hp, 'kamikaze');
      this.createSingleDrone(x2, -30, -15, BALANCE.enemies.kamikaze.speed_y, BALANCE.enemies.kamikaze.hp, 'kamikaze');
    }
  }

  private createSingleDrone(x: number, y: number, vx: number, vy: number, hp: number, type: string): void {
    const drone = this.enemies.get(x, y, 'drone_tex') as Phaser.Physics.Arcade.Sprite;
    if (drone) {
      drone.setActive(true);
      drone.setVisible(true);
      drone.setPosition(x, y);
      drone.setData('hp', this.isHardcore ? Math.round(hp * BALANCE.enemies.hardcore.hp_factor) : hp);
      drone.setData('type', type);

      if (type === 'cruiser') {
        drone.setScale(1.3);
        drone.setTint(0xff9e0b);
      } else if (type === 'kamikaze') {
        drone.setScale(0.75);
        drone.setTint(0x38bdf8);
      } else {
        drone.setScale(0.85);
        drone.clearTint();
      }

      drone.setVelocity(vx, this.isHardcore ? vy * BALANCE.enemies.hardcore.speed_factor : vy);
    }
  }

  private triggerEnemyShots(): void {
    const pX = this.player.x;
    const pY = this.player.y;

    this.enemies.children.iterate((child) => {
      const e = child as Phaser.Physics.Arcade.Sprite;
      if (e && e.active && e.y > 20 && e.y < this.scale.height - 180) {
        const type = e.getData('type') as string;
        const angle = Phaser.Math.Angle.Between(e.x, e.y, pX, pY);
        const bulletSpeed = this.isHardcore ? BALANCE.enemies.bullet_speed_hardcore : BALANCE.enemies.bullet_speed;

        if (type === 'cruiser') {
          const spreads = [-0.25, 0, 0.25];
          for (const s of spreads) {
            const rad = angle + s;
            this.spawnEnemyBullet(e.x, e.y + 10, Math.cos(rad) * bulletSpeed, Math.sin(rad) * bulletSpeed);
          }
        } else if (type !== 'kamikaze' && this.rng.chance(BALANCE.enemies.fire_chance)) {
          this.spawnEnemyBullet(e.x, e.y + 10, Math.cos(angle) * bulletSpeed, Math.sin(angle) * bulletSpeed);
        }
      }
      return true;
    });
  }

  private spawnEnemyBullet(x: number, y: number, vx: number, vy: number): void {
    const bullet = this.enemyBullets.get(x, y, 'bullet_enemy') as Phaser.Physics.Arcade.Sprite;
    if (bullet) {
      bullet.setActive(true);
      bullet.setVisible(true);
      bullet.setPosition(x, y);
      bullet.setVelocity(vx, vy);
      if (bullet.body) bullet.body.checkCollision.none = false;
    }
  }

  private triggerBossWarning(): void {
    audioManager.playBossWarning();
    this.cameras.main.shake(600, 0.025);

    const banner = this.add.text(this.scale.width / 2, 220, '⚠️ ALERTA: AMEAÇA NÍVEL OMEGA // THE CYBER OVERLORD ⚠️', {
      fontFamily: '"Google Sans Flex", sans-serif',
      fontSize: '16px',
      color: '#ff9e0b'
    }).setOrigin(0.5);

    this.tweens.add({
      targets: banner,
      alpha: 0.1,
      yoyo: true,
      repeat: 5,
      duration: 180,
      onComplete: () => banner.destroy()
    });
  }

  private spawnBoss(): void {
    audioManager.setBossMode(true);
    this.boss = new BossOverlord(this, this.scale.width / 2, 140, this.isHardcore);
    this.bossFightStartMs = this.time.now;
    this.setupBossHud();

    // Primary Bullets vs Boss
    this.physics.add.overlap(
      this.player.weaponSystem.primaryBullets,
      this.boss,
      (bulletObj) => {
        if (!this.boss || this.boss.isDead) return;
        const bullet = bulletObj as Phaser.Physics.Arcade.Sprite;
        const damage = (bullet.getData('damage') as number) || 30;

        bullet.setActive(false);
        bullet.setVisible(false);

        const hpBefore = this.boss.currentHp;
        const isKilled = this.boss.takeDamage(damage);
        this.recordBossDamage(hpBefore - this.boss.currentHp, this.time.now);
        audioManager.playHit();
        this.createHitSpark(bullet.x, bullet.y);

        if (isKilled) {
          this.triggerBossDefeated();
        }
      }
    );

    // Secondary Missiles vs Boss
    this.physics.add.overlap(
      this.player.weaponSystem.secondaryMissiles,
      this.boss,
      (missileObj) => {
        if (!this.boss || this.boss.isDead) return;
        const missile = missileObj as Phaser.Physics.Arcade.Sprite;
        const damage = (missile.getData('damage') as number) || 120;

        missile.setActive(false);
        missile.setVisible(false);

        this.createExplosionFX(missile.x, missile.y, true);
        const hpBefore = this.boss.currentHp;
        const isKilled = this.boss.takeDamage(damage);
        this.recordBossDamage(hpBefore - this.boss.currentHp, this.time.now);
        audioManager.playExplosion();

        if (isKilled) {
          this.triggerBossDefeated();
        }
      }
    );

    // Boss Bullets vs Player
    this.physics.add.overlap(this.player, this.boss.bullets, (_, bulletObj) => {
      if (this.isGameOver || this.isVictory) return;
      const bullet = bulletObj as Phaser.Physics.Arcade.Sprite;
      bullet.setActive(false);
      bullet.setVisible(false);

      const isDead = this.player.takeDamage(1);
      // Dev-harness god mode (Task B4): takeDamage() already no-ops the HP/shield change, but
      // this call is unconditional, so without this guard every "hit" still zeroes the combo and
      // counts as damage taken while god mode is on -- corrupting the very telemetry/score the
      // harness exists to show. `isDead` can't be used for this: it means "the player died", a
      // different condition from "was hit".
      if (!this.player.godMode) this.scoreCalculator.registerDamageTaken();
      audioManager.playHit();

      if (isDead) {
        this.triggerPlayerDeath();
      }
    });
  }

  /** Only the harness calls this. Skips the match clock without simulating what was skipped. */
  private fastForwardTo(seconds: number): void {
    this.elapsedSeconds = Math.min(seconds, BALANCE.match.duration_s - 1);
    this.matchTimer = BALANCE.match.duration_s - this.elapsedSeconds;
    if (this.elapsedSeconds >= BALANCE.match.boss_spawn_s && !this.boss) {
      this.spawnBoss();
      this.applyStartBossPhase(this.devOptions?.startAtBossPhase);
    }
  }

  /**
   * Split out of `fastForwardTo` on purpose: TS's control-flow analysis narrows `this.boss` to
   * `undefined` inside the `!this.boss` branch above and does not re-widen it across the
   * `spawnBoss()` call (a documented TS limitation for narrowed member access across calls), so
   * reading `this.boss` again in that same scope type-checks as `never`. A fresh method call
   * starts a clean CFA scope, so `this.boss` reads with its real declared type here.
   */
  private applyStartBossPhase(phase: 1 | 2 | 3 | undefined): void {
    const boss = this.boss;
    if (!boss || !phase || phase <= 1) return;
    const ratio = phase === 3 ? BALANCE.boss.phase3_hp_ratio : BALANCE.boss.phase2_hp_ratio;
    boss.currentHp = Math.round(boss.maxHp * ratio);
    boss.phase = phase;
    boss.isInvulnerable = false;
  }

  /**
   * Records damage actually applied to the boss (post-mitigation, i.e. the observed drop in
   * `currentHp`), for the dev-harness DPS readout. See `buildTelemetryFrame` for how these
   * samples are consumed.
   */
  private recordBossDamage(amount: number, time: number): void {
    if (amount <= 0) return;
    this.bossDamageTotal += amount;
    this.bossDamageSamples.push({ t: time, dmg: amount });
  }

  /**
   * Builds the dev-harness telemetry snapshot. Never called (and never even constructed) unless
   * `devOptions.onTelemetryFrame` is set, so production pays no cost for this.
   *
   * bossDps algorithm (a judgment call — the brief left the exact formula open):
   *   - instant: sum of boss damage recorded in the trailing 1-second window, i.e. "DPS right now".
   *     Old samples are pruned every frame so the array never grows past ~1s of hits.
   *   - average: cumulative boss damage dealt so far, divided by seconds elapsed since the boss
   *     spawned. This smooths out burst noise and answers "at this rate, how long until the boss
   *     dies", which is the number that matters for balance iteration.
   */
  private buildTelemetryFrame(time: number): DevTelemetryFrame {
    const windowStart = time - 1000;
    this.bossDamageSamples = this.bossDamageSamples.filter((s) => s.t >= windowStart);
    const bossDpsInstant = this.bossDamageSamples.reduce((sum, s) => sum + s.dmg, 0);
    const fightElapsedS = this.bossFightStartMs !== null ? (time - this.bossFightStartMs) / 1000 : 0;
    const bossDpsAverage = fightElapsedS > 0.001 ? this.bossDamageTotal / fightElapsedS : 0;

    return {
      fps: this.game.loop.actualFps,
      elapsedSeconds: this.elapsedSeconds,
      playerHp: this.player.currentHp,
      playerShield: this.player.currentShield,
      combo: this.scoreCalculator.comboMultiplier,
      score: this.scoreCalculator.currentScore,
      bossHp: this.boss?.currentHp ?? null,
      bossMaxHp: this.boss?.maxHp ?? null,
      bossPhase: this.boss?.phase ?? null,
      bossDpsInstant,
      bossDpsAverage,
      pools: {
        primaryBullets: this.player.weaponSystem.primaryBullets.countActive(true),
        secondaryMissiles: this.player.weaponSystem.secondaryMissiles.countActive(true),
        enemyBullets: this.enemyBullets.countActive(true),
        bossBullets: this.boss?.bullets.countActive(true) ?? 0,
        enemies: this.enemies.countActive(true)
      },
      poolCaps: {
        primaryBullets: BALANCE.pools.primary_bullets,
        secondaryMissiles: BALANCE.pools.secondary_missiles,
        enemyBullets: BALANCE.pools.enemy_bullets,
        bossBullets: BALANCE.pools.boss_bullets,
        enemies: BALANCE.pools.enemies
      }
    };
  }

  private setupBossHud(): void {
    const width = this.scale.width;
    this.bossHudContainer = this.add.container(0, 0);

    const bg = this.add.graphics();
    bg.fillStyle(0x0a0c14, 0.94);
    bg.lineStyle(1.5, 0xff9e0b, 0.8);
    bg.fillRoundedRect(width / 2 - 200, 80, 400, 32, 8);
    bg.strokeRoundedRect(width / 2 - 200, 80, 400, 32, 8);

    this.bossPhaseText = this.add.text(width / 2 - 190, 85, 'FASE 1 // ESCUDO CINÉTICO', {
      fontFamily: '"Google Sans Code", monospace',
      fontSize: '11px',
      color: '#38bdf8'
    });

    this.bossHpNumbersText = this.add.text(width / 2 + 190, 85, `${this.boss?.maxHp.toLocaleString()} / ${this.boss?.maxHp.toLocaleString()} HP`, {
      fontFamily: '"Google Sans Code", monospace',
      fontSize: '11px',
      color: '#ff9e0b'
    }).setOrigin(1, 0);

    this.bossHpBarFill = this.add.rectangle(width / 2 - 194, 98, 388, 10, 0x38bdf8).setOrigin(0, 0);
    this.bossHudContainer.add([bg, this.bossPhaseText, this.bossHpNumbersText, this.bossHpBarFill]);
  }

  private triggerBossDefeated(): void {
    this.isVictory = true;
    this.bossKilledAtSeconds = this.elapsedSeconds;
    audioManager.setBossMode(false);
    audioManager.playVictoryJingle();

    if (this.boss) {
      this.createExplosionFX(this.boss.x, this.boss.y, true);
      this.createExplosionFX(this.boss.x - 70, this.boss.y + 20, true);
      this.createExplosionFX(this.boss.x + 70, this.boss.y + 20, true);
      this.createExplosionFX(this.boss.x, this.boss.y - 40, true);
      this.boss.setActive(false);
      this.boss.setVisible(false);
    }

    this.scoreCalculator.registerKill('boss');
    this.cameras.main.shake(1000, 0.035);

    this.time.delayedCall(1000, () => this.showVictoryOverlay());
  }

  private showVictoryOverlay(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    const mcpCount = this.shipSpec.build_metadata?.selected_mcps?.length || 3;

    const scoreResult = this.scoreCalculator.calculateFinalScore({
      bossDefeated: true,
      remainingTimeSeconds: this.matchTimer,
      remainingHp: this.player.currentHp,
      synergyBonusUnlocked: this.appliedSynergies.length > 0,
      mcpCount
    });

    this.overlayContainer = this.add.container(0, 0);
    const bg = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.88);

    const card = this.add.graphics();
    card.fillStyle(0x0e1117, 0.98);
    card.lineStyle(2, 0x10b981, 0.9);
    card.fillRoundedRect(width / 2 - 240, height / 2 - 200, 480, 400, 20);
    card.strokeRoundedRect(width / 2 - 240, height / 2 - 200, 480, 400, 20);

    const title = this.add.text(width / 2, height / 2 - 150, 'MISSÃO CUMPRIDA!', {
      fontFamily: '"Google Sans Flex", sans-serif',
      fontSize: '30px',
      color: '#10b981'
    }).setOrigin(0.5);

    const subtitle = this.add.text(width / 2, height / 2 - 110, 'CYBER OVERLORD DESTRUÍDO // FORJA SUPREMA', {
      fontFamily: '"Google Sans Code", monospace',
      fontSize: '12px',
      color: '#38bdf8'
    }).setOrigin(0.5);

    const finalScore = this.add.text(
      width / 2,
      height / 2 - 50,
      `PONTUAÇÃO: ${scoreResult.finalScore.toLocaleString()} PTS`,
      {
        fontFamily: '"Google Sans Flex", sans-serif',
        fontSize: '24px',
        color: '#ff9e0b'
      }
    ).setOrigin(0.5);

    const multInfo = scoreResult.mcpMultiplier > 1.0 ? ` (Bônus Especialista: ${scoreResult.mcpMultiplier}x)` : '';
    const breakdown = this.add.text(
      width / 2,
      height / 2 + 25,
      `Combate: ${scoreResult.breakdown.combatScore.toLocaleString()} | Boss: +${scoreResult.breakdown.bossBonus.toLocaleString()}\nTempo: +${scoreResult.breakdown.timeBonus} (${this.matchTimer}s) | HP: +${scoreResult.breakdown.survivalBonus}${multInfo}`,
      {
        fontFamily: '"Google Sans Code", monospace',
        fontSize: '12px',
        color: '#94a3b8',
        align: 'center'
      }
    ).setOrigin(0.5);

    const restartPrompt = this.add.text(width / 2, height / 2 + 140, '▶ PRESSIONE [ ESPAÇO ] PARA O DEBRIEFING', {
      fontFamily: '"Google Sans Code", monospace',
      fontSize: '13px',
      color: '#ffffff'
    }).setOrigin(0.5);

    this.tweens.add({
      targets: restartPrompt,
      alpha: 0.2,
      yoyo: true,
      repeat: -1,
      duration: 500
    });

    this.overlayContainer.add([bg, card, title, subtitle, finalScore, breakdown, restartPrompt]);

    // Auto-transition to Debrief after 3.5s
    this.time.delayedCall(3500, () => {
      this.finishMatchAndTransition();
    });
  }

  private triggerTimeoutEnd(): void {
    this.isGameOver = true;
    this.showGameOverOverlay('TEMPO ESGOTADO', 'SINAL PERDIDO // RECUO TÁTICO');
  }

  private triggerPlayerDeath(): void {
    this.isGameOver = true;
    audioManager.setBossMode(false);
    this.createExplosionFX(this.player.x, this.player.y, true);
    audioManager.playExplosion(true);

    this.player.setActive(false);
    this.player.setVisible(false);

    this.time.delayedCall(500, () => this.showGameOverOverlay('SINAL PERDIDO', 'FUSELAGEM DESTRUÍDA EM COMBATE'));
  }

  private showGameOverOverlay(titleText: string, subtitleText: string): void {
    const width = this.scale.width;
    const height = this.scale.height;
    const mcpCount = this.shipSpec.build_metadata?.selected_mcps?.length || 3;

    const scoreResult = this.scoreCalculator.calculateFinalScore({
      bossDefeated: false,
      remainingTimeSeconds: 0,
      remainingHp: 0,
      synergyBonusUnlocked: this.appliedSynergies.length > 0,
      mcpCount
    });

    this.overlayContainer = this.add.container(0, 0);
    const bg = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.88);

    const card = this.add.graphics();
    card.fillStyle(0x0e1117, 0.98);
    card.lineStyle(2, 0xef4444, 0.8);
    card.fillRoundedRect(width / 2 - 230, height / 2 - 170, 460, 340, 20);
    card.strokeRoundedRect(width / 2 - 230, height / 2 - 170, 460, 340, 20);

    const title = this.add.text(width / 2, height / 2 - 110, titleText, {
      fontFamily: '"Google Sans Flex", sans-serif',
      fontSize: '32px',
      color: '#ef4444'
    }).setOrigin(0.5);

    const subtitle = this.add.text(width / 2, height / 2 - 70, subtitleText, {
      fontFamily: '"Google Sans Code", monospace',
      fontSize: '12px',
      color: '#f87171'
    }).setOrigin(0.5);

    const finalScore = this.add.text(
      width / 2,
      height / 2,
      `PONTUAÇÃO: ${scoreResult.finalScore.toLocaleString()} PTS`,
      {
        fontFamily: '"Google Sans Flex", sans-serif',
        fontSize: '24px',
        color: '#ff9e0b'
      }
    ).setOrigin(0.5);

    const kills = this.add.text(
      width / 2,
      height / 2 + 45,
      `ALVOS ABATIDOS: ${this.scoreCalculator.totalKills} | COMBO: ${this.scoreCalculator.comboMultiplier.toFixed(1)}x`,
      {
        fontFamily: '"Google Sans Code", monospace',
        fontSize: '13px',
        color: '#38bdf8'
      }
    ).setOrigin(0.5);

    const restartPrompt = this.add.text(width / 2, height / 2 + 115, '▶ PRESSIONE [ ESPAÇO ] PARA O DEBRIEFING', {
      fontFamily: '"Google Sans Code", monospace',
      fontSize: '13px',
      color: '#ffffff'
    }).setOrigin(0.5);

    this.tweens.add({
      targets: restartPrompt,
      alpha: 0.2,
      yoyo: true,
      repeat: -1,
      duration: 500
    });

    this.overlayContainer.add([bg, card, title, subtitle, finalScore, kills, restartPrompt]);

    // Auto-transition to Debrief after 3.5s
    this.time.delayedCall(3500, () => {
      this.finishMatchAndTransition();
    });
  }

  private finishMatchAndTransition(): void {
    if (this.hasNotifiedCompletion) return;
    this.hasNotifiedCompletion = true;

    const mcpCount = this.shipSpec.build_metadata?.selected_mcps?.length || 3;
    const scoreResult = this.scoreCalculator.calculateFinalScore({
      bossDefeated: this.isVictory,
      remainingTimeSeconds: this.matchTimer,
      remainingHp: this.player?.currentHp || 0,
      synergyBonusUnlocked: this.appliedSynergies.length > 0,
      mcpCount
    });

    if (this.onMatchComplete) {
      const shotsFired = this.scoreCalculator.shotsFired;
      const shotsHit = this.scoreCalculator.shotsHit;
      this.onMatchComplete({
        finalScore: scoreResult.finalScore,
        victory: this.isVictory,
        breakdown: scoreResult.breakdown,
        telemetry: {
          duration_s: Math.round(this.elapsedSeconds),
          enemies_killed: this.scoreCalculator.totalKills,
          boss_defeated: this.isVictory,
          damage_taken: this.scoreCalculator.damageTakenCount,
          accuracy_pct: shotsFired > 0 ? +((shotsHit / shotsFired) * 100).toFixed(1) : 0,
          shots_fired: shotsFired,
          shots_hit: shotsHit,
          fallback_used: this.shipSpec.build_metadata?.fallback_used === true,
          seed: this.seed,
          boss_ttk_s: this.bossKilledAtSeconds !== null ? +(this.bossKilledAtSeconds - BALANCE.match.boss_spawn_s).toFixed(1) : null
        }
      });
    }
  }

  private createCosmicBackground(): void {
    this.nebulaGraphics = this.add.graphics();
    this.nebulaGraphics.fillStyle(0x07080c, 1);
    this.nebulaGraphics.fillRect(0, 0, this.scale.width, this.scale.height);

    // Deep Aerospace Horizon glow
    const g = this.add.graphics();
    g.fillStyle(0x0e111a, 0.6);
    g.fillCircle(this.scale.width / 2, 200, 260);
    g.fillStyle(0x141824, 0.4);
    g.fillCircle(this.scale.width / 2 - 100, 500, 220);

    this.starfieldGraphics = this.add.graphics();
    this.stars = [];
    for (let i = 0; i < 80; i++) {
      const isFast = this.rng.chance(0.2);
      this.stars.push({
        x: this.rng.between(0, this.scale.width),
        y: this.rng.between(0, this.scale.height),
        speed: isFast ? this.rng.floatBetween(2.5, 4.5) : this.rng.floatBetween(0.5, 1.8),
        size: isFast ? 2 : this.rng.floatBetween(0.8, 1.5),
        alpha: this.rng.floatBetween(0.4, 1.0),
        color: this.rng.chance(0.6) ? 0xffffff : 0x38bdf8
      });
    }
  }

  private setupCollisions(): void {
    // Player Bullets vs Enemies
    this.physics.add.overlap(
      this.player.weaponSystem.primaryBullets,
      this.enemies,
      (bulletObj, enemyObj) => this.handleBulletHitsEnemy(bulletObj, enemyObj)
    );

    // Secondary Missiles vs Enemies. Missiles fill `getData('damage')` the same way
    // primary bullets do (see WeaponSystem.spawnMissile), so the exact same
    // damage/kill/score logic applies unchanged.
    this.physics.add.overlap(
      this.player.weaponSystem.secondaryMissiles,
      this.enemies,
      (missileObj, enemyObj) => this.handleBulletHitsEnemy(missileObj, enemyObj)
    );

    // Secondary EMP bursts vs enemies and boss (see WeaponSystem.triggerEmpBurst).
    this.events.on('secondary-emp-burst', ({ x, y, damage }: { x: number; y: number; damage: number }) =>
      this.handleEmpBurst(x, y, damage)
    );

    // Enemy Bullets vs Player Ship
    this.physics.add.overlap(this.player, this.enemyBullets, (_, bulletObj) => {
      if (this.isGameOver || this.isVictory) return;
      const bullet = bulletObj as Phaser.Physics.Arcade.Sprite;
      bullet.setActive(false);
      bullet.setVisible(false);

      const isDead = this.player.takeDamage(1);
      // See the identical guard on the boss-bullets overlap above: god mode must not corrupt the
      // combo/score telemetry the harness reads.
      if (!this.player.godMode) this.scoreCalculator.registerDamageTaken();
      audioManager.playHit();

      if (isDead) {
        this.triggerPlayerDeath();
      }
    });

    // Enemy Ramming vs Player Ship
    this.physics.add.overlap(this.player, this.enemies, (_, enemyObj) => {
      if (this.isGameOver || this.isVictory) return;
      const enemy = enemyObj as Phaser.Physics.Arcade.Sprite;
      this.createExplosionFX(enemy.x, enemy.y);
      enemy.setActive(false);
      enemy.setVisible(false);

      const isDead = this.player.takeDamage(1);
      // Same god-mode guard as the two overlap handlers above.
      if (!this.player.godMode) this.scoreCalculator.registerDamageTaken();
      audioManager.playHit();

      if (isDead) {
        this.triggerPlayerDeath();
      }
    });
  }

  private handleBulletHitsEnemy(bulletObj: unknown, enemyObj: unknown): void {
    if (this.isGameOver || this.isVictory) return;
    const bullet = bulletObj as Phaser.Physics.Arcade.Sprite;
    const enemy = enemyObj as Phaser.Physics.Arcade.Sprite;
    const damage = (bullet.getData('damage') as number) || 30;

    bullet.setActive(false);
    bullet.setVisible(false);

    let hp = (enemy.getData('hp') as number) || 30;
    hp -= damage;

    if (hp <= 0) {
      this.createExplosionFX(enemy.x, enemy.y);
      enemy.setActive(false);
      enemy.setVisible(false);
      const type = (enemy.getData('type') as 'drone' | 'cruiser') || 'drone';
      this.scoreCalculator.registerKill(type);
      audioManager.playExplosion();
    } else {
      enemy.setData('hp', hp);
      this.createHitSpark(bullet.x, bullet.y);
      audioManager.playHit();
    }
  }

  private handleEmpBurst(x: number, y: number, damage: number): void {
    if (this.isGameOver || this.isVictory) return;
    this.enemies.children.each((enemyObj) => {
      const enemy = enemyObj as Phaser.Physics.Arcade.Sprite;
      if (!enemy.active) return true;
      const distance = Phaser.Math.Distance.Between(x, y, enemy.x, enemy.y);
      const dmg = computeEmpDamage(damage, distance);
      if (dmg <= 0) return true;
      let hp = (enemy.getData('hp') as number) || 30;
      hp -= dmg;
      if (hp <= 0) {
        this.createExplosionFX(enemy.x, enemy.y);
        enemy.setActive(false);
        enemy.setVisible(false);
        const type = (enemy.getData('type') as 'drone' | 'cruiser') || 'drone';
        this.scoreCalculator.registerKill(type);
        audioManager.playExplosion();
      } else {
        enemy.setData('hp', hp);
        audioManager.playHit();
      }
      return true;
    });

    if (this.boss && !this.boss.isDead) {
      const distance = Phaser.Math.Distance.Between(x, y, this.boss.x, this.boss.y);
      const dmg = computeEmpDamage(damage, distance);
      if (dmg > 0) {
        const hpBefore = this.boss.currentHp;
        const isKilled = this.boss.takeDamage(dmg);
        this.recordBossDamage(hpBefore - this.boss.currentHp, this.time.now);
        if (isKilled) this.triggerBossDefeated();
      }
    }
  }

  private createExplosionFX(x: number, y: number, isMajor = false): void {
    const ring = this.add.circle(x, y, 8, isMajor ? 0x38bdf8 : 0xff9e0b, 0.8);
    this.tweens.add({
      targets: ring,
      radius: isMajor ? 90 : 40,
      alpha: 0,
      duration: isMajor ? 450 : 300,
      onComplete: () => ring.destroy()
    });

    const sparkCount = isMajor ? 16 : 6;
    for (let i = 0; i < sparkCount; i++) {
      const spark = this.add.circle(x, y, Phaser.Math.Between(2, 5), isMajor ? 0x38bdf8 : 0xff9e0b, 1);
      const angle = (i / sparkCount) * Math.PI * 2;
      const dist = isMajor ? Phaser.Math.Between(40, 100) : Phaser.Math.Between(25, 50);
      this.tweens.add({
        targets: spark,
        x: x + Math.cos(angle) * dist,
        y: y + Math.sin(angle) * dist,
        alpha: 0,
        scale: 0.2,
        duration: isMajor ? 400 : 250,
        onComplete: () => spark.destroy()
      });
    }
  }

  private createHitSpark(x: number, y: number): void {
    const spark = this.add.circle(x, y, 3, 0x38bdf8, 1);
    this.tweens.add({
      targets: spark,
      scale: 2,
      alpha: 0,
      duration: 120,
      onComplete: () => spark.destroy()
    });
  }

  private setupModernHud(): void {
    const hudBg = this.add.graphics();
    hudBg.fillStyle(0x090b10, 0.94);
    hudBg.lineStyle(1, 0x334155, 0.6);
    hudBg.fillRoundedRect(16, 10, this.scale.width - 32, 64, 12);
    hudBg.strokeRoundedRect(16, 10, this.scale.width - 32, 64, 12);

    // Row 1: Score (Left), Timer (Center), Combo (Right)
    this.hudTextScore = this.add.text(28, 18, 'SCORE: 0', {
      fontFamily: '"Google Sans Code", monospace',
      fontSize: '17px',
      color: '#38bdf8'
    });

    this.hudTextTimer = this.add.text(this.scale.width / 2, 18, `${BALANCE.match.duration_s}s`, {
      fontFamily: '"Google Sans Flex", sans-serif',
      fontSize: '22px',
      color: '#ff9e0b'
    }).setOrigin(0.5, 0);

    this.hudTextCombo = this.add.text(this.scale.width - 140, 18, '1.0x COMBO', {
      fontFamily: '"Google Sans Code", monospace',
      fontSize: '17px',
      color: '#10b981'
    });

    // Row 2: Hull (HP), Shield, and Secondary Weapon Cooldown
    this.add.text(28, 48, 'HULL:', {
      fontFamily: '"Google Sans Code", monospace',
      fontSize: '10px',
      color: '#64748b'
    });

    this.hudHpBars = [];
    const maxHp = this.player.attributes.max_hp;
    for (let i = 0; i < maxHp; i++) {
      const bar = this.add.rectangle(66 + i * 16, 53, 12, 7, 0x10b981);
      this.hudHpBars.push(bar);
    }

    this.add.text(160, 48, 'SHIELD:', {
      fontFamily: '"Google Sans Code", monospace',
      fontSize: '10px',
      color: '#64748b'
    });

    this.hudShieldBars = [];
    const maxShield = this.player.attributes.shield_capacity;
    for (let i = 0; i < 3; i++) {
      const bar = this.add.rectangle(208 + i * 16, 53, 12, 7, 0x38bdf8);
      bar.setVisible(i < maxShield);
      this.hudShieldBars.push(bar);
    }

    // Secondary Weapon Indicator
    this.hudSecondaryLabel = this.add.text(290, 48, '[SHIFT] MÍSSEIS:', {
      fontFamily: '"Google Sans Code", monospace',
      fontSize: '10px',
      color: '#ff9e0b'
    });

    this.hudSecondaryBarBg = this.add.rectangle(400, 53, 60, 7, 0x1e293b).setOrigin(0, 0.5);
    this.hudSecondaryBarFill = this.add.rectangle(400, 53, 60, 7, 0xff9e0b).setOrigin(0, 0.5);

    this.hudSecondaryText = this.add.text(468, 48, 'PRONTO!', {
      fontFamily: '"Google Sans Code", monospace',
      fontSize: '10px',
      color: '#ff9e0b'
    });
  }

  private setupControlsLegend(): void {
    const width = this.scale.width;
    const height = this.scale.height;

    this.controlsLegendContainer = this.add.container(0, 0);

    const barBg = this.add.graphics();
    barBg.fillStyle(0x090b10, 0.88);
    barBg.lineStyle(1, 0x334155, 0.5);
    barBg.fillRoundedRect(width / 2 - 250, height - 28, 500, 22, 6);
    barBg.strokeRoundedRect(width / 2 - 250, height - 28, 500, 22, 6);

    const legendText = this.add.text(
      width / 2,
      height - 17,
      '⌨️  [ WASD / ◀▲▼▶ ] MOVER   •   [ ESPAÇO ] CANHÃO   •   [ SHIFT ] ARMA SECUNDÁRIA',
      {
        fontFamily: '"Google Sans Code", monospace',
        fontSize: '10px',
        color: '#94a3b8'
      }
    ).setOrigin(0.5);

    this.controlsLegendContainer.add([barBg, legendText]);
  }

  update(time: number, delta: number): void {
    this.starfieldGraphics.clear();
    for (const star of this.stars) {
      star.y += star.speed;
      if (star.y > this.scale.height) {
        star.y = -5;
        star.x = this.rng.between(0, this.scale.width);
      }
      this.starfieldGraphics.fillStyle(star.color, star.alpha);
      this.starfieldGraphics.fillCircle(star.x, star.y, star.size);
    }

    if (!this.isGameOver && !this.isVictory && this.player && this.player.active) {
      this.player.update(time, delta);
    }

    if (this.boss && this.boss.active) {
      this.boss.update(time, delta, this.player.x, this.player.y);
      if (this.bossHpBarFill) {
        const pct = Math.max(0, this.boss.currentHp / this.boss.maxHp);
        this.bossHpBarFill.width = 388 * pct;

        if (this.boss.phase === 1) {
          this.bossHpBarFill.setFillStyle(0x38bdf8);
          this.bossPhaseText?.setText('FASE 1 // ESCUDO CINÉTICO');
          this.bossPhaseText?.setColor('#38bdf8');
        } else if (this.boss.phase === 2) {
          this.bossHpBarFill.setFillStyle(0xff9e0b);
          this.bossPhaseText?.setText('FASE 2 // BLINDAGEM REFORÇADA');
          this.bossPhaseText?.setColor('#ff9e0b');
        } else {
          this.bossHpBarFill.setFillStyle(0xef4444);
          this.bossPhaseText?.setText('FASE 3 // NÚCLEO BERSERK');
          this.bossPhaseText?.setColor('#ef4444');
        }

        this.bossHpNumbersText?.setText(
          `${this.boss.currentHp.toLocaleString()} / ${this.boss.maxHp.toLocaleString()} HP`
        );
      }
    }

    // Clean off-screen enemy bullets
    this.enemyBullets.children.iterate((child) => {
      const b = child as Phaser.Physics.Arcade.Sprite;
      if (b && b.active && (b.y > this.scale.height + 30 || b.y < -30 || b.x < -30 || b.x > this.scale.width + 30)) {
        b.setActive(false);
        b.setVisible(false);
      }
      return true;
    });

    // Clean off-screen enemies
    this.enemies.children.iterate((child) => {
      const e = child as Phaser.Physics.Arcade.Sprite;
      if (e && e.active && e.y > this.scale.height + 60) {
        e.setActive(false);
        e.setVisible(false);
      }
      return true;
    });

    if (this.hudTextScore) {
      this.hudTextScore.setText(`SCORE: ${this.scoreCalculator.currentScore.toLocaleString()}`);
      this.hudTextTimer.setText(`${this.matchTimer}s`);
      this.hudTextCombo.setText(`${this.scoreCalculator.comboMultiplier.toFixed(1)}x COMBO`);

      for (let i = 0; i < this.hudHpBars.length; i++) {
        this.hudHpBars[i].setFillStyle(i < this.player.currentHp ? 0x10b981 : 0x334155);
      }

      for (let i = 0; i < this.hudShieldBars.length; i++) {
        this.hudShieldBars[i].setFillStyle(i < this.player.currentShield ? 0x38bdf8 : 0x1e293b);
      }

      // Update Secondary Weapon Cooldown & Status
      if (this.player && this.player.weaponSystem) {
        const sec = this.player.weaponSystem.getSecondaryStatus(time);
        if (sec.isReady) {
          this.hudSecondaryText.setText('PRONTO!');
          this.hudSecondaryText.setColor('#ff9e0b');
          this.hudSecondaryBarFill.width = 60;
          this.hudSecondaryBarFill.setFillStyle(0xff9e0b);
        } else {
          this.hudSecondaryText.setText(`${sec.remainingSec}s`);
          this.hudSecondaryText.setColor('#64748b');
          this.hudSecondaryBarFill.width = 60 * sec.progress;
          this.hudSecondaryBarFill.setFillStyle(0x38bdf8);
        }
      }
    }

    // Dev-harness telemetry stream (Task B4). Only built when a consumer is attached, so
    // production never pays for the pool-size scans or the frame-object allocation.
    if (this.devOptions?.onTelemetryFrame) {
      this.devOptions.onTelemetryFrame(this.buildTelemetryFrame(time));
    }
  }
}
