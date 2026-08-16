import { BALANCE } from '../constants/balance.js';
import type { ScoreBreakdown } from '../types/ship.js';

/**
 * Decide se uma transição de fase acabou de acontecer entre dois instantes do boss, a partir só
 * de `phase` antes/depois de um hit -- sem tocar `BossOverlord` nem `BossState` (o tipo espelho
 * do simulador). A fase nunca regride (`triggerPhaseTransition` só recebe 2 ou 3), então a única
 * forma de `phaseAfter` diferir de `phaseBefore` é ter avançado; a engine (`MainGameScene.
 * applyDamageToBoss`) e o simulador (`combat-model.ts`'s `applyBossHitAndScore`) chamavam essa
 * mesma checagem duplicada em cada um dos pontos de dano antes desta função existir -- exatamente
 * a duplicação de regra de combate que este monorepo tenta evitar (ver a doc de `fire-cadence.ts`).
 */
export function bossPhaseJustReached(phaseBefore: 1 | 2 | 3, phaseAfter: 1 | 2 | 3): 2 | 3 | null {
  if (phaseAfter === phaseBefore) return null;
  return phaseAfter === 2 || phaseAfter === 3 ? phaseAfter : null;
}

export class ScoreCalculator {
  currentScore = 0;
  comboMultiplier = 1.0;
  totalKills = 0;
  damageTakenCount = 0;
  shotsFired = 0;
  shotsHit = 0;
  /** Dano real (pós-teto/mitigação/piso) acumulado contra o boss, de qualquer fonte. Alimenta `bossDamageBonus`. */
  bossDamageDealt = 0;
  /** Uma vez `true`, fica `true` pelo resto da partida -- é um marco alcançado, não um estado atual. */
  bossPhase2Reached = false;
  bossPhase3Reached = false;

  registerKill(enemyType: 'drone' | 'cruiser' | 'boss'): number {
    // enemyType is widened by an unsound cast at the MainGameScene call site (enemy sprite data is
    // read back as `any`), so a runtime value outside the declared union (e.g. 'kamikaze') can reach
    // here despite the type annotation. BALANCE.score.points has no entry for such values, so fall
    // back to the drone rate -- the same value the pre-B1 fall-through `if` chain gave anything that
    // wasn't explicitly 'cruiser' or 'boss'. Do NOT add a 'kamikaze' key to BALANCE.score.points: that
    // would be a new scoring tier, a design decision outside this refactor's scope.
    const basePoints = BALANCE.score.points[enemyType] ?? BALANCE.score.points.drone;
    const earned = Math.round(basePoints * this.comboMultiplier);
    this.currentScore += earned;
    this.totalKills += 1;
    this.comboMultiplier = Math.min(
      BALANCE.score.combo_max,
      +(this.comboMultiplier + BALANCE.score.combo_step).toFixed(2)
    );
    return earned;
  }

  registerDamageTaken(): void {
    this.damageTakenCount += 1;
    this.comboMultiplier = 1.0; // Reset combo streak
  }

  /**
   * Um projétil da arma PRIMÁRIA saiu do cano. `count` existe por causa do `vulcan_spread`, que
   * dispara `vulcan_pellet_count` pelotas por acionamento: cada pelota é um projétil independente,
   * com corpo e colisão próprios, então cada uma conta como um tiro.
   *
   * A secundária (mísseis, EMP) fica fora de propósito. `accuracy_pct` é a pontaria da arma que o
   * jogador aponta segurando o gatilho; míssil teleguiado e explosão em área não medem pontaria, e
   * misturá-los tornaria o número incomparável entre builds com secundárias diferentes.
   */
  registerShotsFired(count = 1): void {
    this.shotsFired += count;
  }

  /** Um projétil da arma primária encostou em algo que recebe dano (boss ou inimigo comum). */
  registerShotHit(): void {
    this.shotsHit += 1;
  }

  /** Um hit qualquer (primária, secundária ou EMP) aplicou `amount` de dano real ao boss. */
  registerBossDamage(amount: number): void {
    if (amount <= 0) return;
    this.bossDamageDealt += amount;
  }

  /**
   * `BossOverlord.triggerPhaseTransition` não tem gancho de score nenhum (não devia ter: quem
   * decide o que uma fase alcançada vale é o score, não o boss). O chamador observa
   * `boss.phase` antes/depois de cada `takeDamage` e reporta a transição aqui.
   */
  registerBossPhaseReached(phase: 2 | 3): void {
    if (phase === 2) this.bossPhase2Reached = true;
    else this.bossPhase3Reached = true;
  }

  /**
   * Fase mais funda alcançada até agora nesta partida (para telemetria). Não confundir com "fase
   * atual do boss": este valor nunca recua, mesmo que o boss já esteja morto/inativo.
   */
  get deepestBossPhaseReached(): 1 | 2 | 3 {
    if (this.bossPhase3Reached) return 3;
    if (this.bossPhase2Reached) return 2;
    return 1;
  }

  calculateFinalScore(params: {
    bossDefeated: boolean;
    remainingTimeSeconds: number;
    remainingHp: number;
    synergyBonusUnlocked: boolean;
    mcpCount?: number;
    /** HP máximo do boss desta partida (varia com hardcore). Ausente/0 = boss nunca apareceu. */
    bossMaxHp?: number;
  }): {
    finalScore: number;
    mcpMultiplier: number;
    breakdown: ScoreBreakdown;
  } {
    const combatScore = this.currentScore;
    const bossBonus = params.bossDefeated ? BALANCE.score.boss_bonus : 0;
    const timeBonus = params.bossDefeated
      ? Math.max(0, Math.round(params.remainingTimeSeconds * BALANCE.score.time_bonus_per_second))
      : 0;
    const survivalBonus = Math.max(0, params.remainingHp * BALANCE.score.survival_bonus_per_hp);
    // Satura em 1.0 de propósito: o hit fatal pode arredondar `bossDamageDealt` um pouco acima de
    // `bossMaxHp` (overkill), e sem o teto isso pagaria mais que o próprio recorde de matar o
    // boss. Ver a derivação de `boss_damage_bonus_max` em `balance.ts` para por que o valor no
    // teto nunca alcança o que uma vitória paga por cima dele.
    const bossDamageRatio =
      params.bossMaxHp && params.bossMaxHp > 0 ? Math.min(1, this.bossDamageDealt / params.bossMaxHp) : 0;
    const bossDamageBonus = Math.round(bossDamageRatio * BALANCE.score.boss_damage_bonus_max);
    const bossPhaseBonus =
      (this.bossPhase2Reached ? BALANCE.score.boss_phase2_reached_bonus : 0) +
      (this.bossPhase3Reached ? BALANCE.score.boss_phase3_reached_bonus : 0);
    const synergyBonus = params.synergyBonusUnlocked ? BALANCE.score.synergy_bonus : 0;
    const rawTotal =
      combatScore + bossBonus + timeBonus + survivalBonus + bossDamageBonus + bossPhaseBonus + synergyBonus;
    const mcpMultiplier =
      BALANCE.score.mcp_multiplier_by_count[params.mcpCount ?? 3] ?? BALANCE.score.mcp_multiplier_default;

    const finalScore = Math.round(rawTotal * mcpMultiplier);

    return {
      finalScore,
      mcpMultiplier,
      breakdown: {
        combatScore,
        bossBonus,
        timeBonus,
        survivalBonus,
        bossDamageBonus,
        bossPhaseBonus,
        synergyBonus,
        mcpMultiplier
      }
    };
  }
}
