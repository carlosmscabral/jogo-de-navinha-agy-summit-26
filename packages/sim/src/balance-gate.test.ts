import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { runMatrix, WIN_RATE_TARGET, MAX_ARCHETYPE_SPREAD_PP, type SimMatrix } from './combat-model.js';
import { ARCHETYPES, SKILL_PROFILES } from './archetypes.js';

/**
 * Linha de base — 2026-08-13, `npm run sim:balance` (200 seeds, `balance.ts` ainda com os
 * valores originais que produziram D12: `boss.max_hp: 15000`, `boss.max_hp_hardcore: 22000`,
 * `match.boss_spawn_s: 45`, `weapons.primary.vulcan_pellet_factor: 0.65`,
 * `boss.mitigation.phase1: 0.50`).
 *
 * arquétipo        habilidade    vitórias   TTK p50   TTK p90   dano   score     derrota
 * interceptor      iniciante     0,0%       —         —         4,0    9.157     0,0% tempo / 100,0% morte
 * interceptor      mediano       0,0%       —         —         4,0    22.870    0,0% tempo / 100,0% morte
 * interceptor      experiente    0,0%       —         —         3,8    43.033    15,0% tempo / 85,0% morte
 * vanguard         iniciante     0,0%       —         —         7,0    9.157     0,0% tempo / 100,0% morte
 * vanguard         mediano       0,0%       —         —         7,0    22.883    1,0% tempo / 99,0% morte
 * vanguard         experiente    0,0%       —         —         5,3    44.933    69,5% tempo / 30,5% morte
 * striker          iniciante     0,0%       —         —         3,0    9.157     0,0% tempo / 100,0% morte
 * striker          mediano       0,0%       —         —         3,0    22.870    0,0% tempo / 100,0% morte
 * striker          experiente    0,0%       —         —         2,9    42.821    6,5% tempo / 93,5% morte
 * minimo           iniciante     0,0%       —         —         2,0    9.157     0,0% tempo / 100,0% morte
 * minimo           mediano       0,0%       —         —         2,0    22.870    0,0% tempo / 100,0% morte
 * minimo           experiente    0,0%       —         —         2,0    42.736    1,0% tempo / 99,0% morte
 * maximo           iniciante     0,0%       —         —         8,0    9.157     0,0% tempo / 100,0% morte
 * maximo           mediano       0,0%       —         —         8,0    22.909    2,0% tempo / 98,0% morte
 * maximo           experiente    0,0%       —         —         5,5    45.956    85,5% tempo / 14,5% morte
 * glass_cannon     iniciante     0,0%       —         —         2,0    9.157     0,0% tempo / 100,0% morte
 * glass_cannon     mediano       0,0%       —         —         2,0    22.870    0,0% tempo / 100,0% morte
 * glass_cannon     experiente    0,0%       —         —         2,0    42.729    0,5% tempo / 99,5% morte
 * vulcan_max       iniciante     0,0%       —         —         8,0    9.157     0,0% tempo / 100,0% morte
 * vulcan_max       mediano       0,0%       —         —         8,0    22.889    1,0% tempo / 99,0% morte
 * vulcan_max       experiente    98,0%      35,2s     35,8s     4,2    70.174    0,0% tempo / 100,0% morte
 * tanque           iniciante     0,0%       —         —         8,0    9.157     0,0% tempo / 100,0% morte
 * tanque           mediano       0,0%       —         —         8,0    22.922    2,5% tempo / 97,5% morte
 * tanque           experiente    0,0%       —         —         5,5    45.956    86,0% tempo / 14,0% morte
 *
 * `aggregateWinRate` (média de `winRate` das 8 células `mediano` acima) = 0,0% -- muito abaixo
 * da banda de 15-25%. 22 das 24 células (todas exceto `vulcan_max experiente`, um preset
 * irrealista no teto de todas as faixas de `BALANCE.ranges`) têm taxa de vitória 0%. Este é
 * exatamente o D12 medido: o boss é matematicamente quase invencível para qualquer build real.
 * Este comentário é o "antes" contra o qual a Tarefa B8 mede o efeito de cada hipótese aplicada.
 */

const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

describe('portão de balanceamento (Spec 09 §5.3)', () => {
  let matrix: SimMatrix;

  before(() => {
    matrix = runMatrix({ archetypes: ARCHETYPES, skills: SKILL_PROFILES, seeds: SEEDS });
  });

  it('mantém a taxa de vitória agregada na banda alvo', () => {
    const rate = matrix.aggregateWinRate;
    assert.ok(rate >= WIN_RATE_TARGET.min && rate <= WIN_RATE_TARGET.max,
      `taxa agregada ${(rate * 100).toFixed(1)}% fora da banda ${WIN_RATE_TARGET.min * 100}–${WIN_RATE_TARGET.max * 100}%`);
  });

  it('não deixa nenhum arquétipo em 0% nem em 100% na habilidade mediana', () => {
    for (const cell of matrix.cells.filter((c) => c.skill === 'mediano')) {
      assert.ok(cell.winRate > 0, `${cell.archetype} é invencível — este é exatamente o defeito D12`);
      assert.ok(cell.winRate < 1, `${cell.archetype} vence sempre — a escolha do visitante deixou de importar`);
    }
  });

  it('mantém o espalhamento entre arquétipos abaixo do penhasco', () => {
    const medians = matrix.cells.filter((c) => c.skill === 'mediano').map((c) => c.winRate);
    const spreadPp = (Math.max(...medians) - Math.min(...medians)) * 100;
    assert.ok(spreadPp <= MAX_ARCHETYPE_SPREAD_PP,
      `espalhamento de ${spreadPp.toFixed(1)} pontos percentuais entre o melhor e o pior arquétipo`);
  });

  it('não deixa nenhum arquétipo com secundária de dano zero contra o boss, exceto emp_burst (D13)', () => {
    // emp_burst realistically deals ~0 damage to the boss in this model: computeEmpDamage falls
    // off to zero beyond emp_radius_px (300px), and the player's realistic distance from the boss
    // (~540px, this model has no spatial simulation) is well outside that radius. This is a
    // faithful default (Task B7), not evidence D13 regressed -- EMP's real, working damage lands
    // on nearby regular enemies, which this boss-focused simulator doesn't simulate at all.
    for (const cell of matrix.cells) {
      if (cell.secondaryType === 'none' || cell.secondaryType === 'emp_burst') continue;
      assert.ok(cell.secondaryDamageDealt > 0, `${cell.archetype}: arma secundária ${cell.secondaryType} causou dano zero ao boss`);
    }
  });
});
