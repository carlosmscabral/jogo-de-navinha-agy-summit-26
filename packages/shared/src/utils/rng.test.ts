import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SeededRandom } from './rng.js';

describe('SeededRandom', () => {
  it('produz a mesma sequência para o mesmo seed', () => {
    const a = new SeededRandom(1234);
    const b = new SeededRandom(1234);
    const seqA = Array.from({ length: 50 }, () => a.next());
    const seqB = Array.from({ length: 50 }, () => b.next());
    assert.deepEqual(seqA, seqB);
  });

  it('produz sequências diferentes para seeds diferentes', () => {
    const a = Array.from({ length: 20 }, () => new SeededRandom(1).next());
    const b = new SeededRandom(2);
    assert.notDeepEqual(a[0], b.next());
  });

  it('mantém next() no intervalo [0, 1)', () => {
    const r = new SeededRandom(99);
    for (let i = 0; i < 10_000; i++) {
      const v = r.next();
      assert.ok(v >= 0 && v < 1, `valor fora do intervalo: ${v}`);
    }
  });

  it('between devolve inteiros dentro dos limites, inclusive as pontas', () => {
    const r = new SeededRandom(7);
    const seen = new Set<number>();
    for (let i = 0; i < 5_000; i++) {
      const v = r.between(3, 6);
      assert.ok(Number.isInteger(v));
      assert.ok(v >= 3 && v <= 6);
      seen.add(v);
    }
    assert.deepEqual([...seen].sort(), [3, 4, 5, 6]);
  });

  it('chance(p) converge para p', () => {
    const r = new SeededRandom(2026);
    let hits = 0;
    for (let i = 0; i < 20_000; i++) if (r.chance(0.6)) hits++;
    assert.ok(Math.abs(hits / 20_000 - 0.6) < 0.02, `frequência observada: ${hits / 20_000}`);
  });
});
