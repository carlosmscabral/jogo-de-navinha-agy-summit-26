import { describe, it, expect, vi, afterEach } from 'vitest';
// WeaponSystem.ts imports the real `phaser` package for its class internals (physics
// groups, Math helpers, etc.), all used only inside class methods this test never calls.
// Vitest runs specs under Node, not a browser, and `phaser`'s device-detection module
// touches `window`/`navigator`/`Image` unconditionally at import time (no jsdom/happy-dom
// is installed in this repo). Stubbing the module import to an inert object lets us
// import the pure `computeEmpDamage` export without paying for -- or crashing on -- the
// rest of the module's browser-only side effects.
// `Math` entrou no stub quando os testes passaram a exercitar `firePrimary` com os três tipos: o
// ramo do `vulcan_spread` chama `Phaser.Math.DegToRad` para abrir o leque. São duas conversões de
// ângulo puras, sem estado nem dependência de browser, então reimplementá-las aqui é mais honesto
// que fingir que o leque não existe.
vi.mock('phaser', () => ({
  default: {
    Math: {
      DegToRad: (deg: number) => (deg * Math.PI) / 180,
      RadToDeg: (rad: number) => (rad * 180) / Math.PI
    }
  }
}));
import { WeaponSystem, computeEmpDamage, pickNearestTarget } from './WeaponSystem.js';
import { audioManager } from '../audio/AudioManager.js';
import { BALANCE, type ShipWeapons, type PrimaryWeaponType } from '@jogo/shared';

const PRIMARY_TYPES: PrimaryWeaponType[] = ['laser', 'plasma', 'vulcan_spread'];

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

/**
 * O playtest de 2026-09-01 reportou: "escolho Laser ou Plasma no pré-voo e vejo animações
 * diferentes, mas durante o jogo as duas armas parecem exatamente iguais -- sempre bolas azuis
 * indo pra cima". A investigação achou a causa: os ramos `laser` e `plasma` de `firePrimary` eram
 * a **mesma linha**, caractere por caractere, ambos gastando `'bullet_plasma'`. Existiam duas
 * texturas de projétil primário para três tipos.
 *
 * A mecânica nunca esteve errada -- a Spec 04 §3.1 (`specs/04_...:100`) manda que laser e plasma
 * disparem um projétil por ciclo com o dano cheio, e a diferença deles vive nos números do MCP.
 * Estes testes prendem a parte que faltava: a diferença tem de **aparecer** e **soar**.
 */
describe('identidade visual e sonora do canhão primário', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * A cena só é tocada em `initBulletPools` e em `spawnBullet`. `textures.exists` sempre `true`
   * pula os blocos de `graphics`, e o `get` do grupo registra a textura pedida antes de devolver
   * `null` -- o que interessa aqui é **qual** projétil foi pedido, não o corpo físico dele.
   */
  function makeSystem(type: PrimaryWeaponType): { ws: WeaponSystem; spawned: string[] } {
    const spawned: string[] = [];
    const scene = {
      physics: {
        add: {
          group: () => ({
            get: (_x: number, _y: number, texture: string) => {
              spawned.push(texture);
              return null;
            }
          })
        }
      },
      textures: { exists: () => true },
      events: { emit: () => undefined }
    } as unknown as ConstructorParameters<typeof WeaponSystem>[0];

    const weapons: ShipWeapons = {
      // `spread_angle` em graus: o ramo do vulcan só converte de radianos quando o valor é menor
      // que 1.0, e 15 é o default da casa (`BALANCE.weapons.primary.default_spread_deg`).
      primary: { type, damage: 25, fire_rate: 5, bullet_speed: 600, spread_angle: 15 },
      secondary: { type: 'homing_missiles', damage: 100, cooldown_seconds: 6 }
    };
    return { ws: new WeaponSystem(scene, weapons), spawned };
  }

  it('dá uma textura distinta a cada um dos três tipos', () => {
    const texturas = PRIMARY_TYPES.map((t) => WeaponSystem.primaryBulletTexture(t));
    expect(new Set(texturas).size, `texturas repetidas: ${texturas.join(', ')}`).toBe(3);
  });

  // A regressão exata: até 2026-08-31 estes dois eram a mesma string.
  it('não deixa o laser e o plasma dividirem a mesma textura', () => {
    expect(WeaponSystem.primaryBulletTexture('laser')).not.toBe(
      WeaponSystem.primaryBulletTexture('plasma')
    );
  });

  /**
   * As chaves estão escritas à mão de propósito. A primeira versão deste teste montava o esperado
   * chamando `WeaponSystem.primaryBulletTexture(type)` -- a própria função sob teste -- e um
   * exercício de mutação provou o estrago: com o bug reintroduzido (os três tipos voltando
   * `'bullet_plasma'`), os dois lados da asserção erravam juntos e o teste passava verde. Um
   * literal não tem como concordar com um bug.
   */
  const TEXTURA_ESPERADA: Record<PrimaryWeaponType, string> = {
    laser: 'bullet_laser',
    plasma: 'bullet_plasma',
    vulcan_spread: 'bullet_vulcan'
  };

  it('dispara de fato a textura do tipo escolhido, e não a do plasma para todos', () => {
    for (const type of PRIMARY_TYPES) {
      const { ws, spawned } = makeSystem(type);
      expect(ws.firePrimary(0, 0, 0), `${type} não disparou`).toBe(true);
      expect(spawned.length, `${type} não gastou projétil`).toBeGreaterThan(0);
      // O vulcan solta três pelotas; todas com a mesma textura.
      expect(new Set(spawned), `${type} usou textura errada`).toEqual(
        new Set([TEXTURA_ESPERADA[type]])
      );
    }
  });

  // O helper e o disparo têm de concordar com o mesmo literal: sem isto, alguém pode renomear a
  // textura no helper e o teste acima só reprovaria se o `firePrimary` já estivesse desalinhado.
  it('expõe pelo helper exatamente a textura que o disparo usa', () => {
    for (const type of PRIMARY_TYPES) {
      expect(WeaponSystem.primaryBulletTexture(type)).toBe(TEXTURA_ESPERADA[type]);
    }
  });

  it('mantém o leque de três pelotas só no vulcan', () => {
    const contagem = PRIMARY_TYPES.map((type) => {
      const { ws, spawned } = makeSystem(type);
      ws.firePrimary(0, 0, 0);
      return [type, spawned.length] as const;
    });
    expect(Object.fromEntries(contagem)).toEqual({ laser: 1, plasma: 1, vulcan_spread: 3 });
  });

  /**
   * `AudioManager.playLaser` tinha os três timbres escritos e **zero call-sites** desde sempre --
   * a diferenciação sonora existia pronta e nunca foi ligada.
   */
  it('toca o timbre do tipo escolhido a cada disparo', () => {
    const spy = vi.spyOn(audioManager, 'playLaser').mockImplementation(() => undefined);
    for (const type of PRIMARY_TYPES) {
      spy.mockClear();
      const { ws } = makeSystem(type);
      ws.firePrimary(0, 0, 0);
      expect(spy, `${type} não soou`).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(WeaponSystem.primaryAudioTimbre(type));
    }
  });

  it('traduz vulcan_spread para o nome de timbre que o AudioManager conhece', () => {
    // O `AudioManager` aceita 'laser' | 'plasma' | 'vulcan' -- não conhece `PrimaryWeaponType`.
    // Literais pelo mesmo motivo de `TEXTURA_ESPERADA`: um mapa derivado do próprio helper
    // concordaria com qualquer tradução, inclusive uma errada.
    expect(WeaponSystem.primaryAudioTimbre('laser')).toBe('laser');
    expect(WeaponSystem.primaryAudioTimbre('plasma')).toBe('plasma');
    expect(WeaponSystem.primaryAudioTimbre('vulcan_spread')).toBe('vulcan');
    const timbres = PRIMARY_TYPES.map((t) => WeaponSystem.primaryAudioTimbre(t));
    expect(new Set(timbres).size, `timbres repetidos: ${timbres.join(', ')}`).toBe(3);
  });

  /**
   * O som sai depois do portão de cadência, não antes. Com o gatilho apertado, `firePrimary` roda
   * a cada quadro e recusa quase todos; soar na entrada faria o motor gritar a 60 Hz em vez de
   * uma vez por tiro.
   */
  it('não toca nada num disparo recusado pela cadência', () => {
    const spy = vi.spyOn(audioManager, 'playLaser').mockImplementation(() => undefined);
    const { ws } = makeSystem('plasma');
    const intervalMs = 1000 / 5;

    expect(ws.firePrimary(0, 0, 0)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);

    expect(ws.firePrimary(0, 0, intervalMs - 1)).toBe(false);
    expect(spy, 'soou num quadro em que a arma estava recarregando').toHaveBeenCalledTimes(1);

    expect(ws.firePrimary(0, 0, intervalMs)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
