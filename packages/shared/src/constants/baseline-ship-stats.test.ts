import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeBaselineAttributes, computeBaselineWeapons } from './baseline-ship-stats.js';
import { EnergySliders, PrimaryWeaponType, SecondaryWeaponType } from '../types/ship.js';
import { FALLBACK_PRESETS } from './fallback-presets.js';
import { validateShipSpecification } from '../validator.js';

const PRIMARY_TYPES: PrimaryWeaponType[] = ['laser', 'plasma', 'vulcan_spread'];
const SECONDARY_TYPES: SecondaryWeaponType[] = ['homing_missiles', 'emp_burst', 'none'];

const MIN_SLIDERS: EnergySliders = { offense: 10, speed: 10, defense: 10, tech: 10 };
const MAX_SLIDERS: EnergySliders = { offense: 50, speed: 50, defense: 50, tech: 50 };
const MID_SLIDERS: EnergySliders = { offense: 30, speed: 30, defense: 30, tech: 30 };

describe('computeBaselineAttributes', () => {
  it('produces every attribute at its schema minimum when sliders are at their minimum', () => {
    const attrs = computeBaselineAttributes(MIN_SLIDERS);
    assert.equal(attrs.max_hp, 2);
    assert.equal(attrs.shield_capacity, 0);
    assert.equal(attrs.speed_px_s, 180);
    // hitbox_radius is inverted: min speed -> MAX radius
    assert.equal(attrs.hitbox_radius, 16);
  });

  it('produces every attribute at its schema maximum when sliders are at their maximum', () => {
    const attrs = computeBaselineAttributes(MAX_SLIDERS);
    assert.equal(attrs.max_hp, 5);
    assert.equal(attrs.shield_capacity, 3);
    assert.equal(attrs.speed_px_s, 380);
    // hitbox_radius is inverted: max speed -> MIN radius
    assert.equal(attrs.hitbox_radius, 8);
  });

  it('lands strictly between the bounds for an interior slider value', () => {
    const attrs = computeBaselineAttributes(MID_SLIDERS);
    assert.ok(attrs.speed_px_s > 180 && attrs.speed_px_s < 380, `speed_px_s ${attrs.speed_px_s} should be strictly interior`);
    assert.ok(attrs.hitbox_radius > 8 && attrs.hitbox_radius < 16, `hitbox_radius ${attrs.hitbox_radius} should be strictly interior`);
  });

  it('is a pure function (same input -> deep-equal output)', () => {
    const a = computeBaselineAttributes(MID_SLIDERS);
    const b = computeBaselineAttributes(MID_SLIDERS);
    assert.deepEqual(a, b);
  });
});

describe('computeBaselineWeapons', () => {
  it('produces primary damage/fire_rate at their practical-range minimum (not the full schema minimum), while other fields hit the full schema minimum, when offense is at its minimum', () => {
    const weapons = computeBaselineWeapons(MIN_SLIDERS, 'laser', 'homing_missiles');
    assert.equal(weapons.primary.damage, 15);
    assert.equal(weapons.primary.fire_rate, 5);
    assert.equal(weapons.primary.bullet_speed, 400);
    assert.equal(weapons.primary.spread_angle, 0);
    assert.equal(weapons.secondary.damage, 60);
    // cooldown_seconds is inverted: min offense -> MAX cooldown
    assert.equal(weapons.secondary.cooldown_seconds, 12);
  });

  it('produces primary damage/fire_rate at their practical-range maximum (not the full schema maximum), while other fields hit the full schema maximum, when offense is at its maximum', () => {
    const weapons = computeBaselineWeapons(MAX_SLIDERS, 'laser', 'homing_missiles');
    assert.equal(weapons.primary.damage, 45);
    assert.equal(weapons.primary.fire_rate, 12);
    assert.equal(weapons.primary.bullet_speed, 800);
    assert.equal(weapons.primary.spread_angle, 30);
    assert.equal(weapons.secondary.damage, 150);
    // cooldown_seconds is inverted: max offense -> MIN cooldown
    assert.equal(weapons.secondary.cooldown_seconds, 3);
  });

  it('lands strictly between the bounds for an interior slider value', () => {
    const weapons = computeBaselineWeapons(MID_SLIDERS, 'laser', 'homing_missiles');
    assert.ok(weapons.primary.damage > 15 && weapons.primary.damage < 45, `damage ${weapons.primary.damage} should be strictly interior`);
    assert.ok(
      weapons.secondary.cooldown_seconds > 3 && weapons.secondary.cooldown_seconds < 12,
      `cooldown_seconds ${weapons.secondary.cooldown_seconds} should be strictly interior`
    );
  });

  it('is a pure function (same input -> deep-equal output)', () => {
    const a = computeBaselineWeapons(MID_SLIDERS, 'plasma', 'emp_burst');
    const b = computeBaselineWeapons(MID_SLIDERS, 'plasma', 'emp_burst');
    assert.deepEqual(a, b);
  });

  // Antes de 2026-08-30 esta suíte travava um mapa `weapon_focus -> tipos` que só sabia produzir
  // `homing_missiles`. Agora os dois tipos chegam do Fast-Grill-Me e TODOS os 3x3 pares precisam
  // sobreviver ao Ajv -- inclusive `emp_burst` e `none`, que nenhum visitante conseguia escolher.
  for (const primary of PRIMARY_TYPES) {
    for (const secondary of SECONDARY_TYPES) {
      it(`passes the chosen pair '${primary}' + '${secondary}' straight through, and the result validates`, () => {
        const weapons = computeBaselineWeapons(MID_SLIDERS, primary, secondary);
        assert.equal(weapons.primary.type, primary);
        assert.equal(weapons.secondary.type, secondary);

        const spec = {
          ...FALLBACK_PRESETS.interceptor,
          attributes: computeBaselineAttributes(MID_SLIDERS),
          weapons
        };
        const result = validateShipSpecification(spec);
        assert.equal(result.isValid, true, JSON.stringify(result.errors));
      });
    }
  }

  // O EMP nunca deve valer o mesmo dano nominal que um míssil teleguiado. No piso de Ataque os dois
  // encostam no mínimo do schema (60), então a comparação estrita só vale acima dele.
  it('never gives emp_burst more nominal damage than homing_missiles, and strictly less above the floor', () => {
    for (const offense of [10, 20, 30, 40, 50]) {
      const sliders: EnergySliders = { offense, speed: 10, defense: 10, tech: 10 };
      const emp = computeBaselineWeapons(sliders, 'laser', 'emp_burst').secondary.damage;
      const homing = computeBaselineWeapons(sliders, 'laser', 'homing_missiles').secondary.damage;
      assert.ok(emp <= homing, `offense ${offense}: emp ${emp} should not exceed homing ${homing}`);
      if (offense > 10) {
        assert.ok(emp < homing, `offense ${offense}: emp ${emp} should be strictly below homing ${homing}`);
      }
    }
  });

  // `none` desliga a arma pelo `type`, não pelo número: o schema exige `damage >= 60`, então zero
  // reprovaria a nave inteira. O MCP `attach_secondary_ordnance` ainda devolve 0 nesse caso -- uma
  // inconsistência que nunca mordeu porque `none` era inalcançável.
  it('parks a `none` secondary at the schema floor instead of zero', () => {
    for (const sliders of [MIN_SLIDERS, MID_SLIDERS, MAX_SLIDERS]) {
      const weapons = computeBaselineWeapons(sliders, 'laser', 'none');
      assert.equal(weapons.secondary.damage, 60);
      assert.equal(weapons.secondary.cooldown_seconds, 3);
    }
  });
});
