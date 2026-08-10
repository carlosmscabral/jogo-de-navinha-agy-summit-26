import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { ScoreCalculator } from './ScoreCalculator.js';

describe('ScoreCalculator Unit Tests', () => {
  it('should increment score and combo on kills', () => {
    const calc = new ScoreCalculator();
    calc.registerKill('drone');
    assert.equal(calc.currentScore, 100);
    assert.equal(calc.comboMultiplier, 1.1);

    calc.registerKill('cruiser');
    assert.equal(calc.currentScore, 100 + Math.round(500 * 1.1));
    assert.equal(calc.comboMultiplier, 1.2);
  });

  it('should reset combo multiplier when damage is taken', () => {
    const calc = new ScoreCalculator();
    calc.registerKill('drone');
    calc.registerKill('drone');
    assert.equal(calc.comboMultiplier, 1.2);

    calc.registerDamageTaken();
    assert.equal(calc.comboMultiplier, 1.0);
  });

  it('should apply time bonus only when boss is defeated', () => {
    const calc = new ScoreCalculator();
    calc.registerKill('drone');

    // Case 1: Defeated before time
    const winResult = calc.calculateFinalScore({
      bossDefeated: true,
      remainingTimeSeconds: 15,
      remainingHp: 3,
      synergyBonusUnlocked: true
    });
    assert.equal(winResult.breakdown.bossBonus, 10000);
    assert.equal(winResult.breakdown.timeBonus, 15 * 80);
    assert.equal(winResult.breakdown.survivalBonus, 3 * 1200);
    assert.equal(winResult.breakdown.synergyBonus, 2000);

    // Case 2: Death (boss not defeated) -> zero time bonus and zero boss bonus
    const loseResult = calc.calculateFinalScore({
      bossDefeated: false,
      remainingTimeSeconds: 50,
      remainingHp: 0,
      synergyBonusUnlocked: false
    });
    assert.equal(loseResult.breakdown.bossBonus, 0);
    assert.equal(loseResult.breakdown.timeBonus, 0);
    assert.equal(loseResult.breakdown.survivalBonus, 0);
  });

  it('should apply the MCP specialization multiplier', () => {
    const params = {
      bossDefeated: false,
      remainingTimeSeconds: 0,
      remainingHp: 1,
      synergyBonusUnlocked: false
    };

    const base = new ScoreCalculator().calculateFinalScore(params);
    assert.equal(base.mcpMultiplier, 1.0);
    assert.equal(base.finalScore, 1200);

    const one = new ScoreCalculator().calculateFinalScore({ ...params, mcpCount: 1 });
    assert.equal(one.mcpMultiplier, 1.25);
    assert.equal(one.finalScore, 1500);

    const two = new ScoreCalculator().calculateFinalScore({ ...params, mcpCount: 2 });
    assert.equal(two.mcpMultiplier, 1.1);
    assert.equal(two.finalScore, 1320);

    const three = new ScoreCalculator().calculateFinalScore({ ...params, mcpCount: 3 });
    assert.equal(three.mcpMultiplier, 1.0);
    assert.equal(three.finalScore, 1200);
  });
});
