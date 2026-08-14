import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEV_ARCHETYPES } from './dev-archetypes.js';
import { applySynergies } from './synergies.js';

/**
 * Regressão da revisão final: `fromRanges` herdava `build_metadata` inteiro de
 * `FALLBACK_PRESETS.interceptor`, cujo `synergies_unlocked` é `['Ghost Interceptor']`. Desde a
 * Tarefa B6, `applySynergies` lê esse campo e reescreve atributos/armas antes da partida --
 * então todo arquétipo sintético (incluindo `glass_cannon`, que nunca recebia a própria sinergia
 * com o nome que carrega) decolava secretamente como Ghost Interceptor.
 */
describe('DEV_ARCHETYPES — synergies_unlocked não é mais herdado às cegas de FALLBACK_PRESETS.interceptor', () => {
  it('minimo/maximo/vulcan_max/tanque não declaram nenhuma sinergia', () => {
    for (const key of ['minimo', 'maximo', 'vulcan_max', 'tanque'] as const) {
      assert.deepEqual(
        DEV_ARCHETYPES[key].build_metadata.synergies_unlocked,
        [],
        `${key} não deveria carregar synergies_unlocked herdado do interceptor`
      );
      const r = applySynergies(DEV_ARCHETYPES[key]);
      assert.deepEqual(r.applied, [], `${key} não deveria sofrer nenhuma transformação de sinergia`);
    }
  });

  it('glass_cannon declara a sinergia Glass Cannon, não Ghost Interceptor', () => {
    assert.deepEqual(DEV_ARCHETYPES.glass_cannon.build_metadata.synergies_unlocked, ['Glass Cannon']);
    const r = applySynergies(DEV_ARCHETYPES.glass_cannon);
    assert.deepEqual(r.applied, ['Glass Cannon']);
  });
});
