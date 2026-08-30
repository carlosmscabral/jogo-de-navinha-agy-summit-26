import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BALANCE } from '../constants/balance.js';
import { ACCENT_COLORS, VISUAL_THEMES } from '../constants/visual-catalog.js';

type NumericNode = { type: 'integer' | 'number'; minimum: number; maximum: number };

/**
 * Enums de arma, declarados uma vez. `weapons.*.type` e `fast_grill_me_choices.*_weapon` são o
 * mesmo conjunto por construção — a escolha do PASSO 1 é o tipo que a nave recebe — e duas listas
 * separadas poderiam divergir sem que nada reclamasse.
 */
const PRIMARY_WEAPON_ENUM = ['plasma', 'laser', 'vulcan_spread'] as const;
const SECONDARY_WEAPON_ENUM = ['homing_missiles', 'emp_burst', 'none'] as const;

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
            required: ['primary_weapon', 'secondary_weapon', 'visual_theme', 'accent_color'],
            properties: {
              primary_weapon: { type: 'string', enum: [...PRIMARY_WEAPON_ENUM] },
              // `none` continua no enum ainda que o menu não o ofereça: o schema aceita quem já
              // tem, e os presets e helpers de teste usam o valor.
              secondary_weapon: { type: 'string', enum: [...SECONDARY_WEAPON_ENUM] },
              visual_theme: { type: 'string', enum: Object.keys(VISUAL_THEMES) },
              accent_color: { type: 'string', enum: Object.keys(ACCENT_COLORS) }
            }
          },
          synergies_unlocked: { type: 'array', items: { type: 'string' } },
          fallback_used: { type: 'boolean' },
          pilot_tips: {
            type: 'array',
            maxItems: 3,
            items: { type: 'string', minLength: 8, maxLength: 140 }
          }
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
              type: { type: 'string', enum: [...PRIMARY_WEAPON_ENUM] },
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
              type: { type: 'string', enum: [...SECONDARY_WEAPON_ENUM] },
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
