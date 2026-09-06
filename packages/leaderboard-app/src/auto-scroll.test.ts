import { describe, it, expect } from 'vitest';
import { scrollOffsetAt, scrollCycleMs, type AutoScrollConfig } from './auto-scroll.js';

/** 100 px de transbordo a 100 px/s = 1 s de percurso, com 1 s de pausa em cada ponta. */
const CFG: AutoScrollConfig = { pxPerSecond: 100, holdMs: 1_000 };
const OVERFLOW = 100;

describe('lista que cabe inteira', () => {
  it('nunca desloca quando não há transbordo', () => {
    for (const t of [0, 500, 1_000, 5_000, 60_000]) {
      expect(scrollOffsetAt(t, 0, CFG)).toBe(0);
      expect(scrollOffsetAt(t, -40, CFG)).toBe(0);
    }
    expect(scrollCycleMs(0, CFG)).toBe(0);
  });
});

describe('ciclo vai-e-volta', () => {
  it('o ciclo é pausa + descida + pausa + subida', () => {
    expect(scrollCycleMs(OVERFLOW, CFG)).toBe(4_000);
  });

  it('fica parado no topo durante a pausa inicial', () => {
    expect(scrollOffsetAt(0, OVERFLOW, CFG)).toBe(0);
    expect(scrollOffsetAt(999, OVERFLOW, CFG)).toBe(0);
  });

  it('desce linearmente e chega exatamente no fim da lista', () => {
    expect(scrollOffsetAt(1_500, OVERFLOW, CFG)).toBeCloseTo(50);
    expect(scrollOffsetAt(2_000, OVERFLOW, CFG)).toBeCloseTo(OVERFLOW);
  });

  it('fica parado no fundo durante a pausa final', () => {
    expect(scrollOffsetAt(2_500, OVERFLOW, CFG)).toBeCloseTo(OVERFLOW);
    expect(scrollOffsetAt(2_999, OVERFLOW, CFG)).toBeCloseTo(OVERFLOW);
  });

  it('a subida é o espelho da descida — sem salto de volta ao topo', () => {
    expect(scrollOffsetAt(3_500, OVERFLOW, CFG)).toBeCloseTo(50);
    expect(scrollOffsetAt(3_999, OVERFLOW, CFG)).toBeCloseTo(0.1, 1);
  });

  it('é periódico', () => {
    const cycle = scrollCycleMs(OVERFLOW, CFG);
    for (const t of [0, 700, 1_400, 2_100, 2_800, 3_500]) {
      expect(scrollOffsetAt(t + cycle * 3, OVERFLOW, CFG)).toBeCloseTo(scrollOffsetAt(t, OVERFLOW, CFG));
    }
  });

  it('nunca sai do intervalo [0, transbordo]', () => {
    for (let t = 0; t <= 12_000; t += 37) {
      const offset = scrollOffsetAt(t, OVERFLOW, CFG);
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThanOrEqual(OVERFLOW);
    }
  });

  it('um tempo negativo não empurra a lista para fora da caixa', () => {
    expect(scrollOffsetAt(-500, OVERFLOW, CFG)).toBeGreaterThanOrEqual(0);
    expect(scrollOffsetAt(-500, OVERFLOW, CFG)).toBeLessThanOrEqual(OVERFLOW);
  });
});
