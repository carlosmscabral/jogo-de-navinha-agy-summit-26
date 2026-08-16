import { BALANCE } from '../constants/balance.js';
import type { ScoreBreakdown } from '../types/ship.js';

export class ScoreCalculator {
  currentScore = 0;
  comboMultiplier = 1.0;
  totalKills = 0;
  damageTakenCount = 0;
  shotsFired = 0;
  shotsHit = 0;

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

  calculateFinalScore(params: {
    bossDefeated: boolean;
    remainingTimeSeconds: number;
    remainingHp: number;
    synergyBonusUnlocked: boolean;
    mcpCount?: number;
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
    const synergyBonus = params.synergyBonusUnlocked ? BALANCE.score.synergy_bonus : 0;
    const rawTotal = combatScore + bossBonus + timeBonus + survivalBonus + synergyBonus;
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
        synergyBonus,
        mcpMultiplier
      }
    };
  }
}
