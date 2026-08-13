import { describe, it, expect } from 'vitest';
import { isSafePathData, pathExtent } from './SvgShipRenderer.js';

describe('isSafePathData', () => {
  it('aceita um path de comandos e números', () => {
    expect(isSafePathData('M50 5 L90 80 L50 65 L10 80 Z')).toBe(true);
  });

  it('aceita curvas e notação científica negativa', () => {
    expect(isSafePathData('M10,10 C20,20 30,-1e2 40,40 z')).toBe(true);
  });

  it('recusa qualquer coisa que não seja comando ou número', () => {
    expect(isSafePathData('M10 10 <script>alert(1)</script>')).toBe(false);
    expect(isSafePathData('url(#gradient)')).toBe(false);
    expect(isSafePathData('M10 10 " onload="x')).toBe(false);
  });

  it('recusa path curto demais para ser uma nave', () => {
    expect(isSafePathData('M0 0')).toBe(false);
  });
});

describe('pathExtent', () => {
  it('extrai os extremos numéricos do path', () => {
    expect(pathExtent('M50 5 L90 80 L10 80 Z')).toEqual({ min: 5, max: 90 });
  });

  it('enxerga coordenadas fora do viewBox contratado', () => {
    expect(pathExtent('M50 5 L900 80 Z').max).toBeGreaterThan(100);
  });
});
