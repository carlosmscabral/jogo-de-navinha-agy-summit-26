import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { selectFallbackPreset } from './fallback-selector.js';

describe('selectFallbackPreset', () => {
  it('entrega vanguard a quem investiu em defesa', () => {
    const r = selectFallbackPreset({ offense: 15, speed: 15, defense: 60, tech: 10 });
    assert.equal(r.name, 'vanguard');
    assert.equal(r.spec.attributes.max_hp, 5);
  });

  it('entrega interceptor a quem investiu em velocidade', () => {
    assert.equal(selectFallbackPreset({ offense: 20, speed: 55, defense: 15, tech: 10 }).name, 'interceptor');
  });

  it('entrega striker a quem investiu em ataque', () => {
    assert.equal(selectFallbackPreset({ offense: 60, speed: 15, defense: 15, tech: 10 }).name, 'striker');
  });

  it('desempata de forma determinística', () => {
    const a = selectFallbackPreset({ offense: 25, speed: 25, defense: 25, tech: 25 });
    const b = selectFallbackPreset({ offense: 25, speed: 25, defense: 25, tech: 25 });
    assert.equal(a.name, b.name);
  });

  it('devolve uma cópia, não a referência do preset', () => {
    const r = selectFallbackPreset({ offense: 60, speed: 15, defense: 15, tech: 10 });
    r.spec.pilot.callsign = 'MUTADO';
    assert.notEqual(selectFallbackPreset({ offense: 60, speed: 15, defense: 15, tech: 10 }).spec.pilot.callsign, 'MUTADO');
  });
});
