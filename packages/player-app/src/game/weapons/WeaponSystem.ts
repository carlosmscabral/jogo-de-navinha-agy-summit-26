import Phaser from 'phaser';
import { BALANCE, ShipWeapons, PrimaryWeaponType, SecondaryWeaponType, resolveFireCadence } from '@jogo/shared';
import { despawnPooled, respawnPooled } from '../objects/pooled-body.js';
import { audioManager } from '../audio/AudioManager.js';

export class WeaponSystem {
  scene: Phaser.Scene;
  weaponsSpec: ShipWeapons;
  // "Nunca disparou" precisa ser um instante *inalcançável*. O relógio que a cena entrega
  // (`worldTimeMs`, Spec 09 §5.10) começa em zero, então uma âncora `0` colide com o quadro
  // zero real e cala as duas armas por uma recarga inteira no começo da partida. O idioma da
  // casa é a âncora não-finita -- ver a doc de `resolveFireCadence` e as duas âncoras de
  // `combat-model.ts`, que já nascem em -Infinity.
  lastPrimaryFireTime = -Infinity;
  lastSecondaryFireTime = -Infinity;

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

    // A textura do laser é de 16x16 como a do plasma, e isso **não** é escolha estética:
    // `PRIMARY_TRAVEL_PX.laser` (`packages/sim/src/combat-model.ts:88-93`) subtrai 8px de
    // meia-altura para saber a que distância o overlap com o boss dispara, e o comentário de lá
    // amarra esse 8 à "textura de 16px do plasma". Mudar a altura aqui desalinharia o simulador do
    // motor em silêncio: o balanceamento passaria a ser validado contra um jogo que não existe.
    // A diferença é de forma e matiz dentro do mesmo canvas -- feixe fino e claro contra orbe
    // grosso e saturado.
    if (!this.scene.textures.exists('bullet_laser')) {
      const g = this.scene.add.graphics();
      g.fillStyle(0x7dd3fc, 1);
      g.fillRect(6, 0, 4, 16);
      g.fillStyle(0xffffff, 1);
      g.fillRect(7, 1, 2, 14);
      g.generateTexture('bullet_laser', 16, 16);
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

  /**
   * Textura do projétil primário, por tipo.
   *
   * Havia duas texturas para três tipos até 2026-09-01: os ramos `laser` e `plasma` de
   * `firePrimary` eram a mesma linha, caractere por caractere, e um playtest reportou "as duas
   * armas parecem exatamente iguais, só vejo bolas azuis". A **mecânica** estava certa -- a
   * Spec 04 (`specs/04_GAME_ENGINE_AND_MECHANICS_SPEC.md:100`) manda que laser e plasma disparem
   * um projétil por ciclo com o dano cheio, e a diferença real vive nos números que o MCP escreve
   * (25 de dano a 750 px/s contra 35 a 650). O que faltava era essa diferença **aparecer**.
   *
   * As três texturas ficam na família fria de propósito. A alternativa considerada era tingir o
   * projétil com a cor de destaque escolhida no Fast-Grill-Me, e ela foi descartada: a bala
   * inimiga é um círculo vermelho (`MainGameScene.ts:218`, `0xef4444`) e `vermelho_sangue` é uma
   * das seis cores do menu. Quem escolhesse vermelho passaria a partida sem distinguir o próprio
   * tiro do tiro que o mata. Cor é o canal de amigo-contra-inimigo; a identidade da arma vai na
   * forma.
   */
  static primaryBulletTexture(type: PrimaryWeaponType): string {
    if (type === 'vulcan_spread') return 'bullet_vulcan';
    return type === 'laser' ? 'bullet_laser' : 'bullet_plasma';
  }

  /**
   * Timbre do disparo primário, por tipo.
   *
   * `AudioManager.playLaser` (`../audio/AudioManager.ts:262`) já tinha os três timbres escritos e
   * **nenhum call-site** -- a diferenciação sonora existia pronta e nunca foi ligada. O nome do
   * timbre do vulcan é `'vulcan'`, não `'vulcan_spread'`: o `AudioManager` não conhece
   * `PrimaryWeaponType`, e é esta função que faz a tradução em vez de vazar o enum para lá.
   */
  static primaryAudioTimbre(type: PrimaryWeaponType): 'laser' | 'plasma' | 'vulcan' {
    if (type === 'vulcan_spread') return 'vulcan';
    return type === 'laser' ? 'laser' : 'plasma';
  }

  firePrimary(x: number, y: number, time: number): boolean {
    // [D14] fire_rate já chega validado pelo schema (5 a 12 -- ver BALANCE.ranges);
    // reclampar aqui seria o próprio bug que a Tarefa B2 elimina.
    const effectiveFireRate = this.weaponsSpec.primary.fire_rate;
    const fireIntervalMs = 1000 / effectiveFireRate;

    const nextAnchor = resolveFireCadence(this.lastPrimaryFireTime, time, fireIntervalMs);
    if (nextAnchor === null) {
      return false;
    }
    this.lastPrimaryFireTime = nextAnchor;

    const { type, damage, bullet_speed, spread_angle } = this.weaponsSpec.primary;
    // [D14] damage/bullet_speed já chegam validados pelo schema (15 a 45 / 400 a 800);
    // os valores chegam intactos.
    const balancedDamage = damage;
    const speed = bullet_speed;

    let projectiles = 1;

    const texture = WeaponSystem.primaryBulletTexture(type);

    if (type === 'laser') {
      // Feixe único e veloz: mesmo cano e mesma cadência do plasma, projétil mais rápido e mais
      // fraco. A diferença de aparência vem da textura, não deste ramo.
      this.spawnBullet(x, y - 20, 0, -speed, texture, balancedDamage);
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
        this.spawnBullet(x, y - 10, vx, vy, texture, spreadDamage);
      }
      projectiles = angles.length;
    } else {
      // Plasma cannon
      this.spawnBullet(x, y - 20, 0, -speed, texture, balancedDamage);
    }

    // Depois de gastar o portão de cadência, nunca antes: um `firePrimary` recusado sai pelo
    // `return false` lá em cima e não pode soar. Sem isso o motor grita a cada quadro em que o
    // gatilho está apertado, e não a cada tiro.
    audioManager.playLaser(WeaponSystem.primaryAudioTimbre(type));

    this.onPrimaryShotsFired?.(projectiles);

    return true;
  }

  /**
   * Tipo efetivo da secundária. Uma spec sem o bloco `secondary` é tratada como `'none'`, e não
   * como míssil: `agy` pode montar uma nave sem secundária (`weapons-arsenal` emite `'none'`), e
   * o antigo default `'homing_missiles'` de `getSecondaryStatus` fazia o HUD anunciar uma arma
   * que `fireSecondary` recusa na primeira linha. Os dois métodos leem daqui para não poderem
   * discordar.
   */
  private get secondaryType(): SecondaryWeaponType {
    return this.weaponsSpec.secondary?.type ?? 'none';
  }

  fireSecondary(x: number, y: number, time: number, targets?: Phaser.GameObjects.Sprite[]): boolean {
    if (this.secondaryType === 'none') return false;

    const cooldownMs = (this.weaponsSpec.secondary?.cooldown_seconds || 2) * 1000;
    if (time - this.lastSecondaryFireTime < cooldownMs) {
      return false;
    }
    // De propósito carimba o instante do quadro, ao contrário de `firePrimary`: a secundária é uma
    // habilidade com recarga, acionada a dedo no `SHIFT`, e a recarga conta a partir do *uso*.
    // Avançar a âncora por múltiplos exatos guardaria crédito para quem esperou demais, soltando
    // dois tiros em quadros seguidos. E o erro de quadro que motivou `resolveFireCadence` vale
    // 17ms numa recarga de 2000ms -- 0.05%, contra os 4 a 8% que ele custa na primária.
    this.lastSecondaryFireTime = time;

    const { type, damage } = this.weaponsSpec.secondary;
    // [D14] damage já chega validado pelo schema (60 a 150); o valor chega intacto.
    const balancedDamage = damage;

    if (type === 'homing_missiles') {
      // As duas saem lado a lado do mesmo lançador, então travam no mesmo alvo -- é o que "duas
      // saem juntas contra a ameaça mais próxima" quer dizer num volley de 2.
      const target = pickNearestTarget(x, y, targets);
      this.spawnMissile(x - 20, y, -BALANCE.weapons.secondary.missile_speed_x, BALANCE.weapons.secondary.missile_speed_y, balancedDamage, target);
      this.spawnMissile(x + 20, y, BALANCE.weapons.secondary.missile_speed_x, BALANCE.weapons.secondary.missile_speed_y, balancedDamage, target);
      audioManager.playSecondary('missile');
    } else if (type === 'emp_burst') {
      this.triggerEmpBurst(x, y, balancedDamage);
      audioManager.playSecondary('emp');
    }

    // A única confirmação de que o SHIFT surtiu efeito, para os dois tipos de secundária -- sem
    // isso a pista mais visível é a recarga começando a contar, fácil de não notar num toque só.
    // `?.` porque os testes de cadência montam uma cena sem `events`.
    this.scene.events?.emit('secondary-weapon-fired', { type });

    return true;
  }

  getSecondaryStatus(time: number): { isReady: boolean; progress: number; remainingSec: number; type: SecondaryWeaponType } {
    const type = this.secondaryType;

    // Sem secundária não existe recarga para exibir. Sem este ramo o cálculo de cadência abaixo
    // devolvia `isReady: true` do primeiro ao último quadro -- a barra ficava cheia a partida
    // inteira anunciando uma arma que `fireSecondary` recusa. É exatamente o sintoma "barra cheia,
    // SHIFT não faz nada", só que permanente.
    if (type === 'none') {
      return { isReady: false, progress: 0, remainingSec: 0, type };
    }

    const cooldownMs = (this.weaponsSpec.secondary?.cooldown_seconds || 2) * 1000;
    const elapsed = time - this.lastSecondaryFireTime;
    // Sem cláusula especial para "nunca disparou": a âncora não-finita já entrega
    // `elapsed === Infinity`. Tratar `=== 0` como sentinela aqui, além de duplicar a regra que
    // `fireSecondary` aplica, mentia ao contrário depois de um disparo legítimo no quadro zero.
    const isReady = elapsed >= cooldownMs;
    const progress = isReady ? 1.0 : Math.min(1.0, Math.max(0, elapsed / cooldownMs));
    const remainingSec = isReady ? 0 : Math.ceil((cooldownMs - elapsed) / 1000);

    return { isReady, progress, remainingSec, type };
  }

  private spawnBullet(x: number, y: number, vx: number, vy: number, texture: string, damage: number): void {
    const bullet = this.primaryBullets.get(x, y, texture) as Phaser.Physics.Arcade.Sprite;
    if (bullet) {
      bullet.setData('damage', damage);
      respawnPooled(bullet, x, y, vx, vy);
    }
  }

  private spawnMissile(x: number, y: number, vx: number, vy: number, damage: number, target?: Phaser.GameObjects.Sprite): void {
    const missile = this.secondaryMissiles.get(x, y, 'missile_tex') as Phaser.Physics.Arcade.Sprite;
    if (missile) {
      missile.setData('damage', damage);
      // Lido por `steerMissile` a cada quadro. Sem alvo (nenhum inimigo vivo no lançamento), o
      // míssil voa reto -- mesmo comportamento de sempre, só que agora por falta de alvo, não por
      // falta de implementação.
      missile.setData('target', target);
      respawnPooled(missile, x, y, vx, vy);
    }
  }

  /**
   * Gira a velocidade do míssil em direção ao alvo travado no lançamento, no máximo
   * `missile_turn_rate_rad_s` por segundo, preservando a velocidade escalar. Um alvo que morreu
   * ou saiu de cena no meio do voo (`!target.active`) deixa o míssil na reta que já estava --
   * comportamento correto de "perdeu o sinal", não um crash por acessar posição de algo destruído.
   */
  private steerMissile(missile: Phaser.Physics.Arcade.Sprite, deltaMs: number): void {
    const target = missile.getData('target') as Phaser.GameObjects.Sprite | undefined;
    const body = missile.body as Phaser.Physics.Arcade.Body | null;
    if (!target || !target.active || !body) return;

    const currentAngle = body.velocity.angle();
    const desiredAngle = Phaser.Math.Angle.Between(missile.x, missile.y, target.x, target.y);
    const maxTurnRad = BALANCE.weapons.secondary.missile_turn_rate_rad_s * (deltaMs / 1000);
    const newAngle = Phaser.Math.Angle.RotateTo(currentAngle, desiredAngle, maxTurnRad);

    body.velocity.setToPolar(newAngle, body.speed);
  }

  private triggerEmpBurst(x: number, y: number, damage: number): void {
    // O anel antigo (alpha 0.4, sem borda, sem som) era fácil de perder em cima do resto da tela
    // de combate -- e sem nenhum retorno, apertar SHIFT parecia não ter feito nada. A borda clara
    // e o alpha maior dão ao anel um perfil que se destaca mesmo contra a espiral do boss.
    const ring = this.scene.add.circle(x, y, 10, 0x38bdf8, 0.55);
    ring.setStrokeStyle(4, 0xbae6fd, 0.95);
    this.scene.tweens.add({
      targets: ring,
      radius: BALANCE.weapons.secondary.emp_radius_px,
      alpha: 0,
      duration: 500,
      onComplete: () => ring.destroy()
    });
    this.scene.events.emit('secondary-emp-burst', { x, y, damage });
  }

  update(deltaMs = 0): void {
    // Clean out of bounds bullets
    this.primaryBullets.children.iterate((child) => {
      const b = child as Phaser.Physics.Arcade.Sprite;
      if (b && b.active && (b.y < -50 || b.y > 900 || b.x < -50 || b.x > 850)) {
        despawnPooled(b);
      }
      return true;
    });

    // Corrige o curso dos mísseis a caminho, antes da limpeza de fora de tela abaixo -- um míssil
    // que acabou de virar na direção certa não deve ser despachado no mesmo quadro por um teste de
    // fronteira que ainda reflete a posição de antes da curva.
    this.secondaryMissiles.children.iterate((child) => {
      const m = child as Phaser.Physics.Arcade.Sprite;
      if (m && m.active) {
        this.steerMissile(m, deltaMs);
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
 * Alvo ativo mais próximo do ponto de lançamento, ou `undefined` se `targets` estiver vazio ou
 * só tiver entradas já inativas (drone morto no mesmo quadro do disparo, por exemplo). Pura de
 * propósito -- sem isso o teste de cadência precisaria de sprites Phaser reais só para exercitar
 * `fireSecondary`.
 */
export function pickNearestTarget(x: number, y: number, targets?: Phaser.GameObjects.Sprite[]): Phaser.GameObjects.Sprite | undefined {
  if (!targets) return undefined;
  let nearest: Phaser.GameObjects.Sprite | undefined;
  let nearestDistSq = Infinity;
  for (const candidate of targets) {
    if (!candidate.active) continue;
    const dx = candidate.x - x;
    const dy = candidate.y - y;
    const distSq = dx * dx + dy * dy;
    if (distSq < nearestDistSq) {
      nearestDistSq = distSq;
      nearest = candidate;
    }
  }
  return nearest;
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
