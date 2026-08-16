import { describe, it, expect } from 'vitest';
import { rebalanceEnergySliders } from './EnergySlidersBuilder.js';
import type { EnergySliders } from '@jogo/shared';

function sum(sliders: EnergySliders): number {
  return sliders.offense + sliders.speed + sliders.defense + sliders.tech;
}

function inRange(sliders: EnergySliders): boolean {
  return Object.values(sliders).every((v) => v >= 10 && v <= 50);
}

describe('rebalanceEnergySliders', () => {
  it('mantém a soma em 100 num arraste simples', () => {
    const start: EnergySliders = { offense: 25, speed: 25, defense: 25, tech: 25 };
    const next = rebalanceEnergySliders(start, 'offense', 40);
    expect(sum(next)).toBe(100);
    expect(inRange(next)).toBe(true);
    expect(next.offense).toBe(40);
  });

  /**
   * A captura real (2026-08-16) que expôs o defeito: offense e speed presos no piso, tech no
   * teto, todos ao mesmo tempo -- a versão anterior jogava a sobra inteira numa única chave fixa
   * e saía com soma 107 quando essa chave também estava no limite.
   */
  it('não perde resto quando duas chaves já estão no piso e uma no teto', () => {
    const stuck: EnergySliders = { offense: 10, speed: 10, defense: 30, tech: 50 };
    const next = rebalanceEnergySliders(stuck, 'defense', 37);
    expect(sum(next)).toBe(100);
    expect(inRange(next)).toBe(true);
  });

  it('mantém a soma em 100 numa sequência longa de arrastos para os extremos', () => {
    let sliders: EnergySliders = { offense: 25, speed: 25, defense: 25, tech: 25 };
    const moves: [keyof EnergySliders, number][] = [
      ['offense', 50],
      ['speed', 50],
      ['tech', 50],
      ['defense', 10],
      ['offense', 10],
      ['speed', 10],
      ['tech', 45],
      ['defense', 50]
    ];
    for (const [key, value] of moves) {
      sliders = rebalanceEnergySliders(sliders, key, value);
      expect(sum(sliders), `depois de mover ${key} para ${value}`).toBe(100);
      expect(inRange(sliders), `depois de mover ${key} para ${value}`).toBe(true);
    }
  });

  it('clampa o valor arrastado para [10,50] antes de redistribuir', () => {
    const start: EnergySliders = { offense: 25, speed: 25, defense: 25, tech: 25 };
    const next = rebalanceEnergySliders(start, 'offense', 999);
    expect(next.offense).toBe(50);
    expect(sum(next)).toBe(100);
  });
});
