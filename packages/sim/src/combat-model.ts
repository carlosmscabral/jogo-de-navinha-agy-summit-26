import { BALANCE, ScoreCalculator, SeededRandom, applySynergies, bossPhaseJustReached, resolveFireCadence } from '@jogo/shared';
import type { ShipSpecification } from '@jogo/shared';

/**
 * Discrete-time reimplementation of the engine's combat rules (Spec 09 §5), driven only by
 * `BALANCE`. The golden rule (per the task brief): every number used here has an exact
 * counterpart in the real engine (`BossOverlord.ts`, `WeaponSystem.ts`, `PlayerShip.ts`,
 * `MainGameScene.ts`) — if a value doesn't come from `BALANCE` or from a 1:1 transcription of
 * those files' formulas, it doesn't belong here. `conformance.test.ts` is the check that this
 * transcription is actually faithful.
 */

export interface SimInput {
  spec: ShipSpecification;
  skill: SkillProfile;
  seed: number;
  isHardcore?: boolean;
}

export interface SkillProfile {
  name: 'iniciante' | 'mediano' | 'experiente';
  /** Fração dos projéteis primários que acerta o alvo. */
  accuracy: number;
  /** Fração do tempo em que o jogador está atirando. */
  fireUptime: number;
  /** Probabilidade de ser atingido por segundo, durante a fase de boss. */
  hitsTakenPerSecond: number;
  /** Fração das salvas de secundária que o jogador realmente usa. */
  secondaryUptime: number;
}

export interface SimResult {
  victory: boolean;
  bossTtkSeconds: number | null;
  defeatReason: 'timeout' | 'death' | null;
  damageTaken: number;
  finalScore: number;
  /** Dano real (pós-teto/mitigação/piso) que a arma secundária causou ao boss na partida inteira. */
  secondaryDamageDealt: number;
  /**
   * Dano real total (primária + secundária) causado ao boss na partida inteira -- o mesmo valor
   * que alimenta `bossDamageBonus` em `ScoreBreakdown`. Faltava um total assim mesmo antes desta
   * tarefa: só a fração secundária (`secondaryDamageDealt`) sobrevivia à simulação; a primária
   * (a maioria do dano em toda build real) não tinha equivalente algum.
   */
  bossDamageDealt: number;
  /** Fase mais funda do boss alcançada na simulação (o `duration_s` de 90s sempre excede os 40s de `boss_spawn_s`, então o boss sempre aparece). */
  bossPhaseReached: 1 | 2 | 3;
}

const TICK_MS = 1000 / 60;

/**
 * Fração das pelotas *externas* do `vulcan_spread` que chega a acertar o boss. A pelota central
 * sobe reta e sempre acerta; as outras duas saem a ±`spread_angle` e passam ao lado quando o boss
 * derivou o suficiente na horizontal.
 *
 * Não é um botão de balanceamento e não é um número inventado: é geometria do motor, medida, com
 * duas derivações independentes que concordam. **Medida** (captura de 2026-08-16, preset striker,
 * god mode e disparo automático): 168 pelotas disparadas, 118 acertos. Descontando as ≈11.5 ainda
 * em voo quando o boss morreu (460px a 600px/s são 0.77s, a 5 salvas/s de 3 pelotas), chegaram
 * ≈156.5 e acertaram 75.4%; com a central sempre acertando, `(1 + 2q) / 3 = 0.754` dá `q ≈ 0.63`.
 * **Geométrica**: a 15° e 460px de subida, a pelota externa desloca `460 × tan 15° = 123px`; contra
 * a meia-largura de 150px do corpo do boss, ela erra assim que o boss deriva mais de 27px do eixo
 * da nave, o que numa amplitude de deriva de ±80px dá `q ≈ 0.61`.
 *
 * Fica aqui e não em `BALANCE` de propósito: `BALANCE` é o contrato numérico que o *motor* lê, e o
 * motor não lê isto -- ele produz esse comportamento a partir de `spread_angle`, da velocidade do
 * projétil e da hitbox do boss. Mexer neste valor muda o que o modelo prevê, nunca o que o jogo faz.
 */
export const VULCAN_OUTER_PELLET_HIT_RATE = 0.63;

/**
 * Distância, em pixels, que um projétil primário sobe entre o cano e a borda do boss, na geometria
 * de captura (nave parada no ponto de spawn, boss no ponto de spawn). Transcrição dos literais do
 * motor, com procedência:
 *
 * - tela 600×800 (`main.ts`), nave nasce em `scale.height - 120` = y 680 (`MainGameScene.create`);
 * - boss nasce em y 140 com `body.setSize(300, 140)` centrado, borda inferior em y 210
 *   (`MainGameScene.spawnBoss`, construtor de `BossOverlord`);
 * - o cano fica 20px acima da nave no laser/plasma e 10px no vulcan (`WeaponSystem.firePrimary`);
 * - o overlap dispara na *borda* do projétil: meia-altura 8px na textura de 16px do plasma,
 *   6px na de 12px do vulcan (`initBulletPools`).
 *
 * A oscilação vertical do boss (`BALANCE.boss.hover_range_px`, 2.5 a 4.5px) cabe no arredondamento.
 */
const BOSS_BOTTOM_EDGE_Y = 140 + 140 / 2;
const PRIMARY_TRAVEL_PX = {
  /** 680 - 20 - 8 - 210 */
  laser: 680 - 20 - 8 - BOSS_BOTTOM_EDGE_Y,
  /** 680 - 10 - 6 - 210 */
  vulcan: 680 - 10 - 6 - BOSS_BOTTOM_EDGE_Y
};

/**
 * Tempo de voo do projétil primário, em milissegundos.
 *
 * O modelo não tem projéteis em voo, e por muito tempo isso pareceu barato: o cano dispara na
 * cadência certa e os acertos chegam na cadência certa. O que ele perde é o *primeiro* acerto --
 * uma vez que o cano encheu, cada disparo seguinte chega um intervalo depois do anterior, então o
 * voo custa exatamente uma travessia no TTK total, não uma por tiro.
 *
 * Por ser um atraso uniforme, aplicá-lo como um adiamento do início da cadência é exato, não uma
 * aproximação: tudo o que acontece depois -- inclusive as duas janelas de invulnerabilidade, que
 * começam quando um acerto entra -- desloca junto, e o conjunto de acertos desperdiçado dentro
 * delas é o mesmo.
 *
 * Vale 0.55s a 0.76s conforme a arma. Antes da correção de cadência de 2026-08-16 (Spec 09 §5.9)
 * esse termo estava escondido: os dois erros tinham sinais opostos e se cancelavam por acaso nos
 * lasers. Com a cadência certa nos dois lados, ele virou o resíduo inteiro.
 */
function primaryFlightMs(type: string, bulletSpeed: number): number {
  const travelPx = type === 'vulcan_spread' ? PRIMARY_TRAVEL_PX.vulcan : PRIMARY_TRAVEL_PX.laser;
  return (travelPx / bulletSpeed) * 1000;
}

/** Mirrors the ternary chain `BossOverlord.takeDamage`/`update` use for phase-indexed constants. */
function mitigationForPhase(phase: 1 | 2 | 3): number {
  return phase === 1 ? BALANCE.boss.mitigation.phase1 : phase === 2 ? BALANCE.boss.mitigation.phase2 : BALANCE.boss.mitigation.phase3;
}

/**
 * Espelha `BossOverlord.bulletDamage`. Simplificação assumida: o motor congela o dano no
 * projétil ao disparar, então um tiro da fase 2 que acerta já na fase 3 custa 2, não 3. Este
 * modelo não tem projéteis em voo -- ele cobra o dano da fase corrente no instante do acerto.
 * A diferença só aparece na janela de trânsito de um projétil (< 1s) logo após a transição.
 */
function bossBulletDamageForPhase(phase: 1 | 2 | 3): number {
  return phase === 1
    ? BALANCE.boss.bullet_damage.phase1
    : phase === 2
      ? BALANCE.boss.bullet_damage.phase2
      : BALANCE.boss.bullet_damage.phase3;
}

interface BossState {
  hp: number;
  maxHp: number;
  phase: 1 | 2 | 3;
  invulnMsRemaining: number;
}

/**
 * Applies one incoming hit to the boss, exactly mirroring `BossOverlord.takeDamage` — the single
 * damage entry point for the boss in the real engine. Until 2026-08-16 there was one cap
 * (`max_damage_per_primary_hit`) applied unconditionally regardless of source, which collapsed
 * every secondary-weapon value in its 60-150 schema range down to 45. The engine now picks
 * between `max_damage_per_primary_hit` and `max_damage_per_secondary_hit` by damage source; this
 * function mirrors that choice via the `source` parameter, then applies phase mitigation, then
 * the damage floor. Phase-transition invulnerability blocks the *damage*, not the attempt (fire
 * cadence keeps running underneath it), matching the real engine. Returns the damage actually
 * applied (0 if the boss was invulnerable or already dead).
 */
function applyBossHit(boss: BossState, rawDamage: number, source: 'primary' | 'secondary' = 'primary'): number {
  if (boss.hp <= 0 || boss.invulnMsRemaining > 0) return 0;

  const cap = source === 'secondary'
    ? BALANCE.boss.max_damage_per_secondary_hit
    : BALANCE.boss.max_damage_per_primary_hit;
  const capped = Math.min(cap, rawDamage);
  const mitigation = mitigationForPhase(boss.phase);
  const actual = Math.max(BALANCE.boss.min_damage_per_hit, Math.round(capped * mitigation));
  boss.hp -= actual;

  const hpRatio = boss.hp / boss.maxHp;
  if (boss.phase === 1 && hpRatio <= BALANCE.boss.phase2_hp_ratio) {
    boss.phase = 2;
    boss.invulnMsRemaining = BALANCE.boss.phase_transition_invuln_ms;
  } else if (boss.phase === 2 && hpRatio <= BALANCE.boss.phase3_hp_ratio) {
    boss.phase = 3;
    boss.invulnMsRemaining = BALANCE.boss.phase_transition_invuln_ms;
  }

  return actual;
}

export function simulateMatch(input: SimInput): SimResult {
  const { spec, skill, seed } = input;
  const isHardcore = !!input.isHardcore;
  const rng = new SeededRandom(seed);
  const synergy = applySynergies(spec);
  const { attributes, weapons } = synergy;
  const scoreCalculator = new ScoreCalculator();

  const boss: BossState = {
    hp: isHardcore ? BALANCE.boss.max_hp_hardcore : BALANCE.boss.max_hp,
    maxHp: isHardcore ? BALANCE.boss.max_hp_hardcore : BALANCE.boss.max_hp,
    phase: 1,
    invulnMsRemaining: 0
  };

  let playerShield = attributes.shield_capacity;
  let playerHp = attributes.max_hp;
  let playerInvulnMsRemaining = 0;
  let damageTaken = 0;
  let secondaryDamageTotal = 0;

  /**
   * Espelha `MainGameScene.applyDamageToBoss`: os dois pontos de dano abaixo (pelota primária,
   * míssil secundário) repetiam o mesmo par phaseBefore/applyBossHit/registerBossDamage. Um dano
   * e um bônus de fase registrados aqui usam a MESMA `ScoreCalculator.calculateFinalScore` que a
   * engine real chama -- só o passo a passo do combate é duplicado (a regra documentada no topo
   * deste arquivo), a fórmula de score em si não é.
   */
  function applyBossHitAndScore(rawDamage: number, source: 'primary' | 'secondary' = 'primary'): number {
    const phaseBefore = boss.phase;
    const actual = applyBossHit(boss, rawDamage, source);
    scoreCalculator.registerBossDamage(actual);
    const justReached = bossPhaseJustReached(phaseBefore, boss.phase);
    if (justReached !== null) {
      scoreCalculator.registerBossPhaseReached(justReached);
    }
    return actual;
  }

  const isVulcan = weapons.primary.type === 'vulcan_spread';
  const pelletCount = isVulcan ? BALANCE.weapons.primary.vulcan_pellet_count : 1;
  // WeaponSystem.firePrimary: `Math.round(balancedDamage * vulcan_pellet_factor)` per pellet.
  const perPelletDamage = isVulcan
    ? Math.round(weapons.primary.damage * BALANCE.weapons.primary.vulcan_pellet_factor)
    : weapons.primary.damage;
  const primaryFireIntervalMs = 1000 / weapons.primary.fire_rate;
  const primaryFlightDelayMs = primaryFlightMs(weapons.primary.type, weapons.primary.bullet_speed);

  const secondaryFiresAtAll = weapons.secondary.type !== 'none';
  const secondaryCooldownMs = weapons.secondary.cooldown_seconds * 1000;

  const waveIntervalMs = isHardcore ? BALANCE.match.wave_interval_hardcore_ms : BALANCE.match.wave_interval_ms;

  const durationMs = BALANCE.match.duration_s * 1000;
  const bossSpawnMs = BALANCE.match.boss_spawn_s * 1000;

  // Boss spawn already "due" the instant the fight begins, so the first cadence check fires
  // right away instead of waiting a full interval — matching a player who has been holding fire.
  let lastPrimaryFireMs = -Infinity;
  let lastSecondaryFireMs = -Infinity;
  let preBossWaveClockMs = 0;

  let elapsedMs = 0;
  let victory = false;
  let bossTtkSeconds: number | null = null;
  let defeatReason: 'timeout' | 'death' | null = null;

  while (elapsedMs < durationMs) {
    if (boss.invulnMsRemaining > 0) {
      boss.invulnMsRemaining = Math.max(0, boss.invulnMsRemaining - TICK_MS);
    }
    if (playerInvulnMsRemaining > 0) {
      playerInvulnMsRemaining = Math.max(0, playerInvulnMsRemaining - TICK_MS);
    }

    const bossSpawned = elapsedMs >= bossSpawnMs;

    if (!bossSpawned) {
      // Pre-boss phase: droned waves only need to feed `combatScore` (Step 3, item 7), not model
      // exact spawn geometry. Each wave (Spec 09's V-formation/cruiser-escort/kamikaze squads,
      // see MainGameScene.spawnWaveEnemies) drops roughly 3 targets; accuracy*fireUptime gates
      // how many of those a given skill level actually clears.
      preBossWaveClockMs += TICK_MS;
      if (preBossWaveClockMs >= waveIntervalMs) {
        preBossWaveClockMs -= waveIntervalMs;
        const killChance = skill.accuracy * skill.fireUptime;
        for (let i = 0; i < 3; i++) {
          if (rng.chance(killChance)) {
            scoreCalculator.registerKill('drone');
          }
        }
      }
    } else {
      // Primary cadence. `resolveFireCadence` é literalmente a mesma função que
      // `WeaponSystem.firePrimary` chama -- não uma transcrição dela. O relógio aqui é o do
      // *acerto*, não o do gatilho: o cano começa a cuspir no instante em que o boss aparece, mas
      // a primeira pelota só chega uma travessia depois (ver `primaryFlightMs`).
      const firstHitDueMs = bossSpawnMs + primaryFlightDelayMs;
      const nextPrimaryAnchor =
        elapsedMs >= firstHitDueMs
          ? resolveFireCadence(lastPrimaryFireMs, elapsedMs, primaryFireIntervalMs)
          : null;
      if (nextPrimaryAnchor !== null) {
        lastPrimaryFireMs = nextPrimaryAnchor;
        for (let p = 0; p < pelletCount; p++) {
          if (boss.hp <= 0) break;
          if (!rng.chance(skill.accuracy * skill.fireUptime)) continue;
          // A central (p === 0) sobe reta; as externas ainda precisam pegar o boss onde ele está.
          // Só o `vulcan_spread` tem mais de uma pelota, então isto não toca laser nem plasma.
          if (p > 0 && !rng.chance(VULCAN_OUTER_PELLET_HIT_RATE)) continue;
          applyBossHitAndScore(perPelletDamage);
        }
      }

      // Secondary cadence. Mirrors WeaponSystem.fireSecondary: the cooldown resets whenever
      // type !== 'none', even for types with no boss-damage effect -- `fireSecondary` has no
      // `else` branch. `SecondaryWeaponType` is now just 'homing_missiles' | 'emp_burst' | 'none'
      // (`drone_escort` was removed from the type entirely, not just from this model), and 'none'
      // is already excluded by `secondaryFiresAtAll` above, so the two branches below are
      // exhaustive for every type reachable here.
      // Carimba o instante do tique, espelhando `WeaponSystem.fireSecondary` -- que de propósito
      // *não* usa `resolveFireCadence`, porque a recarga de uma habilidade conta a partir do uso.
      if (boss.hp > 0 && secondaryFiresAtAll && elapsedMs - lastSecondaryFireMs >= secondaryCooldownMs) {
        lastSecondaryFireMs = elapsedMs;
        if (rng.chance(skill.secondaryUptime)) {
          if (weapons.secondary.type === 'homing_missiles') {
            // WeaponSystem.fireSecondary spawns missile_count_per_volley independent missiles,
            // each hitting the boss through its own BossOverlord.takeDamage call -- independently
            // capped, mitigated and floored, not one combined hit.
            for (let m = 0; m < BALANCE.weapons.secondary.missile_count_per_volley; m++) {
              if (boss.hp <= 0) break;
              secondaryDamageTotal += applyBossHitAndScore(weapons.secondary.damage, 'secondary');
            }
          }
          // `emp_burst` (and any other type): zero boss damage. `computeEmpDamage` falls off to
          // exactly zero beyond `emp_radius_px` (300px) from the blast center, and this model has
          // no player-position simulation at all -- the player's realistic default distance from
          // the boss is far outside that radius, so EMP-vs-boss is faithfully zero here. EMP is a
          // real, working area weapon against nearby regular enemies, just not against a boss
          // that stays far up-screen. Documented simplification ("no spatial simulation"), not an
          // invented balance number.
        }
      }

      if (boss.hp <= 0) {
        victory = true;
        bossTtkSeconds = +((elapsedMs - bossSpawnMs) / 1000).toFixed(1);
        // Mirrors MainGameScene.triggerBossDefeated: the boss kill itself earns combo-scaled
        // combatScore points (BALANCE.score.points.boss), on top of calculateFinalScore's
        // separate flat `boss_bonus` below. Two additive terms in the real engine, not one.
        scoreCalculator.registerKill('boss');
        break;
      }

      // Incoming fire, abstracted per the skill profile (only modeled during the boss fight).
      if (playerInvulnMsRemaining <= 0 && rng.chance(skill.hitsTakenPerSecond / 60)) {
        damageTaken += 1;
        scoreCalculator.registerDamageTaken();
        if (playerShield > 0) {
          // Espelha PlayerShip.takeDamage: o escudo absorve o acerto inteiro, 1 pip, seja qual
          // for o dano do projétil.
          playerShield -= 1;
        } else {
          playerHp = Math.max(0, playerHp - bossBulletDamageForPhase(boss.phase));
        }
        playerInvulnMsRemaining = BALANCE.player.invulnerability_ms;

        if (playerHp <= 0) {
          defeatReason = 'death';
          break;
        }
      }
    }

    elapsedMs += TICK_MS;
  }

  if (!victory && defeatReason === null) {
    defeatReason = 'timeout';
  }

  const remainingTimeSeconds = victory ? Math.max(0, BALANCE.match.duration_s - elapsedMs / 1000) : 0;
  const scoreResult = scoreCalculator.calculateFinalScore({
    bossDefeated: victory,
    remainingTimeSeconds,
    // MainGameScene.finishMatchAndTransition passes `this.player?.currentHp || 0` unconditionally
    // -- ScoreCalculator's survivalBonus has no bossDefeated guard, so a ship that survives to
    // timeout with HP left genuinely earns it in the real game. `playerHp` already reads 0 on
    // death (the loop breaks the instant it hits 0) and the real remaining value otherwise, so no
    // `victory ?` conditional belongs here at all.
    remainingHp: playerHp,
    synergyBonusUnlocked: synergy.applied.length > 0,
    mcpCount: spec.build_metadata?.selected_mcps?.length ?? 3,
    bossMaxHp: boss.maxHp
  });

  return {
    victory,
    bossTtkSeconds,
    defeatReason: victory ? null : defeatReason,
    damageTaken,
    finalScore: scoreResult.finalScore,
    secondaryDamageDealt: secondaryDamageTotal,
    bossDamageDealt: scoreCalculator.bossDamageDealt,
    // Vem de `scoreCalculator`, não de `boss.phase` direto: os dois deveriam sempre concordar (a
    // flag só é marcada quando `boss.phase` muda), mas ler daqui é ler exatamente o que alimentou
    // `bossPhaseBonus` em `finalScore` -- se um dia divergirem, é porque o registro quebrou, e é
    // isso que se quer detectar. `duration_s` (90s) sempre excede `boss_spawn_s` (40s), então toda
    // partida simulada alcança pelo menos a fase 1.
    bossPhaseReached: scoreCalculator.deepestBossPhaseReached
  };
}

// --- Matrix runner -----------------------------------------------------------------------------

export interface SimMatrixCell {
  archetype: string;
  skill: string;
  samples: number;
  winRate: number;
  /** null when zero victories were observed for this cell. */
  ttkP50: number | null;
  ttkP90: number | null;
  avgDamageTaken: number;
  avgScore: number;
  /** Share of the *losses* (not all samples) that ended in each way. 0 when there were no losses. */
  timeoutShareOfLosses: number;
  deathShareOfLosses: number;
  /** Average (across the cell's seeds) real damage the secondary weapon dealt to the boss. */
  secondaryDamageDealt: number;
  /** Read directly from the archetype's spec (`weapons.secondary.type`), not simulated. */
  secondaryType: string;
}

export interface SimMatrix {
  generatedAt: string;
  seedCount: number;
  cells: SimMatrixCell[];
  /**
   * Mean `winRate` across only the `mediano`-skill cells (one value per archetype, averaged) --
   * matches the scope of the other CI gate checks, which are explicitly `mediano`-only, and
   * represents "the typical booth visitor" the 15-25% balance target is calibrated for.
   */
  aggregateWinRate: number;
}

/** Balance-gate target band for `aggregateWinRate` (Spec 09 §5.3), inherited from Spec 04 §7. */
export const WIN_RATE_TARGET = { min: 0.15, max: 0.25 };

/** Balance-gate ceiling for the win-rate spread between the best and worst archetype, in percentage points. */
export const MAX_ARCHETYPE_SPREAD_PP = 35;

function percentile(sortedAscending: number[], p: number): number | null {
  if (sortedAscending.length === 0) return null;
  const idx = Math.min(sortedAscending.length - 1, Math.floor(p * sortedAscending.length));
  return sortedAscending[idx];
}

/**
 * Runs every (archetype × skill × seed) combination and aggregates the results. Deliberately
 * takes its inputs as parameters rather than importing `ARCHETYPES`/`SKILL_PROFILES` directly, so
 * this module stays generic — `archetypes.ts` (concrete data) depends on `combat-model.ts` (the
 * model), never the other way around.
 */
export function runMatrix(options: {
  archetypes: Record<string, ShipSpecification>;
  skills: Record<string, SkillProfile>;
  seeds: number[];
  isHardcore?: boolean;
}): SimMatrix {
  const cells: SimMatrixCell[] = [];

  for (const [archetypeName, spec] of Object.entries(options.archetypes)) {
    for (const [skillName, skill] of Object.entries(options.skills)) {
      const ttks: number[] = [];
      let wins = 0;
      let timeouts = 0;
      let deaths = 0;
      let damageSum = 0;
      let scoreSum = 0;
      let secondaryDamageSum = 0;

      for (const seed of options.seeds) {
        const result = simulateMatch({ spec, skill, seed, isHardcore: options.isHardcore });
        if (result.victory) {
          wins += 1;
          if (result.bossTtkSeconds !== null) ttks.push(result.bossTtkSeconds);
        } else if (result.defeatReason === 'timeout') {
          timeouts += 1;
        } else if (result.defeatReason === 'death') {
          deaths += 1;
        }
        damageSum += result.damageTaken;
        scoreSum += result.finalScore;
        secondaryDamageSum += result.secondaryDamageDealt;
      }

      ttks.sort((a, b) => a - b);
      const losses = timeouts + deaths;

      cells.push({
        archetype: archetypeName,
        skill: skillName,
        samples: options.seeds.length,
        winRate: wins / options.seeds.length,
        ttkP50: percentile(ttks, 0.5),
        ttkP90: percentile(ttks, 0.9),
        avgDamageTaken: damageSum / options.seeds.length,
        avgScore: scoreSum / options.seeds.length,
        timeoutShareOfLosses: losses > 0 ? timeouts / losses : 0,
        deathShareOfLosses: losses > 0 ? deaths / losses : 0,
        secondaryDamageDealt: secondaryDamageSum / options.seeds.length,
        secondaryType: spec.weapons.secondary.type
      });
    }
  }

  const medianCells = cells.filter((c) => c.skill === 'mediano');
  const aggregateWinRate = medianCells.reduce((sum, c) => sum + c.winRate, 0) / medianCells.length;

  return {
    generatedAt: new Date().toISOString(),
    seedCount: options.seeds.length,
    cells,
    aggregateWinRate
  };
}
