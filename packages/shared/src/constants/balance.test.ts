import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE } from './balance.js';

describe('BALANCE', () => {
  it('tem faixas com mínimo estritamente menor que o máximo', () => {
    for (const [field, range] of Object.entries(BALANCE.ranges)) {
      assert.ok(range.min < range.max, `${field}: min ${range.min} não é menor que max ${range.max}`);
    }
  });

  it('ordena a linha do tempo da partida', () => {
    const { duration_s, boss_spawn_s, boss_warning_s, wave2_starts_s } = BALANCE.match;
    assert.ok(wave2_starts_s < boss_warning_s);
    assert.ok(boss_warning_s < boss_spawn_s);
    assert.ok(boss_spawn_s < duration_s, 'o boss precisa aparecer antes do fim da partida');
  });

  it('deixa tempo suficiente para a luta contra o boss', () => {
    assert.ok(BALANCE.match.duration_s - BALANCE.match.boss_spawn_s >= 40,
      'menos de 40s de janela contra o boss torna a vitória dependente de sorte');
  });

  it('escalona as fases do boss em dificuldade crescente', () => {
    const { phase2_hp_ratio, phase3_hp_ratio, mitigation, fire_cooldown_ms } = BALANCE.boss;
    assert.ok(phase3_hp_ratio < phase2_hp_ratio, 'a fase 3 vem depois da 2');
    assert.ok(mitigation.phase1 < mitigation.phase2, 'a mitigação diminui conforme o boss enfraquece');
    assert.ok(mitigation.phase2 < mitigation.phase3);
    assert.equal(mitigation.phase3, 1.0, 'na fase final o dano passa integralmente');
    assert.ok(fire_cooldown_ms.phase3 < fire_cooldown_ms.phase2);
    assert.ok(fire_cooldown_ms.phase2 < fire_cooldown_ms.phase1);
  });

  it('recompensa a especialização em MCP de forma monotônica', () => {
    const m = BALANCE.score.mcp_multiplier_by_count;
    assert.ok(m[1] > m[2], '1 MCP precisa render mais que 2');
    assert.ok(m[2] > BALANCE.score.mcp_multiplier_default);
  });

  it('nunca deixa o dano mitigado zerar', () => {
    assert.ok(BALANCE.boss.min_damage_per_hit > 0);
    assert.ok(BALANCE.boss.max_damage_per_primary_hit >= BALANCE.ranges['weapons.primary.damage'].max,
      'o teto por projétil não pode anular o topo da faixa autorizada');
  });
});
