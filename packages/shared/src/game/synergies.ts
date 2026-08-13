import { BALANCE } from '../constants/balance.js';
import type { ShipAttributes, ShipSpecification, ShipWeapons } from '../types/ship.js';

export type SynergyName = 'Glass Cannon' | 'Titan Fortress' | 'Ghost Interceptor' | 'Balanced Ace';

const KNOWN: SynergyName[] = ['Glass Cannon', 'Titan Fortress', 'Ghost Interceptor', 'Balanced Ace'];

function clampToRange(value: number, key: keyof typeof BALANCE.ranges): number {
  const r = BALANCE.ranges[key];
  const bounded = Math.min(r.max, Math.max(r.min, value));
  return r.integer ? Math.round(bounded) : bounded;
}

/**
 * Aplica a matriz de sinergias da Spec 02 §6 aos atributos já validados.
 * Pura de propósito: o simulador (Spec 09 §5) precisa da mesma transformação
 * sem instanciar Phaser.
 */
export function applySynergies(spec: ShipSpecification): {
  attributes: ShipAttributes;
  weapons: ShipWeapons;
  applied: SynergyName[];
} {
  const attributes = structuredClone(spec.attributes);
  const weapons = structuredClone(spec.weapons);
  const declared = spec.build_metadata?.synergies_unlocked || [];
  const applied = KNOWN.filter((name) => declared.includes(name));

  for (const name of applied) {
    if (name === 'Glass Cannon') {
      const s = BALANCE.synergies.glass_cannon;
      weapons.primary.damage = weapons.primary.damage * s.primary_damage_factor;
      attributes.max_hp = s.forced_max_hp;
    } else if (name === 'Titan Fortress') {
      const s = BALANCE.synergies.titan_fortress;
      attributes.max_hp = s.forced_max_hp;
      attributes.shield_capacity = Math.max(attributes.shield_capacity, s.min_shield_capacity);
    } else if (name === 'Ghost Interceptor') {
      attributes.speed_px_s = BALANCE.ranges['attributes.speed_px_s'].max;
      attributes.hitbox_radius = BALANCE.ranges['attributes.hitbox_radius'].min;
    } else if (name === 'Balanced Ace') {
      const f = BALANCE.synergies.balanced_ace.all_attributes_factor;
      attributes.max_hp = clampToRange(attributes.max_hp * f, 'attributes.max_hp');
      attributes.shield_capacity = clampToRange(attributes.shield_capacity * f, 'attributes.shield_capacity');
      attributes.speed_px_s = clampToRange(attributes.speed_px_s * f, 'attributes.speed_px_s');
      weapons.primary.damage = clampToRange(weapons.primary.damage * f, 'weapons.primary.damage');
    }
  }

  return { attributes, weapons, applied };
}

/** Titan Fortress regenera 1 HP a cada intervalo. Consultado pelo relógio da partida. */
export function regeneratesHp(applied: SynergyName[]): boolean {
  return applied.includes('Titan Fortress');
}
