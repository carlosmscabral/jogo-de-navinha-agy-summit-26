import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { XMLValidator } from 'fast-xml-parser';
import {
  NEUTRAL_HULL_PATH,
  SHIP_CARD_VERSION,
  VIEWBOX_SIZE,
  isDrawablePathData,
  isSafePathData,
  pathExtent,
  renderShipCardSvg
} from './ship-card-svg.js';
import { VISUAL_THEMES } from '../constants/visual-catalog.js';
import { FALLBACK_PRESETS } from '../constants/fallback-presets.js';
import type { ShipSpecification } from '../types/ship.js';

/** Casco válido e reconhecível: serve para provar que o `d` sai byte-idêntico ao que entrou. */
const VALID_PATH = 'M 64 8 C 80 40, 96 72, 88 118 L 40 118 C 32 72, 48 40, 64 8 Z';

function makeSpec(overrides: {
  shield?: number;
  visuals?: Partial<ShipSpecification['visuals']>;
  theme?: ShipSpecification['build_metadata']['fast_grill_me_choices']['visual_theme'];
}): ShipSpecification {
  return {
    pilot: { callsign: 'CORVO', company_raw: 'AGY', company_canonical: 'AGY' },
    build_metadata: {
      selected_mcps: ['weapons-arsenal'],
      selected_subagents: ['aesthetic-designer'],
      energy_sliders: { offense: 25, speed: 25, defense: 25, tech: 25 },
      fast_grill_me_choices: {
        primary_weapon: 'plasma',
        secondary_weapon: 'homing_missiles',
        visual_theme: overrides.theme ?? 'synthwave_80s',
        accent_color: 'rosa_choque'
      },
      synergies_unlocked: []
    },
    attributes: {
      max_hp: 3,
      shield_capacity: overrides.shield ?? 0,
      speed_px_s: 260,
      hitbox_radius: 12
    },
    weapons: {
      primary: { type: 'plasma', damage: 1, fire_rate: 4, bullet_speed: 600, spread_angle: 0 },
      secondary: { type: 'homing_missiles', damage: 3, cooldown_seconds: 6 }
    },
    visuals: {
      style_name: 'Interceptor Delta',
      primary_color: '#38bdf8',
      secondary_color: '#a78bfa',
      engine_trail_color: '#ff9e0b',
      svg_path_data: VALID_PATH,
      ...overrides.visuals
    }
  };
}

/** Extrai o valor de um atributo do primeiro elemento com o nome dado. */
function attr(svg: string, element: string, name: string): string | null {
  const tag = svg.match(new RegExp(`<${element}\\b[^>]*>`));
  if (!tag) return null;
  const found = tag[0].match(new RegExp(`\\b${name}="([^"]*)"`));
  return found ? found[1] : null;
}

describe('validadores de path (movidos de SvgShipRenderer)', () => {
  it('aceita um path dentro do contrato e recusa lixo', () => {
    assert.equal(isSafePathData(VALID_PATH), true);
    assert.equal(isSafePathData('M 1 1'), false, 'curto demais para ser um casco');
    assert.equal(isSafePathData('M 64 8 L 90 90 Z" onload="alert(1)'), false);
    assert.equal(isSafePathData(undefined as unknown as string), false);
  });

  it('mede a extensão numérica do path', () => {
    assert.deepEqual(pathExtent('M 10 20 L -5 128 Z'), { min: -5, max: 128 });
    assert.deepEqual(pathExtent('Z'), { min: 0, max: 0 });
  });

  it('recusa path que estoura o viewBox além da folga', () => {
    assert.equal(isDrawablePathData('M 0 0 L 128 128 L 0 128 Z'), true);
    assert.equal(isDrawablePathData('M 0 0 L 900 900 L 0 900 Z'), false);
  });
});

describe('renderShipCardSvg', () => {
  it('desenha o anel de escudo quando a build tem escudo', () => {
    const svg = renderShipCardSvg(makeSpec({ shield: 2 }));
    assert.match(svg, /<circle\b/);
    assert.equal(attr(svg, 'circle', 'cx'), String(VIEWBOX_SIZE / 2));
    assert.equal(attr(svg, 'circle', 'stroke'), '#ff9e0b', 'o anel usa a cor do rastro do motor');
  });

  it('não desenha anel nenhum quando a build não tem escudo', () => {
    const svg = renderShipCardSvg(makeSpec({ shield: 0 }));
    assert.doesNotMatch(svg, /<circle\b/);
  });

  it('mantém o mesmo viewBox com e sem escudo, para a nave não pular de tamanho na galeria', () => {
    const comEscudo = renderShipCardSvg(makeSpec({ shield: 3 }));
    const semEscudo = renderShipCardSvg(makeSpec({ shield: 0 }));
    assert.equal(attr(comEscudo, 'svg', 'viewBox'), attr(semEscudo, 'svg', 'viewBox'));
    assert.equal(attr(comEscudo, 'svg', 'width'), attr(semEscudo, 'svg', 'width'));
  });

  it('devolve o svg_path_data byte-idêntico quando ele é desenhável', () => {
    const svg = renderShipCardSvg(makeSpec({}));
    assert.equal(attr(svg, 'path', 'd'), VALID_PATH);
  });

  it('cai na silhueta neutra quando o casco não é desenhável, sem quebrar o SVG', () => {
    const svg = renderShipCardSvg(
      makeSpec({ visuals: { svg_path_data: 'M 0 0 L 5000 5000 Z' } })
    );
    assert.equal(attr(svg, 'path', 'd'), NEUTRAL_HULL_PATH);
    assert.equal(XMLValidator.validate(svg), true);
  });

  it('cai na silhueta neutra quando o casco vem vazio', () => {
    const svg = renderShipCardSvg(makeSpec({ visuals: { svg_path_data: '' } }));
    assert.equal(attr(svg, 'path', 'd'), NEUTRAL_HULL_PATH);
  });

  it('desenha um preset de emergência com a silhueta neutra — igual ao que o piloto viu', () => {
    // Os presets de fallback trazem MARCAÇÃO SVG em `svg_path_data` (`<polygon .../>` e
    // companhia), não comandos de path. `isDrawablePathData` recusa, e é assim que o jogo e o
    // pré-voo já se comportam hoje: `usesForgedHull` também recusa, e a nave é a procedural.
    // O cartão só pode fazer o mesmo — mostrar o casco do preset aqui seria mostrar uma nave que
    // o visitante nunca viu na tela. As CORES do preset, essas sim, são preservadas.
    const preset = FALLBACK_PRESETS.interceptor;
    assert.equal(
      isDrawablePathData(preset.visuals.svg_path_data),
      false,
      'pré-condição: o preset não traz um path desenhável'
    );

    const svg = renderShipCardSvg(preset);
    assert.equal(attr(svg, 'path', 'd'), NEUTRAL_HULL_PATH);
    assert.equal(attr(svg, 'path', 'fill'), preset.visuals.primary_color);
    assert.equal(XMLValidator.validate(svg), true);
  });

  it('cai na paleta do tema quando uma cor não é um hex de 6 dígitos', () => {
    const palette = VISUAL_THEMES.cyberpunk_gold.palette;
    const svg = renderShipCardSvg(
      makeSpec({
        shield: 1,
        theme: 'cyberpunk_gold',
        visuals: { primary_color: 'red', secondary_color: '#GGG', engine_trail_color: '#abc' }
      })
    );
    assert.equal(attr(svg, 'path', 'fill'), palette.primary_color);
    assert.equal(attr(svg, 'path', 'stroke'), palette.secondary_color);
    assert.equal(attr(svg, 'circle', 'stroke'), palette.engine_trail_color);
  });

  it('escapa o style_name, que é texto livre escrito por um LLM', () => {
    const svg = renderShipCardSvg(
      makeSpec({ visuals: { style_name: `<script>alert("x" & 'y')</script>` } })
    );
    assert.doesNotMatch(svg, /<script>/);
    assert.match(svg, /<title>&lt;script&gt;alert\(&quot;x&quot; &amp; &apos;y&apos;\)/);
    assert.equal(XMLValidator.validate(svg), true);
  });

  it('produz um documento XML bem formado, com escudo e sem', () => {
    for (const shield of [0, 3]) {
      const svg = renderShipCardSvg(makeSpec({ shield }));
      assert.equal(XMLValidator.validate(svg), true, `escudo=${shield}`);
      assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
      assert.match(svg, /<\/svg>$/);
    }
  });

  it('não vaza identidade do piloto para dentro do cartão', () => {
    const svg = renderShipCardSvg(makeSpec({}));
    assert.doesNotMatch(svg, /CORVO/);
    assert.doesNotMatch(svg, /AGY/);
  });

  it('a versão do cartão é um inteiro positivo', () => {
    assert.equal(Number.isInteger(SHIP_CARD_VERSION), true);
    assert.ok(SHIP_CARD_VERSION >= 1);
  });
});
