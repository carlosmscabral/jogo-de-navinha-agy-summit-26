import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { BALANCE, validateShipSpecification } from '@jogo/shared';
import { DEV_PRESETS } from './presets.js';

describe('DEV_PRESETS', () => {
  for (const [key, spec] of Object.entries(DEV_PRESETS)) {
    it(`${key} validates against the ship_spec schema`, () => {
      const result = validateShipSpecification(spec);
      assert.equal(result.isValid, true, JSON.stringify(result.errors));
    });
  }

  it('minimo pulls every attribute/weapon field from BALANCE.ranges.min', () => {
    const spec = DEV_PRESETS.minimo;
    assert.equal(spec.attributes.max_hp, BALANCE.ranges['attributes.max_hp'].min);
    assert.equal(spec.attributes.shield_capacity, BALANCE.ranges['attributes.shield_capacity'].min);
    assert.equal(spec.weapons.primary.damage, BALANCE.ranges['weapons.primary.damage'].min);
    assert.equal(spec.weapons.secondary.cooldown_seconds, BALANCE.ranges['weapons.secondary.cooldown_seconds'].min);
  });

  it('maximo pulls every attribute/weapon field from BALANCE.ranges.max', () => {
    const spec = DEV_PRESETS.maximo;
    assert.equal(spec.attributes.max_hp, BALANCE.ranges['attributes.max_hp'].max);
    assert.equal(spec.weapons.primary.damage, BALANCE.ranges['weapons.primary.damage'].max);
  });

  it('glass_cannon has minimum hull but maximum primary damage/fire_rate', () => {
    const spec = DEV_PRESETS.glass_cannon;
    assert.equal(spec.attributes.max_hp, BALANCE.ranges['attributes.max_hp'].min);
    assert.equal(spec.weapons.primary.type, 'laser');
    assert.equal(spec.weapons.primary.damage, BALANCE.ranges['weapons.primary.damage'].max);
    assert.equal(spec.weapons.primary.fire_rate, BALANCE.ranges['weapons.primary.fire_rate'].max);
  });

  it('vulcan_max fires the vulcan_spread weapon at max damage/fire_rate', () => {
    const spec = DEV_PRESETS.vulcan_max;
    assert.equal(spec.weapons.primary.type, 'vulcan_spread');
    assert.equal(spec.weapons.primary.damage, BALANCE.ranges['weapons.primary.damage'].max);
    assert.equal(spec.weapons.primary.fire_rate, BALANCE.ranges['weapons.primary.fire_rate'].max);
  });

  it('tanque maxes out hull/shield but has minimum primary damage', () => {
    const spec = DEV_PRESETS.tanque;
    assert.equal(spec.attributes.max_hp, BALANCE.ranges['attributes.max_hp'].max);
    assert.equal(spec.attributes.shield_capacity, BALANCE.ranges['attributes.shield_capacity'].max);
    assert.equal(spec.weapons.primary.damage, BALANCE.ranges['weapons.primary.damage'].min);
  });
});
