import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE, FALLBACK_PRESETS } from '@jogo/shared';
import { simulateMatch, VULCAN_OUTER_PELLET_HIT_RATE } from './combat-model.js';
import { SKILL_PROFILES } from './archetypes.js';

const perfect = { name: 'experiente' as const, accuracy: 1.0, fireUptime: 1.0, hitsTakenPerSecond: 0, secondaryUptime: 1.0 };

describe('simulateMatch', () => {
  it('é determinístico para o mesmo seed', () => {
    const a = simulateMatch({ spec: FALLBACK_PRESETS.striker, skill: SKILL_PROFILES.mediano, seed: 42 });
    const b = simulateMatch({ spec: FALLBACK_PRESETS.striker, skill: SKILL_PROFILES.mediano, seed: 42 });
    assert.deepEqual(a, b);
  });

  it('um jogador que nunca atira nunca vence', () => {
    const r = simulateMatch({
      spec: FALLBACK_PRESETS.striker,
      skill: { ...perfect, accuracy: 0, fireUptime: 0, secondaryUptime: 0 },
      seed: 1
    });
    assert.equal(r.victory, false);
    assert.equal(r.defeatReason, 'timeout');
  });

  it('um jogador perfeito que morre perde por morte, não por tempo', () => {
    const r = simulateMatch({
      spec: FALLBACK_PRESETS.interceptor,
      skill: { ...perfect, hitsTakenPerSecond: 3 },
      seed: 5
    });
    assert.equal(r.victory, false);
    assert.equal(r.defeatReason, 'death');
  });

  it('respeita a janela de tempo contra o boss', () => {
    const r = simulateMatch({ spec: FALLBACK_PRESETS.striker, skill: perfect, seed: 3 });
    if (r.victory) {
      assert.ok(r.bossTtkSeconds !== null);
      assert.ok(r.bossTtkSeconds! <= BALANCE.match.duration_s - BALANCE.match.boss_spawn_s);
    }
  });

  it('cobra o tempo de voo do projétil uma vez, não uma por disparo', () => {
    // Duas naves idênticas menos pela velocidade do projétil. Uma vez que o cano encheu, os
    // acertos chegam na cadência da arma, então o voo custa exatamente uma travessia no TTK --
    // a diferença tem que ser a diferença dos tempos de voo, não ela multiplicada pelos disparos.
    const base = FALLBACK_PRESETS.interceptor;
    const slow = { ...base, weapons: { ...base.weapons, primary: { ...base.weapons.primary, bullet_speed: 400 } } };
    const fast = { ...base, weapons: { ...base.weapons, primary: { ...base.weapons.primary, bullet_speed: 800 } } };

    const rSlow = simulateMatch({ spec: slow, skill: perfect, seed: 1 });
    const rFast = simulateMatch({ spec: fast, skill: perfect, seed: 1 });
    assert.ok(rSlow.victory && rFast.victory);

    // 442px de subida: 1.105s a 400px/s contra 0.5525s a 800px/s.
    const expectedGapS = 442 / 400 - 442 / 800;
    const actualGapS = rSlow.bossTtkSeconds! - rFast.bossTtkSeconds!;
    assert.ok(
      Math.abs(actualGapS - expectedGapS) < 0.15,
      `esperava ≈${expectedGapS.toFixed(2)}s de diferença, veio ${actualGapS.toFixed(2)}s`
    );
  });

  it('deixa as pelotas externas do vulcan errarem, como a engine deixa', () => {
    // Duas naves com o mesmo dano por projétil e a mesma cadência: uma cospe 3 pelotas por salva,
    // a outra 1. Se as 3 sempre acertassem, o vulcan mataria exatamente 3x mais rápido; se só a
    // central acertasse, seriam 1x. A engine mediu 75% das pelotas chegando -- 2.26 por salva --
    // então a razão entre os dois tem que cair *estritamente entre* 2 e 3.
    //
    // O dano por pelota (11) fica acima do piso `min_damage_per_hit` e abaixo do teto
    // `max_damage_per_primary_hit` nas três fases, então o tempo escala linear com as pelotas que
    // chegam e essa razão é uma leitura direta da taxa de acerto.
    const base = FALLBACK_PRESETS.striker;
    const perPellet = Math.round(base.weapons.primary.damage * BALANCE.weapons.primary.vulcan_pellet_factor);
    const withPrimary = (primary: Record<string, unknown>) => ({
      ...base,
      weapons: { ...base.weapons, primary: { ...base.weapons.primary, fire_rate: 12, ...primary } }
    });

    const spread = simulateMatch({ spec: withPrimary({}) as typeof base, skill: perfect, seed: 1 });
    const single = simulateMatch({
      spec: withPrimary({ type: 'laser', damage: perPellet }) as typeof base,
      skill: perfect,
      seed: 1
    });
    assert.ok(spread.victory && single.victory);

    // Só a parte governada pela cadência escala com as pelotas: as duas janelas de
    // invulnerabilidade e o tempo de voo do primeiro tiro são aditivos e iguais nos dois.
    const invulnS = (2 * BALANCE.boss.phase_transition_invuln_ms) / 1000;
    const cadence = (ttk: number, travelPx: number) => ttk - invulnS - travelPx / base.weapons.primary.bullet_speed;
    const ratio = cadence(single.bossTtkSeconds!, 442) / cadence(spread.bossTtkSeconds!, 454);

    assert.ok(
      ratio > 2 && ratio < 3,
      `razão de ${ratio.toFixed(2)}: fora de (2, 3) significa que as pelotas externas nunca erram ` +
        `(3.0) ou nunca acertam (1.0). Esperado ≈${(1 + 2 * VULCAN_OUTER_PELLET_HIT_RATE).toFixed(2)}.`
    );
  });

  it('honra a mitigação por fase: mais dano bruto na fase 3 que na 1', () => {
    // Um projétil de dano D causa D×mitigation.phaseN, com piso min_damage_per_hit.
    const d = BALANCE.ranges['weapons.primary.damage'].max;
    const p1 = Math.max(BALANCE.boss.min_damage_per_hit, Math.round(d * BALANCE.boss.mitigation.phase1));
    const p3 = Math.max(BALANCE.boss.min_damage_per_hit, Math.round(d * BALANCE.boss.mitigation.phase3));
    assert.ok(p3 > p1);
  });

  /**
   * Achado de playtest de 2026-08-16: até esta tarefa, dano parcial ao boss e fase alcançada não
   * sobreviviam à partida em lugar nenhum -- nem no engine real, nem aqui. `bossDamageDealt` e
   * `bossPhaseReached` são o espelho, no simulador, dos mesmos dois fatos que `MainGameScene`
   * agora expõe em `MatchTelemetry`.
   */
  it('expõe bossDamageDealt e bossPhaseReached mesmo numa partida perdida', () => {
    const r = simulateMatch({
      spec: FALLBACK_PRESETS.interceptor,
      skill: { ...perfect, hitsTakenPerSecond: 3 }, // mesmo perfil do teste de morte acima
      seed: 5
    });
    assert.equal(r.victory, false);
    assert.equal(r.defeatReason, 'death');
    // Um jogador com pontaria perfeita chega a bater no boss antes de morrer -- não é um dano
    // literal zero, mas também não é o boss inteiro (senão teria vencido).
    assert.ok(r.bossDamageDealt > 0, 'jogador perfeito não causou dano nenhum ao boss antes de morrer');
    assert.ok(r.bossDamageDealt < BALANCE.boss.max_hp, 'dano parcial não deveria alcançar o max_hp sem vitória');
    assert.ok(r.bossPhaseReached >= 1 && r.bossPhaseReached <= 3);
  });

  it('numa vitória, bossDamageDealt satura perto do max_hp e a fase mais funda é 3', () => {
    const r = simulateMatch({ spec: FALLBACK_PRESETS.striker, skill: perfect, seed: 3 });
    if (r.victory) {
      assert.ok(r.bossDamageDealt >= BALANCE.boss.max_hp,
        `esperava dano acumulado >= max_hp (${BALANCE.boss.max_hp}), veio ${r.bossDamageDealt}`);
      assert.equal(r.bossPhaseReached, 3, 'matar o boss sempre atravessa a fase 3 antes do golpe final');
    }
  });

  /**
   * Checagem de ponta a ponta pelo simulador inteiro (não isolada como o teste equivalente em
   * `score-calculator.test.ts`, que zera a diferença de `combatScore` de propósito para provar o
   * invariante sozinho): uma build fraca que mal belisca o boss e perde não deveria superar uma
   * que o mata, nem juntando toda vantagem de combatScore pré-boss que a `perfect` skill também
   * acumula. Serve para garantir que a fiação do bônus parcial dentro de `simulateMatch` não
   * quebrou o invariante na prática, não para isolar a contribuição exata de cada termo.
   */
  it('mantém vitória plena estritamente melhor que perder engajando bem o boss', () => {
    const loses = simulateMatch({
      spec: FALLBACK_PRESETS.interceptor,
      skill: { ...perfect, accuracy: 0.3, fireUptime: 0.3, secondaryUptime: 0 },
      seed: 11
    });
    const wins = simulateMatch({ spec: FALLBACK_PRESETS.striker, skill: perfect, seed: 3 });

    assert.equal(loses.victory, false);
    assert.equal(wins.victory, true);
    assert.ok(
      wins.finalScore > loses.finalScore,
      `vitória (${wins.finalScore}) deveria superar a derrota engajada (${loses.finalScore})`
    );
  });
});
