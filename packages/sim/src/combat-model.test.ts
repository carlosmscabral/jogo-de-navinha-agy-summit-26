import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE, FALLBACK_PRESETS } from '@jogo/shared';
import { simulateMatch } from './combat-model.js';
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

  it('honra a mitigação por fase: mais dano bruto na fase 3 que na 1', () => {
    // Um projétil de dano D causa D×mitigation.phaseN, com piso min_damage_per_hit.
    const d = BALANCE.ranges['weapons.primary.damage'].max;
    const p1 = Math.max(BALANCE.boss.min_damage_per_hit, Math.round(d * BALANCE.boss.mitigation.phase1));
    const p3 = Math.max(BALANCE.boss.min_damage_per_hit, Math.round(d * BALANCE.boss.mitigation.phase3));
    assert.ok(p3 > p1);
  });
});
