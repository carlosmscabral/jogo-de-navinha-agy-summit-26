import { describe, it, expect, vi } from 'vitest';
// WeaponSystem.ts imports the real `phaser` package for its class internals (physics
// groups, Math helpers, etc.), all used only inside class methods this test never calls.
// Vitest runs specs under Node, not a browser, and `phaser`'s device-detection module
// touches `window`/`navigator`/`Image` unconditionally at import time (no jsdom/happy-dom
// is installed in this repo). Stubbing the module import to an inert object lets us
// import the pure `computeEmpDamage` export without paying for -- or crashing on -- the
// rest of the module's browser-only side effects.
vi.mock('phaser', () => ({ default: {} }));
import { computeEmpDamage } from './WeaponSystem.js';
import { BALANCE } from '@jogo/shared';

describe('computeEmpDamage', () => {
  it('aplica o dano cheio no epicentro', () => {
    expect(computeEmpDamage(100, 0)).toBe(100);
  });

  it('aplica o dano reduzido na borda do raio', () => {
    const edge = BALANCE.weapons.secondary.emp_radius_px;
    expect(computeEmpDamage(100, edge)).toBe(100 * BALANCE.weapons.secondary.emp_edge_falloff);
  });

  it('não causa dano fora do raio', () => {
    expect(computeEmpDamage(100, BALANCE.weapons.secondary.emp_radius_px + 1)).toBe(0);
  });
});
