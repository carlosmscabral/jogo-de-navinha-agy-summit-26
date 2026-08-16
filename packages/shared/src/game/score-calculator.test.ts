import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE } from '../constants/balance.js';
import { ScoreCalculator, bossPhaseJustReached } from './score-calculator.js';

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

describe('bossPhaseJustReached', () => {
  it('devolve null quando a fase não mudou', () => {
    assert.equal(bossPhaseJustReached(1, 1), null);
    assert.equal(bossPhaseJustReached(2, 2), null);
    assert.equal(bossPhaseJustReached(3, 3), null);
  });

  it('reporta a fase alcançada quando ela avança', () => {
    assert.equal(bossPhaseJustReached(1, 2), 2);
    assert.equal(bossPhaseJustReached(2, 3), 3);
  });

  it('reporta a fase 3 mesmo pulando a 2 num único hit (dano hipotético grande o bastante)', () => {
    // Não é alcançável com os tetos de dano por hit reais (ver o comentário de
    // `max_damage_per_primary_hit`/`max_damage_per_secondary_hit`), mas a função em si não deve
    // assumir isso -- ela só reage ao que `phaseAfter` diz.
    assert.equal(bossPhaseJustReached(1, 3), 3);
  });
});

describe('ScoreCalculator.deepestBossPhaseReached', () => {
  it('começa em 1 (o boss nasce na fase 1)', () => {
    assert.equal(new ScoreCalculator().deepestBossPhaseReached, 1);
  });

  it('não recua quando a fase 3 já foi registrada, mesmo perguntando depois de mais dano', () => {
    const calc = new ScoreCalculator();
    calc.registerBossPhaseReached(2);
    calc.registerBossPhaseReached(3);
    assert.equal(calc.deepestBossPhaseReached, 3);
  });
});

describe('crédito parcial de engajamento com o boss (achado de playtest de 2026-08-16)', () => {
  const BOSS_MAX_HP = 800;

  it('paga bossDamageBonus proporcional ao dano causado, mesmo sem matar o boss', () => {
    const calc = new ScoreCalculator();
    calc.registerBossDamage(400); // metade do max_hp

    const result = calc.calculateFinalScore({
      bossDefeated: false,
      remainingTimeSeconds: 0,
      remainingHp: 0,
      synergyBonusUnlocked: false,
      bossMaxHp: BOSS_MAX_HP
    });

    assert.equal(result.breakdown.bossDamageBonus, Math.round(0.5 * BALANCE.score.boss_damage_bonus_max));
  });

  it('não paga bossDamageBonus sem bossMaxHp (boss nunca apareceu)', () => {
    const calc = new ScoreCalculator();
    calc.registerBossDamage(400);

    const result = calc.calculateFinalScore({
      bossDefeated: false,
      remainingTimeSeconds: 0,
      remainingHp: 0,
      synergyBonusUnlocked: false
    });

    assert.equal(result.breakdown.bossDamageBonus, 0);
  });

  it('satura bossDamageBonus em 1.0 -- overkill no hit fatal não paga mais que o teto', () => {
    const calc = new ScoreCalculator();
    calc.registerBossDamage(BOSS_MAX_HP + 150); // último hit passou de 0 de sobra

    const result = calc.calculateFinalScore({
      bossDefeated: true,
      remainingTimeSeconds: 0,
      remainingHp: 0,
      synergyBonusUnlocked: false,
      bossMaxHp: BOSS_MAX_HP
    });

    assert.equal(result.breakdown.bossDamageBonus, BALANCE.score.boss_damage_bonus_max);
  });

  it('paga bossPhaseBonus por fase alcançada, cumulativo e independente do desfecho', () => {
    const calc = new ScoreCalculator();
    calc.registerBossPhaseReached(2);

    const afterPhase2 = calc.calculateFinalScore({
      bossDefeated: false,
      remainingTimeSeconds: 0,
      remainingHp: 0,
      synergyBonusUnlocked: false
    });
    assert.equal(afterPhase2.breakdown.bossPhaseBonus, BALANCE.score.boss_phase2_reached_bonus);

    calc.registerBossPhaseReached(3);
    const afterPhase3 = calc.calculateFinalScore({
      bossDefeated: false,
      remainingTimeSeconds: 0,
      remainingHp: 0,
      synergyBonusUnlocked: false
    });
    assert.equal(
      afterPhase3.breakdown.bossPhaseBonus,
      BALANCE.score.boss_phase2_reached_bonus + BALANCE.score.boss_phase3_reached_bonus
    );
  });

  /**
   * O invariante central desta funcionalidade: nenhuma quantidade de crédito parcial pode
   * alcançar o placar de uma vitória equivalente. Compara o melhor caso teoricamente possível de
   * crédito parcial (dano ~100% do max_hp, as duas fases alcançadas, sem matar) contra o pior
   * caso de vitória plausível (mata o boss sem HP nem tempo sobrando) -- e mesmo assim a vitória
   * vence.
   */
  it('mantém vitória plena estritamente melhor que o máximo de crédito parcial possível (mesmo combatScore)', () => {
    const partial = new ScoreCalculator();
    partial.registerKill('drone'); // mesmo combatScore de base nos dois lados
    partial.registerBossDamage(BOSS_MAX_HP - 1); // chega a 1 HP e não mata
    partial.registerBossPhaseReached(2);
    partial.registerBossPhaseReached(3);
    const partialResult = partial.calculateFinalScore({
      bossDefeated: false,
      remainingTimeSeconds: 0,
      remainingHp: 0,
      synergyBonusUnlocked: false,
      bossMaxHp: BOSS_MAX_HP
    });

    const victor = new ScoreCalculator();
    victor.registerKill('drone');
    victor.registerBossDamage(BOSS_MAX_HP);
    victor.registerBossPhaseReached(2);
    victor.registerBossPhaseReached(3);
    victor.registerKill('boss'); // o que só quem vence chama, via triggerBossDefeated
    const victoryResult = victor.calculateFinalScore({
      bossDefeated: true,
      remainingTimeSeconds: 0, // pior caso: venceu no último segundo
      remainingHp: 0, // pior caso: venceu com o casco no zero
      synergyBonusUnlocked: false,
      bossMaxHp: BOSS_MAX_HP
    });

    assert.ok(
      victoryResult.finalScore > partialResult.finalScore,
      `vitória (${victoryResult.finalScore}) deveria superar o crédito parcial máximo (${partialResult.finalScore})`
    );
  });
});
