/**
 * Deterministic baseline ship stats.
 *
 * When a visitor selects fewer than all 3 MCPs, the domains covered by the
 * UNSELECTED MCPs must still be fully populated for `ShipSpecification` to pass
 * schema validation (see `packages/shared/src/schema/ship_spec.schema.json`).
 * This module computes plausible, schema-safe values for those domains purely
 * from the visitor's energy sliders -- no AI calls, no I/O, fully deterministic.
 *
 * For a SELECTED MCP's domain, the real AI-calibrated values from the
 * corresponding MCP tool are used instead (unchanged, wired in a later task).
 * This module is never consumed by the MCP tool servers themselves
 * (see `packages/mcps/src/*.ts`, which keep their own independent formulas).
 */

import { EnergySliders, FastGrillMeWeaponFocus, PrimaryWeaponType, SecondaryWeaponType, ShipAttributes, ShipWeapons } from '../types/ship.js';

/** Expected range of every `EnergySliders` field (builder-enforced upstream; not validated here). */
const SLIDER_MIN = 10;
const SLIDER_MAX = 50;

/**
 * Linearly interpolates `value` from the input range `[inMin, inMax]` onto the
 * output range `[outMin, outMax]`, clamping the normalized input position to
 * `[0, 1]` first so the result can never leave the closed interval between
 * `outMin` and `outMax` regardless of how far `value` strays outside
 * `[inMin, inMax]`.
 *
 * Supports "inverted" mappings where `outMin > outMax`: the output always moves
 * in the direction implied by `(outMax - outMin)`, so `value === inMax` yields
 * `outMax` and `value === inMin` yields `outMin`, even when `outMin > outMax`.
 */
function lerpClamp(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  const t = (value - inMin) / (inMax - inMin);
  const clampedT = Math.min(1, Math.max(0, t));
  return outMin + clampedT * (outMax - outMin);
}

/**
 * Rounds `value` to the nearest integer, then clamps it into `[min, max]`.
 * Clamping happens AFTER rounding so that rounding can never push the result
 * out of the schema's integer bounds (e.g. a value at 4.9999999 that rounds to
 * 5 is fine and stays clamped at 5; a value that somehow rounds to 6 is pulled
 * back down to 5).
 */
function roundClampInt(value: number, min: number, max: number): number {
  const rounded = Math.round(value);
  return Math.min(max, Math.max(min, rounded));
}

/**
 * Computes the deterministic baseline `attributes` block from the energy
 * sliders. Schema bounds (from `ship_spec.schema.json`):
 *  - max_hp:          integer, [2, 5],     driven by `defense`
 *  - shield_capacity: integer, [0, 3],     driven by `tech`
 *  - speed_px_s:      number,  [180, 380], driven by `speed`
 *  - hitbox_radius:   number,  [8, 16],    driven by `speed`, INVERTED
 *    (higher speed slider -> smaller hitbox radius; same direction as the
 *    `hull-propulsion` MCP's `tune_thrusters` tool, see
 *    packages/mcps/src/hull-propulsion.ts:24-26, though the exact numbers here
 *    are independent of that tool's formula).
 */
export function computeBaselineAttributes(sliders: EnergySliders): ShipAttributes {
  const max_hp = roundClampInt(lerpClamp(sliders.defense, SLIDER_MIN, SLIDER_MAX, 2, 5), 2, 5);
  const shield_capacity = roundClampInt(lerpClamp(sliders.tech, SLIDER_MIN, SLIDER_MAX, 0, 3), 0, 3);
  const speed_px_s = lerpClamp(sliders.speed, SLIDER_MIN, SLIDER_MAX, 180, 380);
  // Inverted: outMin (16) > outMax (8) -- higher speed slider yields a smaller radius.
  const hitbox_radius = lerpClamp(sliders.speed, SLIDER_MIN, SLIDER_MAX, 16, 8);

  return { max_hp, shield_capacity, speed_px_s, hitbox_radius };
}

/**
 * First-cut mapping from the Fast-Grill-Me `weapon_focus` choice to the
 * baseline `weapons.primary.type` / `weapons.secondary.type`. There is no 1:1
 * correspondence between `FastGrillMeWeaponFocus` and `PrimaryWeaponType`, so
 * this mapping was chosen during planning:
 *
 *   'laser_piercing'  -> primary: 'laser',         secondary: 'homing_missiles'
 *   'vulcan_spread'   -> primary: 'vulcan_spread',  secondary: 'homing_missiles'
 *   'missile_barrage' -> primary: 'plasma',         secondary: 'homing_missiles'
 *
 * Secondary type is always `'homing_missiles'` for the baseline -- the visitor
 * never explicitly chooses a secondary weapon type in the Fast-Grill-Me flow.
 */
const WEAPON_FOCUS_TO_TYPES: Record<FastGrillMeWeaponFocus, { primary: PrimaryWeaponType; secondary: SecondaryWeaponType }> = {
  laser_piercing: { primary: 'laser', secondary: 'homing_missiles' },
  vulcan_spread: { primary: 'vulcan_spread', secondary: 'homing_missiles' },
  missile_barrage: { primary: 'plasma', secondary: 'homing_missiles' }
};

/**
 * Computes the deterministic baseline `weapons` block from the energy sliders
 * and the visitor's Fast-Grill-Me weapon focus choice, all driven by `offense`:
 *  - primary.damage:            number, [15, 45]  -- practical range, NOT the schema's full [10,60].
 *  - primary.fire_rate:         number, [5, 12]   -- practical range, NOT the schema's full [2,60].
 *    Both are intentionally narrowed to the range the real `weapons-arsenal` MCP is guided to
 *    produce (see GEMINI.md's contract table in workspace-generator.ts) and the range
 *    `WeaponSystem.firePrimary` clamps to at render time
 *    (packages/player-app/src/game/weapons/WeaponSystem.ts). Targeting the full schema envelope
 *    here let an unselected-weapons-arsenal baseline out-DPS a real, selected, AI-calibrated
 *    ship, inverting the "fewer MCPs = weaker but higher score multiplier" tradeoff. The schema's
 *    full [10,60]/[2,60] bounds remain the hard outer limit the validator enforces; this module
 *    deliberately targets a narrower practical sub-range within them.
 *  - primary.bullet_speed:      number, [400, 800] (full schema range -- doesn't affect DPS balance)
 *  - primary.spread_angle:      number, [0, 30]    (full schema range)
 *  - secondary.damage:          number, [60, 150]  (full schema range)
 *  - secondary.cooldown_seconds: number, [12, 3], INVERTED
 *    (higher offense -> shorter cooldown, fires more often, within the schema's [3,12] range)
 *
 * None of these fields require `"type": "integer"` in the schema, so they are
 * left as the raw interpolated float (no rounding forced).
 */
export function computeBaselineWeapons(sliders: EnergySliders, weaponFocus: FastGrillMeWeaponFocus): ShipWeapons {
  const types = WEAPON_FOCUS_TO_TYPES[weaponFocus];

  const damage = lerpClamp(sliders.offense, SLIDER_MIN, SLIDER_MAX, 15, 45);
  const fire_rate = lerpClamp(sliders.offense, SLIDER_MIN, SLIDER_MAX, 5, 12);
  const bullet_speed = lerpClamp(sliders.offense, SLIDER_MIN, SLIDER_MAX, 400, 800);
  const spread_angle = lerpClamp(sliders.offense, SLIDER_MIN, SLIDER_MAX, 0, 30);

  const secondaryDamage = lerpClamp(sliders.offense, SLIDER_MIN, SLIDER_MAX, 60, 150);
  // Inverted: outMin (12) > outMax (3) -- higher offense yields a shorter cooldown, within the new [3,12] schema range.
  const cooldownSeconds = lerpClamp(sliders.offense, SLIDER_MIN, SLIDER_MAX, 12, 3);

  return {
    primary: {
      type: types.primary,
      damage,
      fire_rate,
      bullet_speed,
      spread_angle
    },
    secondary: {
      type: types.secondary,
      damage: secondaryDamage,
      cooldown_seconds: cooldownSeconds
    }
  };
}
