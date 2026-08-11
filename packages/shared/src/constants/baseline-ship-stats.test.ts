import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeBaselineAttributes, computeBaselineWeapons } from './baseline-ship-stats.js';
import { EnergySliders, FastGrillMeWeaponFocus } from '../types/ship.js';

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
  it('produces every weapon field at its schema minimum when offense is at its minimum', () => {
    const weapons = computeBaselineWeapons(MIN_SLIDERS, 'laser_piercing');
    assert.equal(weapons.primary.damage, 10);
    assert.equal(weapons.primary.fire_rate, 2);
    assert.equal(weapons.primary.bullet_speed, 400);
    assert.equal(weapons.primary.spread_angle, 0);
    assert.equal(weapons.secondary.damage, 0);
    // cooldown_seconds is inverted: min offense -> MAX cooldown
    assert.equal(weapons.secondary.cooldown_seconds, 20);
  });

  it('produces every weapon field at its schema maximum when offense is at its maximum', () => {
    const weapons = computeBaselineWeapons(MAX_SLIDERS, 'laser_piercing');
    assert.equal(weapons.primary.damage, 60);
    assert.equal(weapons.primary.fire_rate, 60);
    assert.equal(weapons.primary.bullet_speed, 800);
    assert.equal(weapons.primary.spread_angle, 30);
    assert.equal(weapons.secondary.damage, 150);
    // cooldown_seconds is inverted: max offense -> MIN cooldown
    assert.equal(weapons.secondary.cooldown_seconds, 0);
  });

  it('lands strictly between the bounds for an interior slider value', () => {
    const weapons = computeBaselineWeapons(MID_SLIDERS, 'laser_piercing');
    assert.ok(weapons.primary.damage > 10 && weapons.primary.damage < 60, `damage ${weapons.primary.damage} should be strictly interior`);
    assert.ok(
      weapons.secondary.cooldown_seconds > 0 && weapons.secondary.cooldown_seconds < 20,
      `cooldown_seconds ${weapons.secondary.cooldown_seconds} should be strictly interior`
    );
  });

  it('is a pure function (same input -> deep-equal output)', () => {
    const a = computeBaselineWeapons(MID_SLIDERS, 'missile_barrage');
    const b = computeBaselineWeapons(MID_SLIDERS, 'missile_barrage');
    assert.deepEqual(a, b);
  });

  const focusMappings: Array<{
    focus: FastGrillMeWeaponFocus;
    primary: string;
    secondary: string;
  }> = [
    { focus: 'laser_piercing', primary: 'laser', secondary: 'homing_missiles' },
    { focus: 'missile_barrage', primary: 'plasma', secondary: 'homing_missiles' },
    { focus: 'vulcan_spread', primary: 'vulcan_spread', secondary: 'homing_missiles' }
  ];

  for (const { focus, primary, secondary } of focusMappings) {
    it(`maps weapon_focus '${focus}' to primary.type '${primary}' and secondary.type '${secondary}'`, () => {
      const weapons = computeBaselineWeapons(MID_SLIDERS, focus);
      assert.equal(weapons.primary.type, primary);
      assert.equal(weapons.secondary.type, secondary);
    });
  }
});
