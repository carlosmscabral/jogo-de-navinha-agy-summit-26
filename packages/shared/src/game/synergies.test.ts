import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE } from '../constants/balance.js';
import { FALLBACK_PRESETS } from '../constants/fallback-presets.js';
import { applySynergies } from './synergies.js';

function specWith(synergies: string[]) {
  const base = structuredClone(FALLBACK_PRESETS.striker);
  base.build_metadata.synergies_unlocked = synergies;
  return base;
}

describe('applySynergies', () => {
  it('não altera nada quando nenhuma sinergia foi desbloqueada', () => {
    const spec = specWith([]);
    const r = applySynergies(spec);
    assert.deepEqual(r.applied, []);
    assert.deepEqual(r.attributes, spec.attributes);
    assert.deepEqual(r.weapons, spec.weapons);
  });

  it('Glass Cannon amplifica o dano primário e trava o HP em 2', () => {
    const spec = specWith(['Glass Cannon']);
    const r = applySynergies(spec);
    assert.equal(
      r.weapons.primary.damage,
      spec.weapons.primary.damage * BALANCE.synergies.glass_cannon.primary_damage_factor
    );
    assert.equal(r.attributes.max_hp, BALANCE.synergies.glass_cannon.forced_max_hp);
  });

  it('Titan Fortress eleva HP e garante escudo mínimo', () => {
    const r = applySynergies(specWith(['Titan Fortress']));
    assert.equal(r.attributes.max_hp, BALANCE.synergies.titan_fortress.forced_max_hp);
    assert.ok(r.attributes.shield_capacity >= BALANCE.synergies.titan_fortress.min_shield_capacity);
  });

  it('Ghost Interceptor leva velocidade ao máximo e hitbox ao mínimo', () => {
    const r = applySynergies(specWith(['Ghost Interceptor']));
    assert.equal(r.attributes.speed_px_s, BALANCE.ranges['attributes.speed_px_s'].max);
    assert.equal(r.attributes.hitbox_radius, BALANCE.ranges['attributes.hitbox_radius'].min);
  });

  it('Balanced Ace amplifica tudo sem estourar as faixas', () => {
    const r = applySynergies(specWith(['Balanced Ace']));
    for (const field of ['max_hp', 'shield_capacity', 'speed_px_s'] as const) {
      const range = BALANCE.ranges[`attributes.${field}`];
      assert.ok(r.attributes[field] <= range.max, `${field} estourou o máximo`);
      assert.ok(r.attributes[field] >= range.min, `${field} furou o mínimo`);
    }
  });

  it('ignora nomes de sinergia que a engine não conhece', () => {
    const r = applySynergies(specWith(['Sinergia Inventada Pelo Agente']));
    assert.deepEqual(r.applied, []);
  });

  it('produz naves mensuravelmente diferentes entre sinergias', () => {
    const glass = applySynergies(specWith(['Glass Cannon']));
    const titan = applySynergies(specWith(['Titan Fortress']));
    assert.notEqual(glass.attributes.max_hp, titan.attributes.max_hp);
    assert.notEqual(glass.weapons.primary.damage, titan.weapons.primary.damage);
  });
});
