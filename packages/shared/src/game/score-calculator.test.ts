import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE } from '../constants/balance.js';
import { ScoreCalculator } from './score-calculator.js';

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

  it('should treat an out-of-union enemyType (e.g. kamikaze, reachable via the unsound getData cast at the MainGameScene call site) as drone-worth points instead of NaN', () => {
    const calc = new ScoreCalculator();
    // 'kamikaze' isn't in the `'drone' | 'cruiser' | 'boss'` union registerKill declares, but
    // MainGameScene.ts reads the enemy type back from Phaser sprite data via an unsound cast, so a
    // real 'kamikaze' value does reach this method at runtime. Cast here to reproduce that exact path.
    const earned = calc.registerKill('kamikaze' as unknown as 'drone');
    assert.equal(earned, 100);
    assert.equal(calc.currentScore, 100);
    assert.ok(!Number.isNaN(calc.currentScore));
  });

  it('conta tiros e acertos da primária, incluindo as 3 pelotas de um acionamento do vulcan', () => {
    const calc = new ScoreCalculator();
    assert.equal(calc.shotsFired, 0);
    assert.equal(calc.shotsHit, 0);

    calc.registerShotsFired(); // laser: 1 projétil por acionamento
    calc.registerShotsFired(3); // vulcan_spread: 3 pelotas, 3 corpos, 3 tiros
    calc.registerShotHit();

    assert.equal(calc.shotsFired, 4);
    assert.equal(calc.shotsHit, 1);
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
    assert.equal(winResult.breakdown.bossBonus, BALANCE.score.boss_bonus);
    assert.equal(winResult.breakdown.timeBonus, 15 * BALANCE.score.time_bonus_per_second);
    assert.equal(winResult.breakdown.survivalBonus, 3 * BALANCE.score.survival_bonus_per_hp);
    assert.equal(winResult.breakdown.synergyBonus, BALANCE.score.synergy_bonus);

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
    assert.equal(base.mcpMultiplier, BALANCE.score.mcp_multiplier_default);
    assert.equal(base.finalScore, 1200);

    const one = new ScoreCalculator().calculateFinalScore({ ...params, mcpCount: 1 });
    assert.equal(one.mcpMultiplier, BALANCE.score.mcp_multiplier_by_count[1]);
    assert.equal(one.finalScore, 1500);

    const two = new ScoreCalculator().calculateFinalScore({ ...params, mcpCount: 2 });
    assert.equal(two.mcpMultiplier, BALANCE.score.mcp_multiplier_by_count[2]);
    assert.equal(two.finalScore, 1320);

    const three = new ScoreCalculator().calculateFinalScore({ ...params, mcpCount: 3 });
    assert.equal(three.mcpMultiplier, BALANCE.score.mcp_multiplier_default);
    assert.equal(three.finalScore, 1200);
  });
});
