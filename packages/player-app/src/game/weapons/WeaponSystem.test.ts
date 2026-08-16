import { describe, it, expect, vi } from 'vitest';
// WeaponSystem.ts imports the real `phaser` package for its class internals (physics
// groups, Math helpers, etc.), all used only inside class methods this test never calls.
// Vitest runs specs under Node, not a browser, and `phaser`'s device-detection module
// touches `window`/`navigator`/`Image` unconditionally at import time (no jsdom/happy-dom
// is installed in this repo). Stubbing the module import to an inert object lets us
// import the pure `computeEmpDamage` export without paying for -- or crashing on -- the
// rest of the module's browser-only side effects.
vi.mock('phaser', () => ({ default: {} }));
import { WeaponSystem, computeEmpDamage } from './WeaponSystem.js';
import { BALANCE, type ShipWeapons } from '@jogo/shared';

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

/**
 * O relógio que a cena entrega aqui é o `worldTimeMs` da Spec 09 §5.10, e ele começa em
 * **zero**. Uma âncora inicial de `0` é, portanto, um instante alcançável: "nunca disparou"
 * e "disparou exatamente agora" viram o mesmo estado, e a arma fica muda pela recarga
 * inteira no começo da partida.
 *
 * O idioma da casa para "pode disparar já no primeiro quadro" é uma âncora **não-finita** --
 * está escrito na doc de `resolveFireCadence` (@jogo/shared) e é o que `combat-model.ts` já
 * faz nas duas âncoras. Estes testes prendem a engine nesse mesmo idioma.
 */
describe('cadência a partir do primeiro quadro', () => {
  const COOLDOWN_S = 6; // igual ao `homing_missiles` do preset interceptor.
  const FIRE_RATE = 5; // 200ms entre tiros.

  function makeSystem(): WeaponSystem {
    // A cena só é tocada em `initBulletPools`. `textures.exists` retornando `true` pula os
    // três blocos de `graphics`, e um grupo cujo `get` devolve `null` faz `spawnBullet`/
    // `spawnMissile` virarem no-ops -- este teste mede o portão de cadência, não o pool.
    const scene = {
      physics: { add: { group: () => ({ get: () => null }) } },
      textures: { exists: () => true }
    } as unknown as ConstructorParameters<typeof WeaponSystem>[0];

    const weapons: ShipWeapons = {
      primary: { type: 'plasma', damage: 25, fire_rate: FIRE_RATE, bullet_speed: 600, spread_angle: 0 },
      secondary: { type: 'homing_missiles', damage: 100, cooldown_seconds: COOLDOWN_S }
    };
    return new WeaponSystem(scene, weapons);
  }

  it('dispara a secundária no quadro zero, o mesmo quadro em que a HUD já mostra PRONTO!', () => {
    const ws = makeSystem();
    expect(ws.getSecondaryStatus(0).isReady).toBe(true);
    expect(ws.fireSecondary(0, 0, 0)).toBe(true);
  });

  it('mantém HUD e gatilho da secundária de acordo durante toda a primeira recarga', () => {
    const cooldownMs = COOLDOWN_S * 1000;
    for (const t of [0, 1, 16, 100, cooldownMs - 1, cooldownMs, cooldownMs + 1]) {
      const ws = makeSystem();
      // A leitura vem antes do disparo: `fireSecondary` carimba a âncora.
      const hudDizPronto = ws.getSecondaryStatus(t).isReady;
      expect(ws.fireSecondary(0, 0, t), `t=${t}ms: HUD diz ${hudDizPronto}`).toBe(hudDizPronto);
    }
  });

  it('mantém a recarga da secundária depois do primeiro uso', () => {
    const ws = makeSystem();
    const cooldownMs = COOLDOWN_S * 1000;
    expect(ws.fireSecondary(0, 0, 1000)).toBe(true);
    expect(ws.fireSecondary(0, 0, 1000 + cooldownMs - 1)).toBe(false);
    expect(ws.fireSecondary(0, 0, 1000 + cooldownMs)).toBe(true);
  });

  it('dispara a primária no quadro zero', () => {
    const ws = makeSystem();
    expect(ws.firePrimary(0, 0, 0)).toBe(true);
  });

  it('mantém a cadência da primária depois do primeiro tiro', () => {
    const ws = makeSystem();
    const intervalMs = 1000 / FIRE_RATE;
    expect(ws.firePrimary(0, 0, 0)).toBe(true);
    expect(ws.firePrimary(0, 0, intervalMs - 1)).toBe(false);
    expect(ws.firePrimary(0, 0, intervalMs)).toBe(true);
  });
});
