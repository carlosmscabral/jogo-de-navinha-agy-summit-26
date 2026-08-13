import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BALANCE } from '../constants/balance.js';

type NumericNode = { type: 'integer' | 'number'; minimum: number; maximum: number };

function numeric(key: keyof typeof BALANCE.ranges): NumericNode {
  const r = BALANCE.ranges[key];
  return { type: r.integer ? 'integer' : 'number', minimum: r.min, maximum: r.max };
}

const HEX_COLOR = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } as const;

/**
 * Constrói o JSON Schema Draft-07 do ship_spec a partir de BALANCE.ranges.
 * Nenhuma faixa numérica é literal aqui — se um valor precisa mudar, ele muda
 * em balance.ts e este arquivo apenas o propaga.
 */
export function buildShipSpecSchema(): Record<string, unknown> {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'ShipSpecification',
    type: 'object',
    additionalProperties: false,
    required: ['pilot', 'build_metadata', 'attributes', 'weapons', 'visuals'],
    properties: {
      pilot: {
        type: 'object',
        additionalProperties: false,
        required: ['callsign', 'company_raw', 'company_canonical'],
        properties: {
          callsign: { type: 'string', minLength: 1, maxLength: 15 },
          company_raw: { type: 'string', minLength: 1, maxLength: 40 },
          company_canonical: { type: 'string', minLength: 1, maxLength: 40 }
        }
      },
      build_metadata: {
        type: 'object',
        additionalProperties: false,
        required: ['selected_mcps', 'selected_subagents', 'energy_sliders', 'fast_grill_me_choices', 'synergies_unlocked'],
        properties: {
          selected_mcps: {
            type: 'array',
            minItems: 1,
            maxItems: 3,
            items: { type: 'string', enum: ['weapons-arsenal', 'hull-propulsion', 'cybernetics-shields'] }
          },
          selected_subagents: {
            type: 'array',
            items: { type: 'string', enum: ['aesthetic-designer', 'combat-strategist', 'systems-engineer'] }
          },
          energy_sliders: {
            type: 'object',
            additionalProperties: false,
            required: ['offense', 'speed', 'defense', 'tech'],
            properties: {
              offense: numeric('build_metadata.energy_sliders.offense'),
              speed: numeric('build_metadata.energy_sliders.speed'),
              defense: numeric('build_metadata.energy_sliders.defense'),
              tech: numeric('build_metadata.energy_sliders.tech')
            }
          },
          fast_grill_me_choices: {
            type: 'object',
            additionalProperties: false,
            required: ['weapon_focus', 'visual_theme'],
            properties: {
              weapon_focus: { type: 'string', enum: ['laser_piercing', 'missile_barrage', 'vulcan_spread'] },
              visual_theme: { type: 'string', enum: ['synthwave_80s', 'dark_void_stealth', 'cyberpunk_gold'] }
            }
          },
          synergies_unlocked: { type: 'array', items: { type: 'string' } },
          fallback_used: { type: 'boolean' }
        }
      },
      attributes: {
        type: 'object',
        additionalProperties: false,
        required: ['max_hp', 'shield_capacity', 'speed_px_s', 'hitbox_radius'],
        properties: {
          max_hp: numeric('attributes.max_hp'),
          shield_capacity: numeric('attributes.shield_capacity'),
          speed_px_s: numeric('attributes.speed_px_s'),
          hitbox_radius: numeric('attributes.hitbox_radius')
        }
      },
      weapons: {
        type: 'object',
        additionalProperties: false,
        required: ['primary', 'secondary'],
        properties: {
          primary: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'damage', 'fire_rate', 'bullet_speed', 'spread_angle'],
            properties: {
              type: { type: 'string', enum: ['plasma', 'laser', 'vulcan_spread'] },
              damage: numeric('weapons.primary.damage'),
              fire_rate: numeric('weapons.primary.fire_rate'),
              bullet_speed: numeric('weapons.primary.bullet_speed'),
              spread_angle: numeric('weapons.primary.spread_angle')
            }
          },
          secondary: {
            type: 'object',
            additionalProperties: false,
            required: ['type', 'damage', 'cooldown_seconds'],
            properties: {
              type: { type: 'string', enum: ['homing_missiles', 'emp_burst', 'none'] },
              damage: numeric('weapons.secondary.damage'),
              cooldown_seconds: numeric('weapons.secondary.cooldown_seconds')
            }
          }
        }
      },
      visuals: {
        type: 'object',
        additionalProperties: false,
        required: ['style_name', 'primary_color', 'secondary_color', 'engine_trail_color', 'svg_path_data'],
        properties: {
          style_name: { type: 'string', minLength: 1, maxLength: 40 },
          primary_color: HEX_COLOR,
          secondary_color: HEX_COLOR,
          engine_trail_color: HEX_COLOR,
          svg_path_data: { type: 'string', minLength: 10, maxLength: 4000 }
        }
      }
    }
  };
}

/** Ponto de entrada de `npm run gen:schema`. */
function main(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));           // dist/schema
  const target = path.resolve(here, '..', '..', 'src', 'schema', 'ship_spec.schema.json');
  fs.writeFileSync(target, JSON.stringify(buildShipSpecSchema(), null, 2) + '\n', 'utf8');
  console.log(`[gen-schema] ${target} regerado a partir de BALANCE.ranges`);
}

if (process.argv[1] && process.argv[1].endsWith('gen-schema.js')) {
  main();
}
