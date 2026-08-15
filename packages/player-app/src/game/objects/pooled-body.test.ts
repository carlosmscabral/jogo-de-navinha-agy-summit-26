import { describe, it, expect } from 'vitest';
import type Phaser from 'phaser';
import { despawnPooled, respawnPooled } from './pooled-body.js';

/**
 * `pooled-body.ts` importa `phaser` só como tipo (`import type`), então nada de Phaser existe
 * em runtime aqui e não é preciso o `vi.mock('phaser')` que os outros specs deste pacote usam.
 * O dublê abaixo replica exatamente os campos que o Arcade Physics consulta para decidir se um
 * corpo é simulado e testado por colisão -- `enable` e `checkCollision.none` -- mais a ordem de
 * chamada de `reset`/`stop`, que é o que o bug de multi-acerto dependia.
 */
function makeSprite() {
  const calls: string[] = [];
  const body = {
    enable: true,
    checkCollision: { none: false },
    x: 0,
    y: 0,
    velocity: { x: 0, y: 0 },
    stop() {
      calls.push('stop');
      this.velocity = { x: 0, y: 0 };
    },
    reset(x: number, y: number) {
      calls.push('reset');
      this.stop();
      this.x = x;
      this.y = y;
    }
  };
  const sprite = {
    active: true,
    visible: true,
    body,
    calls,
    setActive(v: boolean) {
      this.active = v;
      return this;
    },
    setVisible(v: boolean) {
      this.visible = v;
      return this;
    },
    setPosition(x: number, y: number) {
      body.x = x;
      body.y = y;
      return this;
    },
    setVelocity(x: number, y: number) {
      calls.push('setVelocity');
      body.velocity = { x, y };
      return this;
    }
  };
  return sprite;
}

type Stub = ReturnType<typeof makeSprite>;
const asSprite = (s: Stub) => s as unknown as Phaser.Physics.Arcade.Sprite;

describe('despawnPooled', () => {
  it('desabilita o corpo, não só o game object', () => {
    const s = makeSprite();
    despawnPooled(asSprite(s));
    expect(s.active).toBe(false);
    expect(s.visible).toBe(false);
    // O ponto do bug: o Arcade Physics filtra colisão por `body.enable`, nunca por `active`.
    // Um projétil consumido só com setActive(false) continuava colidindo a cada frame.
    expect(s.body.enable).toBe(false);
  });

  it('zera a velocidade para o objeto não voltar do pool com o vetor antigo', () => {
    const s = makeSprite();
    s.setVelocity(0, -750);
    despawnPooled(asSprite(s));
    expect(s.body.velocity).toEqual({ x: 0, y: 0 });
  });

  it('não quebra quando o corpo já foi destruído', () => {
    const s = makeSprite();
    (s as { body: unknown }).body = null;
    expect(() => despawnPooled(asSprite(s))).not.toThrow();
    expect(s.active).toBe(false);
  });
});

describe('respawnPooled', () => {
  it('reabilita o corpo de um objeto que veio do pool desligado', () => {
    const s = makeSprite();
    despawnPooled(asSprite(s));
    respawnPooled(asSprite(s), 100, 200, 0, -650);
    expect(s.active).toBe(true);
    expect(s.visible).toBe(true);
    expect(s.body.enable).toBe(true);
    expect(s.body.checkCollision.none).toBe(false);
  });

  it('reposiciona e só então aplica a velocidade', () => {
    const s = makeSprite();
    respawnPooled(asSprite(s), 100, 200, 0, -650);
    expect(s.body.x).toBe(100);
    expect(s.body.y).toBe(200);
    // `Body.reset` chama `stop()` internamente: invertida, a ordem zeraria o disparo e o
    // projétil nasceria parado dentro da nave.
    expect(s.calls.indexOf('reset')).toBeLessThan(s.calls.indexOf('setVelocity'));
    expect(s.body.velocity).toEqual({ x: 0, y: -650 });
  });

  it('sobrevive a um objeto sem corpo, ainda posicionando o sprite', () => {
    const s = makeSprite();
    const body = s.body;
    (s as { body: unknown }).body = null;
    respawnPooled(asSprite(s), 42, 84, 0, -1);
    expect(s.active).toBe(true);
    expect(body.x).toBe(42);
    expect(body.y).toBe(84);
  });
});
