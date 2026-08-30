import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCENT_COLOR_ORDER,
  ACCENT_COLORS,
  AccentColorName,
  VISUAL_THEME_ORDER,
  VISUAL_THEMES
} from './visual-catalog.js';
import { FALLBACK_PRESETS } from './fallback-presets.js';

const HEX = /^#[0-9a-fA-F]{6}$/;

describe('ACCENT_COLORS', () => {
  it('gives every curated color a six-digit hex', () => {
    for (const [name, entry] of Object.entries(ACCENT_COLORS)) {
      assert.match(entry.hex, HEX, `${name} hex ${entry.hex}`);
      assert.ok(entry.label.length > 0, `${name} has no label`);
    }
  });

  it('orders exactly the colors that exist, once each', () => {
    assert.deepEqual([...ACCENT_COLOR_ORDER].sort(), Object.keys(ACCENT_COLORS).sort());
    assert.equal(new Set(ACCENT_COLOR_ORDER).size, ACCENT_COLOR_ORDER.length);
  });
});

describe('VISUAL_THEMES', () => {
  it('gives every theme a full hex palette', () => {
    for (const [name, theme] of Object.entries(VISUAL_THEMES)) {
      assert.match(theme.palette.primary_color, HEX, `${name} primary_color`);
      assert.match(theme.palette.secondary_color, HEX, `${name} secondary_color`);
      assert.match(theme.palette.engine_trail_color, HEX, `${name} engine_trail_color`);
      assert.ok(theme.label.length > 0, `${name} has no label`);
      assert.ok(theme.blurb.length > 0, `${name} has no blurb`);
    }
  });

  // O backfill de `normalizeSpec` cai neste campo quando o agente omite `accent_color`. Um
  // signature_accent inválido viraria SCHEMA_INVALID num campo puramente cosmético.
  it('points every signature_accent at a real accent color', () => {
    for (const [name, theme] of Object.entries(VISUAL_THEMES)) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(ACCENT_COLORS, theme.signature_accent),
        `${name} signature_accent '${theme.signature_accent}' is not a curated color`
      );
    }
  });

  it('orders exactly the themes that exist, once each', () => {
    assert.deepEqual([...VISUAL_THEME_ORDER].sort(), Object.keys(VISUAL_THEMES).sort());
    assert.equal(new Set(VISUAL_THEME_ORDER).size, VISUAL_THEME_ORDER.length);
  });
});

// As paletas dos temas foram extraídas dos presets de emergência, que eram os únicos hexes de tema
// já validados no repo. Os presets agora consomem `VISUAL_THEMES[...].palette`; este teste garante
// que ninguém volte a escrever um literal e faça um preset divergir do seu próprio tema.
describe('FALLBACK_PRESETS x VISUAL_THEMES', () => {
  for (const [archetype, preset] of Object.entries(FALLBACK_PRESETS)) {
    it(`preset '${archetype}' wears the palette of its own visual_theme`, () => {
      const theme = VISUAL_THEMES[preset.build_metadata.fast_grill_me_choices.visual_theme];
      assert.equal(preset.visuals.primary_color, theme.palette.primary_color);
      assert.equal(preset.visuals.secondary_color, theme.palette.secondary_color);
      assert.equal(preset.visuals.engine_trail_color, theme.palette.engine_trail_color);
    });

    it(`preset '${archetype}' picks a curated accent_color`, () => {
      const accent: AccentColorName = preset.build_metadata.fast_grill_me_choices.accent_color;
      assert.ok(Object.prototype.hasOwnProperty.call(ACCENT_COLORS, accent), `'${accent}'`);
    });
  }
});
