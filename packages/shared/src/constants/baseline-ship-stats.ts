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

import { EnergySliders, PrimaryWeaponType, SecondaryWeaponType, ShipAttributes, ShipWeapons } from '../types/ship.js';
import { BALANCE } from './balance.js';

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

const SECONDARY_DAMAGE_RANGE = BALANCE.ranges['weapons.secondary.damage'];
const SECONDARY_COOLDOWN_RANGE = BALANCE.ranges['weapons.secondary.cooldown_seconds'];

/**
 * Fator do EMP sobre o dano nominal de um míssil, espelhando o que o MCP real já devolve
 * (`packages/mcps/src/weapons-arsenal.ts`: homing 100, emp 60).
 */
const EMP_DAMAGE_FACTOR = 0.6;

/**
 * Computes the deterministic baseline `weapons` block from the energy sliders
 * and the two weapon types the visitor picked in the Fast-Grill-Me, all driven by `offense`:
 *  - primary.damage:            number, [15, 45]  (full schema range, see BALANCE.ranges -- D14)
 *  - primary.fire_rate:         number, [5, 12]   (full schema range, see BALANCE.ranges -- D14)
 *    Since Task B2 regenerated `ship_spec.schema.json` from `BALANCE.ranges`, the schema's own
 *    bounds for these two fields ARE [15,45]/[5,12] -- there is no narrower "practical" sub-range
 *    to target anymore, and no render-time clamp left to match either (`WeaponSystem.firePrimary`
 *    no longer re-clamps; it consumes the validated value as-is). This module still computes them
 *    from `offense` the same way it always did; only the framing in this comment changes.
 *  - primary.bullet_speed:      number, [400, 800] (full schema range -- doesn't affect DPS balance)
 *  - primary.spread_angle:      number, [0, 30]    (full schema range)
 *  - secondary.damage:          number, [60, 150]  (full schema range), ESCALADO PELO TIPO
 *  - secondary.cooldown_seconds: number, [12, 3], INVERTED
 *    (higher offense -> shorter cooldown, fires more often, within the schema's [3,12] range)
 *
 * None of these fields require `"type": "integer"` in the schema, so they are
 * left as the raw interpolated float (no rounding forced).
 *
 * O dano da secundária depende do tipo escolhido. Até 2026-08-30 ele interpolava [60,150]
 * independentemente do tipo — o que era inofensivo enquanto a secundária era sempre
 * `homing_missiles`, e vira mentira agora que o piloto pode escolher EMP: um pulso EMP teria o
 * mesmo dano nominal de um míssil teleguiado. O fator segue o MCP real
 * (`packages/mcps/src/weapons-arsenal.ts`: homing 100, emp 60).
 *
 * `none` recebe o PISO do schema, não zero. O que desliga a arma é o `type`, não o número — e
 * `weapons.secondary.damage` tem `minimum: 60` no schema, então gravar 0 produziria uma spec que
 * o Ajv rejeita inteira. O menu do Fast-Grill-Me não oferece `none`; o caso existe só para specs
 * que já o tenham.
 */
export function computeBaselineWeapons(
  sliders: EnergySliders,
  primaryType: PrimaryWeaponType,
  secondaryType: SecondaryWeaponType
): ShipWeapons {
  const damage = lerpClamp(sliders.offense, SLIDER_MIN, SLIDER_MAX, 15, 45);
  const fire_rate = lerpClamp(sliders.offense, SLIDER_MIN, SLIDER_MAX, 5, 12);
  const bullet_speed = lerpClamp(sliders.offense, SLIDER_MIN, SLIDER_MAX, 400, 800);
  const spread_angle = lerpClamp(sliders.offense, SLIDER_MIN, SLIDER_MAX, 0, 30);

  const secondaryDamage = computeSecondaryDamage(sliders.offense, secondaryType);
  // Inverted: outMin (12) > outMax (3) -- higher offense yields a shorter cooldown, within the new [3,12] schema range.
  const cooldownSeconds =
    secondaryType === 'none'
      ? SECONDARY_COOLDOWN_RANGE.min
      : lerpClamp(sliders.offense, SLIDER_MIN, SLIDER_MAX, SECONDARY_COOLDOWN_RANGE.max, SECONDARY_COOLDOWN_RANGE.min);

  return {
    primary: {
      type: primaryType,
      damage,
      fire_rate,
      bullet_speed,
      spread_angle
    },
    secondary: {
      type: secondaryType,
      damage: secondaryDamage,
      cooldown_seconds: cooldownSeconds
    }
  };
}

/**
 * Dano da secundária, por tipo. Os dois extremos saem de `BALANCE.ranges` — nunca de literal —
 * pela mesma disciplina que `gen-schema.ts` aplica: o piso é o que o schema aceita, e um valor
 * abaixo dele não é "mais fraco", é inválido.
 */
function computeSecondaryDamage(offense: number, type: SecondaryWeaponType): number {
  const { min, max } = SECONDARY_DAMAGE_RANGE;
  if (type === 'none') return min;
  if (type === 'emp_burst') {
    // Teto reduzido, piso preservado: no ataque máximo o EMP causa 60% do que um míssil causaria.
    return lerpClamp(offense, SLIDER_MIN, SLIDER_MAX, min, max * EMP_DAMAGE_FACTOR);
  }
  return lerpClamp(offense, SLIDER_MIN, SLIDER_MAX, min, max);
}
