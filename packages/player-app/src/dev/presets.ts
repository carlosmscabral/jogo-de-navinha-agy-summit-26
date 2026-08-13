import { BALANCE, FALLBACK_PRESETS, ShipSpecification, PrimaryWeaponSpec, SecondaryWeaponSpec } from '@jogo/shared';

const R = BALANCE.ranges;

/**
 * Builds a synthetic ship spec from a range selector. No numeric literal for anything the game
 * balances against — every number for `attributes` and `weapons` comes from `BALANCE.ranges` via
 * `pick`, so if Task B8 changes a range these presets move with it automatically.
 *
 * `pilot`, `build_metadata` and `visuals` are cosmetic/bookkeeping fields not consumed by the
 * engine's balance-sensitive code paths, so they're inherited from `FALLBACK_PRESETS.interceptor`
 * verbatim (aside from a distinguishing name) rather than re-derived from ranges.
 */
function fromRanges(
  name: string,
  pick: (key: keyof typeof BALANCE.ranges) => number,
  overrides: {
    attributes?: Partial<ShipSpecification['attributes']>;
    weapons?: { primary?: PrimaryWeaponSpec; secondary?: SecondaryWeaponSpec };
  } = {}
): ShipSpecification {
  const base = FALLBACK_PRESETS.interceptor;

  const attributes: ShipSpecification['attributes'] = {
    max_hp: pick('attributes.max_hp'),
    shield_capacity: pick('attributes.shield_capacity'),
    speed_px_s: pick('attributes.speed_px_s'),
    hitbox_radius: pick('attributes.hitbox_radius'),
    ...overrides.attributes
  };

  const primary: PrimaryWeaponSpec = overrides.weapons?.primary ?? {
    type: base.weapons.primary.type,
    damage: pick('weapons.primary.damage'),
    fire_rate: pick('weapons.primary.fire_rate'),
    bullet_speed: pick('weapons.primary.bullet_speed'),
    spread_angle: pick('weapons.primary.spread_angle')
  };

  const secondary: SecondaryWeaponSpec = overrides.weapons?.secondary ?? {
    type: base.weapons.secondary.type,
    damage: pick('weapons.secondary.damage'),
    cooldown_seconds: pick('weapons.secondary.cooldown_seconds')
  };

  return {
    pilot: { ...base.pilot, callsign: name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 15) || 'DEV_PRESET' },
    build_metadata: { ...base.build_metadata },
    attributes,
    weapons: { primary, secondary },
    visuals: { ...base.visuals, style_name: name }
  };
}

export const DEV_PRESETS: Record<string, ShipSpecification> = {
  interceptor: FALLBACK_PRESETS.interceptor,
  vanguard: FALLBACK_PRESETS.vanguard,
  striker: FALLBACK_PRESETS.striker,
  minimo: fromRanges('Mínimo', (key) => R[key].min),
  maximo: fromRanges('Máximo', (key) => R[key].max),

  // Sim archetypes (Spec 09 §5.1), reused by Task B7's headless simulator:
  glass_cannon: fromRanges('Canhão de Vidro', (key) => R[key].max, {
    attributes: {
      max_hp: R['attributes.max_hp'].min,
      shield_capacity: R['attributes.shield_capacity'].min
    },
    weapons: {
      primary: {
        type: 'laser',
        damage: R['weapons.primary.damage'].max,
        fire_rate: R['weapons.primary.fire_rate'].max,
        bullet_speed: R['weapons.primary.bullet_speed'].max,
        spread_angle: R['weapons.primary.spread_angle'].min
      },
      secondary: {
        type: 'homing_missiles',
        damage: R['weapons.secondary.damage'].max,
        cooldown_seconds: R['weapons.secondary.cooldown_seconds'].min
      }
    }
  }),
  vulcan_max: fromRanges('Vulcan Máximo', (key) => R[key].max, {
    weapons: {
      primary: {
        type: 'vulcan_spread',
        damage: R['weapons.primary.damage'].max,
        fire_rate: R['weapons.primary.fire_rate'].max,
        bullet_speed: R['weapons.primary.bullet_speed'].max,
        spread_angle: R['weapons.primary.spread_angle'].max
      },
      secondary: {
        type: 'homing_missiles',
        damage: R['weapons.secondary.damage'].max,
        cooldown_seconds: R['weapons.secondary.cooldown_seconds'].min
      }
    }
  }),
  tanque: fromRanges('Tanque', (key) => R[key].min, {
    attributes: {
      max_hp: R['attributes.max_hp'].max,
      shield_capacity: R['attributes.shield_capacity'].max
    },
    weapons: {
      primary: {
        type: 'plasma',
        damage: R['weapons.primary.damage'].min,
        fire_rate: R['weapons.primary.fire_rate'].min,
        bullet_speed: R['weapons.primary.bullet_speed'].min,
        spread_angle: R['weapons.primary.spread_angle'].min
      },
      secondary: {
        type: 'emp_burst',
        damage: R['weapons.secondary.damage'].min,
        cooldown_seconds: R['weapons.secondary.cooldown_seconds'].max
      }
    }
  })
};
