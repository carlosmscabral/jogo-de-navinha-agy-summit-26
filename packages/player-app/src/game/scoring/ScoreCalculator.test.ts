import { describe, it } from 'node:test';
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
    assert.equal(winResult.breakdown.bossBonus, 5000);
    assert.equal(winResult.breakdown.timeBonus, 15 * 50);
    assert.equal(winResult.breakdown.survivalBonus, 3000);
    assert.equal(winResult.breakdown.synergyBonus, 1500);

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
});
