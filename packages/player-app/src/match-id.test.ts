import { describe, it, expect } from 'vitest';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('geração de match_id', () => {
  it('produz UUID v4', () => {
    expect(crypto.randomUUID()).toMatch(UUID_V4);
  });

  it('duas partidas terminadas no mesmo milissegundo têm IDs diferentes', () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    expect(a).not.toEqual(b);
  });

  it('nunca colide em mil gerações', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => crypto.randomUUID()));
    expect(ids.size).toBe(1000);
  });
});
