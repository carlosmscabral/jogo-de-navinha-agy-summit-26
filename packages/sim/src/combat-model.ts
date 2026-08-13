import { BALANCE, ScoreCalculator, SeededRandom, applySynergies } from '@jogo/shared';
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
}

const TICK_MS = 1000 / 60;

/** Mirrors the ternary chain `BossOverlord.takeDamage`/`update` use for phase-indexed constants. */
function mitigationForPhase(phase: 1 | 2 | 3): number {
  return phase === 1 ? BALANCE.boss.mitigation.phase1 : phase === 2 ? BALANCE.boss.mitigation.phase2 : BALANCE.boss.mitigation.phase3;
}

interface BossState {
  hp: number;
  maxHp: number;
  phase: 1 | 2 | 3;
  invulnMsRemaining: number;
}

/**
 * Applies one incoming hit to the boss, exactly mirroring `BossOverlord.takeDamage`: a per-pellet
 * cap (only for primary-weapon hits — D13/the `max_damage_per_primary_hit` comment in balance.ts),
 * then phase mitigation, then the damage floor. Phase-transition invulnerability blocks the
 * *damage*, not the attempt (fire cadence keeps running underneath it), matching the real engine.
 * Returns the damage actually applied (0 if the boss was invulnerable or already dead).
 */
function applyBossHit(boss: BossState, rawDamage: number, capPerHit: boolean): number {
  if (boss.hp <= 0 || boss.invulnMsRemaining > 0) return 0;

  const capped = capPerHit ? Math.min(BALANCE.boss.max_damage_per_primary_hit, rawDamage) : rawDamage;
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

  const isVulcan = weapons.primary.type === 'vulcan_spread';
  const pelletCount = isVulcan ? BALANCE.weapons.primary.vulcan_pellet_count : 1;
  const perPelletDamage = isVulcan
    ? weapons.primary.damage * BALANCE.weapons.primary.vulcan_pellet_factor
    : weapons.primary.damage;
  const primaryFireIntervalMs = 1000 / weapons.primary.fire_rate;

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
      // Primary cadence.
      if (elapsedMs - lastPrimaryFireMs >= primaryFireIntervalMs) {
        lastPrimaryFireMs = elapsedMs;
        for (let p = 0; p < pelletCount; p++) {
          if (boss.hp <= 0) break;
          if (rng.chance(skill.accuracy * skill.fireUptime)) {
            applyBossHit(boss, perPelletDamage, true);
          }
        }
      }

      // Secondary cadence — no per-hit cap (D13), same phase mitigation.
      if (boss.hp > 0 && secondaryFiresAtAll && elapsedMs - lastSecondaryFireMs >= secondaryCooldownMs) {
        lastSecondaryFireMs = elapsedMs;
        if (rng.chance(skill.secondaryUptime)) {
          applyBossHit(boss, weapons.secondary.damage, false);
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
          playerShield -= 1;
        } else {
          playerHp -= 1;
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
    remainingHp: victory ? playerHp : 0,
    synergyBonusUnlocked: synergy.applied.length > 0,
    mcpCount: spec.build_metadata?.selected_mcps?.length ?? 3
  });

  return {
    victory,
    bossTtkSeconds,
    defeatReason: victory ? null : defeatReason,
    damageTaken,
    finalScore: scoreResult.finalScore
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
}

export interface SimMatrix {
  generatedAt: string;
  seedCount: number;
  cells: SimMatrixCell[];
}

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
        deathShareOfLosses: losses > 0 ? deaths / losses : 0
      });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    seedCount: options.seeds.length,
    cells
  };
}
