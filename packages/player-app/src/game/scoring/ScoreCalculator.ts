import { ScoreBreakdown } from '@jogo/shared';

export class ScoreCalculator {
  currentScore = 0;
  comboMultiplier = 1.0;
  totalKills = 0;
  damageTakenCount = 0;
  shotsFired = 0;
  shotsHit = 0;

  registerKill(enemyType: 'drone' | 'cruiser' | 'boss'): number {
    let basePoints = 100;
    if (enemyType === 'cruiser') basePoints = 500;
    if (enemyType === 'boss') basePoints = 10000;

    const earned = Math.round(basePoints * this.comboMultiplier);
    this.currentScore += earned;
    this.totalKills += 1;

    // Increment combo up to 3.0x
    this.comboMultiplier = Math.min(3.0, +(this.comboMultiplier + 0.1).toFixed(2));
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
    const bossBonus = params.bossDefeated ? 10000 : 0;
    const timeBonus = params.bossDefeated ? Math.max(0, Math.round(params.remainingTimeSeconds * 80)) : 0;
    const survivalBonus = Math.max(0, params.remainingHp * 1200);
    const synergyBonus = params.synergyBonusUnlocked ? 2000 : 0;

    const rawTotal = combatScore + bossBonus + timeBonus + survivalBonus + synergyBonus;

    // Gamification Tradeoff: Specialization Multiplier
    let mcpMultiplier = 1.0;
    if (params.mcpCount === 1) mcpMultiplier = 1.25;
    else if (params.mcpCount === 2) mcpMultiplier = 1.10;

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
