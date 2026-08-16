import { describe, it, expect, vi } from 'vitest';
// WeaponSystem.ts imports the real `phaser` package for its class internals (physics
// groups, Math helpers, etc.), all used only inside class methods this test never calls.
// Vitest runs specs under Node, not a browser, and `phaser`'s device-detection module
// touches `window`/`navigator`/`Image` unconditionally at import time (no jsdom/happy-dom
// is installed in this repo). Stubbing the module import to an inert object lets us
// import the pure `computeEmpDamage` export without paying for -- or crashing on -- the
// rest of the module's browser-only side effects.
vi.mock('phaser', () => ({ default: {} }));
import { WeaponSystem, computeEmpDamage, pickNearestTarget } from './WeaponSystem.js';
import { BALANCE, type ShipWeapons } from '@jogo/shared';

function fakeTarget(x: number, y: number, active = true): Phaser.GameObjects.Sprite {
  return { x, y, active } as unknown as Phaser.GameObjects.Sprite;
}

/**
 * `homing_missiles` não perseguia nada até esta versão: `WeaponSystem.spawnMissile` recebia
 * `targets` e nunca lia o parâmetro. `pickNearestTarget` é a seleção de alvo que faltava --
 * pura de propósito, para não precisar de um corpo físico do Phaser só para testar "qual é o
 * mais perto".
 */
describe('pickNearestTarget', () => {
  it('escolhe o alvo ativo mais perto do ponto de lançamento', () => {
    const perto = fakeTarget(10, 0);
    const longe = fakeTarget(100, 0);
    expect(pickNearestTarget(0, 0, [longe, perto])).toBe(perto);
  });

  it('ignora alvos inativos, mesmo que estejam mais perto', () => {
    const morto = fakeTarget(5, 0, false);
    const vivo = fakeTarget(50, 0);
    expect(pickNearestTarget(0, 0, [morto, vivo])).toBe(vivo);
  });

  it('devolve undefined sem candidatos ou com a lista inteira inativa', () => {
    expect(pickNearestTarget(0, 0, undefined)).toBeUndefined();
    expect(pickNearestTarget(0, 0, [])).toBeUndefined();
    expect(pickNearestTarget(0, 0, [fakeTarget(1, 1, false)])).toBeUndefined();
  });
});

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

  /**
   * `'none'` é um tipo válido de secundária (`SecondaryWeaponType`) e o MCP `weapons-arsenal`
   * consegue emiti-lo, então `agy` monta naves sem secundária. Antes deste ramo, a cadência era
   * calculada mesmo assim: a âncora não-finita entregava `elapsed === Infinity`, o HUD anunciava
   * `PRONTO!` do primeiro ao último quadro e o `SHIFT` era recusado na primeira linha de
   * `fireSecondary`. Barra cheia a partida inteira ao lado de uma tecla inerte.
   */
  it('não anuncia recarga para uma nave sem secundária', () => {
    const scene = {
      physics: { add: { group: () => ({ get: () => null }) } },
      textures: { exists: () => true }
    } as unknown as ConstructorParameters<typeof WeaponSystem>[0];
    const weapons: ShipWeapons = {
      primary: { type: 'plasma', damage: 25, fire_rate: FIRE_RATE, bullet_speed: 600, spread_angle: 0 },
      secondary: { type: 'none', damage: 0, cooldown_seconds: COOLDOWN_S }
    };
    const ws = new WeaponSystem(scene, weapons);

    for (const t of [0, 1000, COOLDOWN_S * 1000, COOLDOWN_S * 2000]) {
      const status = ws.getSecondaryStatus(t);
      expect(status.type, `t=${t}ms`).toBe('none');
      // A regra é a mesma dos outros testes: a HUD e o gatilho nunca discordam.
      expect(status.isReady, `t=${t}ms`).toBe(ws.fireSecondary(0, 0, t));
      expect(status.progress, `t=${t}ms`).toBe(0);
    }
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
