import { describe, it, expect } from 'vitest';
import { renderShipCardSvg } from '@jogo/shared';
import { shipCardDataUri, shipCardLabel } from './ship-card-preview.js';

const SPEC = {
  attributes: { shield_capacity: 2 },
  visuals: {
    style_name: 'Interceptador "Aço & Cinza"',
    primary_color: '#1a2b3c',
    secondary_color: '#ff00aa',
    engine_trail_color: '#00ffcc',
    svg_path_data: 'M 64 8 C 80 40, 96 72, 88 118 L 40 118 C 32 72, 48 40, 64 8 Z'
  }
} as any;

describe('shipCardDataUri', () => {
  it('embute o SVG numa data: URI decodificável de volta ao original', () => {
    const svg = renderShipCardSvg(SPEC);
    const uri = shipCardDataUri({ ship_card_svg: svg })!;

    expect(uri.startsWith('data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(uri.slice('data:image/svg+xml,'.length))).toBe(svg);
  });

  it('escapa o # das cores, que sem encoding cortaria a URI no primeiro fragmento', () => {
    // Sem encodeURIComponent, tudo a partir do primeiro `#` viraria fragmento de URL e a imagem
    // sairia truncada logo na cor do casco — o modo de falha exato que este teste tranca.
    const uri = shipCardDataUri({ ship_card_svg: renderShipCardSvg(SPEC) })!;
    expect(uri).not.toContain('#');
  });

  it('devolve null quando não há cartão — o caso normal, não um erro', () => {
    expect(shipCardDataUri({})).toBeNull();
    expect(shipCardDataUri({ ship_card_svg: undefined })).toBeNull();
    expect(shipCardDataUri({ ship_card_svg: '' })).toBeNull();
  });

  it('devolve null para conteúdo que não é um SVG, em vez de uma imagem quebrada', () => {
    expect(shipCardDataUri({ ship_card_svg: '<script>alert(1)</script>' })).toBeNull();
    expect(shipCardDataUri({ ship_card_svg: 'não sou svg' })).toBeNull();
    expect(shipCardDataUri({ ship_card_svg: 42 as any })).toBeNull();
  });
});

describe('shipCardLabel', () => {
  it('usa o nome que o agente deu à nave', () => {
    expect(shipCardLabel({ callsign: 'NOVA', ship_spec_snapshot: SPEC })).toBe(
      'Nave de NOVA: Interceptador "Aço & Cinza"'
    );
  });

  it('cai no callsign quando o spec não tem nome de estilo utilizável', () => {
    expect(shipCardLabel({ callsign: 'NOVA', ship_spec_snapshot: undefined as any })).toBe('Nave de NOVA');
    expect(shipCardLabel({ callsign: 'NOVA', ship_spec_snapshot: { visuals: { style_name: '  ' } } as any })).toBe(
      'Nave de NOVA'
    );
  });
});
