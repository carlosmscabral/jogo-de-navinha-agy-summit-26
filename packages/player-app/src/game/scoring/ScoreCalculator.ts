import { BALANCE, ScoreBreakdown } from '@jogo/shared';

export class ScoreCalculator {
  currentScore = 0;
  comboMultiplier = 1.0;
  totalKills = 0;
  damageTakenCount = 0;
  shotsFired = 0;
  shotsHit = 0;

  registerKill(enemyType: 'drone' | 'cruiser' | 'boss'): number {
    const basePoints = BALANCE.score.points[enemyType];
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
