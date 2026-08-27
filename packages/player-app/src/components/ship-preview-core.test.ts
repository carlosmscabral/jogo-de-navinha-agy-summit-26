import { describe, it, expect } from 'vitest';
import { BALANCE, ShipVisuals, ShipWeapons } from '@jogo/shared';
import {
  acquirePreviewSlot,
  previewFireIntervalMs,
  previewShotAngles,
  previewSlotTaken,
  releasePreviewSlot,
  usesForgedHull
} from './ship-preview-core.js';

/**
 * O componente `ShipPreviewCanvas` em si não é montado aqui: o vitest deste workspace roda em
 * `environment: 'node'`, sem jsdom e sem @testing-library. O que este arquivo cobre é toda a
 * decisão que o componente toma antes de tocar no DOM.
 */

const owner = () => Symbol('preview');

function visualsWith(d: string): ShipVisuals {
  return {
    style_name: 'interceptor',
    primary_color: '#38bdf8',
    secondary_color: '#0ea5e9',
    engine_trail_color: '#ff9e0b',
    svg_path_data: d
  };
}

function weaponsWith(primary: Partial<ShipWeapons['primary']>): ShipWeapons {
  return {
    primary: { type: 'laser', damage: 20, fire_rate: 8, bullet_speed: 650, spread_angle: 0, ...primary },
    secondary: { type: 'homing_missiles', damage: 30, cooldown_seconds: 4 }
  } as ShipWeapons;
}

/** Um casco válido: só comandos do contrato, todos os números dentro do viewBox 0..128. */
const GOOD_PATH = 'M 64 8 L 96 112 L 64 92 L 32 112 Z';

// O slot é estado de módulo: cada teste devolve o que pegou num `finally`, para que uma falha no
// meio de um caso não contamine os seguintes.
describe('teto de instâncias de preview', () => {
  it('concede o slot ao primeiro pretendente e recusa ao segundo', () => {
    const a = owner();
    const b = owner();
    try {
      expect(acquirePreviewSlot(a)).toBe(true);
      expect(acquirePreviewSlot(b)).toBe(false);
    } finally {
      releasePreviewSlot(a);
    }
  });

  it('é reentrante para o mesmo dono (o StrictMode do React monta duas vezes)', () => {
    const a = owner();
    try {
      expect(acquirePreviewSlot(a)).toBe(true);
      expect(acquirePreviewSlot(a)).toBe(true);
    } finally {
      releasePreviewSlot(a);
    }
  });

  it('libera o slot para o próximo depois do desmonte', () => {
    const a = owner();
    const b = owner();
    acquirePreviewSlot(a);
    releasePreviewSlot(a);
    expect(previewSlotTaken()).toBe(false);
    try {
      expect(acquirePreviewSlot(b)).toBe(true);
    } finally {
      releasePreviewSlot(b);
    }
  });

  it('o release de quem não tem o slot não rouba o preview de quem tem', () => {
    // A transição entre duas telas desmonta uma e monta a outra; se o desmonte atrasado da tela
    // antiga liberasse o slot da nova, a nova ficaria viva sem dono e a próxima tela cairia no SVG.
    const antiga = owner();
    const nova = owner();
    acquirePreviewSlot(antiga);
    releasePreviewSlot(antiga);
    acquirePreviewSlot(nova);
    releasePreviewSlot(antiga);
    try {
      expect(previewSlotTaken()).toBe(true);
      expect(acquirePreviewSlot(owner())).toBe(false);
    } finally {
      releasePreviewSlot(nova);
    }
  });
});

describe('usesForgedHull', () => {
  it('só desenha o casco da IA no modo forged', () => {
    const v = visualsWith(GOOD_PATH);
    expect(usesForgedHull('forged', v)).toBe(true);
    expect(usesForgedHull('demo', v)).toBe(false);
    expect(usesForgedHull('build', v)).toBe(false);
  });

  it('recusa path ausente, curto, com caractere fora do contrato ou fora do viewBox', () => {
    expect(usesForgedHull('forged', undefined)).toBe(false);
    expect(usesForgedHull('forged', visualsWith(''))).toBe(false);
    expect(usesForgedHull('forged', visualsWith('M 1 1'))).toBe(false);
    expect(usesForgedHull('forged', visualsWith('M 64 8 L 96 112 <script> Z'))).toBe(false);
    expect(usesForgedHull('forged', visualsWith('M 64 8 L 9000 112 L 32 112 Z'))).toBe(false);
  });
});

describe('previewFireIntervalMs', () => {
  it('usa a mesma conta do WeaponSystem (1000 / fire_rate)', () => {
    expect(previewFireIntervalMs(8)).toBe(125);
    expect(previewFireIntervalMs(10)).toBe(100);
  });

  it('nunca devolve intervalo não-finito nem zero para entrada degenerada', () => {
    for (const bad of [undefined, 0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const ms = previewFireIntervalMs(bad as number | undefined);
      expect(Number.isFinite(ms)).toBe(true);
      expect(ms).toBeGreaterThan(0);
    }
  });

  it('mantém o intervalo dentro do que as faixas do schema permitem', () => {
    const { min, max } = BALANCE.ranges['weapons.primary.fire_rate'];
    for (const rate of [min, max, 1, 999]) {
      const ms = previewFireIntervalMs(rate);
      expect(ms).toBeGreaterThanOrEqual(1000 / max);
      expect(ms).toBeLessThanOrEqual(1000 / min);
    }
  });
});

describe('previewShotAngles', () => {
  it('laser e plasma saem em um tiro reto', () => {
    expect(previewShotAngles(weaponsWith({ type: 'laser' }))).toEqual([0]);
    expect(previewShotAngles(weaponsWith({ type: 'plasma' }))).toEqual([0]);
  });

  it('vulcan_spread sai em leque de três, simétrico', () => {
    const angles = previewShotAngles(weaponsWith({ type: 'vulcan_spread', spread_angle: 20 }));
    expect(angles).toEqual([-20, 0, 20]);
  });

  it('converte spread em radianos, como o WeaponSystem faz', () => {
    // O contrato pede graus, mas specs reais já chegaram em radianos; o preview tem que mostrar o
    // mesmo leque que a partida, senão o visitante vê um leque e pilota outro.
    const [left, , right] = previewShotAngles(
      weaponsWith({ type: 'vulcan_spread', spread_angle: 0.3 })
    );
    expect(right).toBeCloseTo((0.3 * 180) / Math.PI, 6);
    expect(left).toBeCloseTo(-right, 6);
  });

  it('cai no leque padrão do balance quando o spread vem zerado', () => {
    const angles = previewShotAngles(weaponsWith({ type: 'vulcan_spread', spread_angle: 0 }));
    expect(angles).toEqual([
      -BALANCE.weapons.primary.default_spread_deg,
      0,
      BALANCE.weapons.primary.default_spread_deg
    ]);
  });

  it('não quebra sem armas declaradas', () => {
    expect(previewShotAngles(undefined)).toEqual([0]);
  });
});
