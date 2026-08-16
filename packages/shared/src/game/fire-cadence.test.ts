import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CADENCE_RECOVERY_INTERVALS, resolveFireCadence } from './fire-cadence.js';

/**
 * Conta quantos disparos uma arma consegue em `seconds` segundos, rodando o laço de quadros a
 * `fps` quadros por segundo. É o laço real do motor reduzido ao que importa aqui: a cada quadro,
 * pergunta se pode disparar e, se puder, move a âncora.
 */
function countShots(fps: number, intervalMs: number, seconds: number): number {
  const frameMs = 1000 / fps;
  let anchor = -Infinity;
  let shots = 0;
  for (let now = 0; now < seconds * 1000; now += frameMs) {
    const next = resolveFireCadence(anchor, now, intervalMs);
    if (next !== null) {
      anchor = next;
      shots++;
    }
  }
  return shots;
}

describe('resolveFireCadence', () => {
  it('segura o disparo enquanto o intervalo não fechou', () => {
    assert.equal(resolveFireCadence(100, 179, 80), null);
    assert.equal(resolveFireCadence(100, 180, 80), 180);
    assert.equal(resolveFireCadence(100, 185, 80), 180);
  });

  it('dispara já no primeiro quadro a partir de uma âncora infinita', () => {
    assert.equal(resolveFireCadence(-Infinity, 0, 83.33), 0);
    assert.equal(resolveFireCadence(-Infinity, 40_000, 83.33), 40_000);
  });

  it('avança em múltiplos exatos do intervalo, não para o instante do quadro', () => {
    // Um quadro de 17.86ms (56 fps) atrasa o disparo em 5.95ms além do intervalo de 83.33ms.
    // A sobra tem que ficar na âncora, senão ela reaparece no intervalo seguinte, e no próximo.
    const anchor = resolveFireCadence(0, 89.28, 83.33);
    assert.equal(anchor, 83.33);
  });

  it('mantém a cadência nominal abaixo de 60 fps -- o defeito que motivou o módulo', () => {
    // 12 disparos/s durante 10s: 120 disparos, quer a máquina segure 60 fps ou não.
    // Carimbar o instante do quadro dava 112 a 56 fps (5 quadros de 17.86ms por disparo).
    for (const fps of [60, 58, 56, 50, 45, 30]) {
      const shots = countShots(fps, 1000 / 12, 10);
      assert.ok(
        Math.abs(shots - 120) <= 1,
        `a ${fps} fps saíram ${shots} disparos, esperado 120 (±1 de borda do laço)`
      );
    }
  });

  it('mantém a cadência nominal para intervalos que não fecham em número inteiro de quadros', () => {
    // 8 disparos/s são 125ms, ou 7.5 quadros a 60 fps -- o caso em que nem o simulador,
    // que roda a 60 fps fixos, escapava do arredondamento.
    for (const fps of [60, 56, 30]) {
      const shots = countShots(fps, 1000 / 8, 10);
      assert.ok(Math.abs(shots - 80) <= 1, `a ${fps} fps saíram ${shots} disparos, esperado 80`);
    }
  });

  it('nunca dispara mais de uma vez por quadro', () => {
    // A âncora anda um intervalo por chamada, então mesmo muito atrasada ela não devolve
    // dois disparos no mesmo instante.
    let anchor = 0;
    const next = resolveFireCadence(anchor, 200, 83.33);
    assert.notEqual(next, null);
    anchor = next!;
    assert.equal(resolveFireCadence(anchor, 200, 83.33), null);
  });

  it('reancora no presente depois de uma pausa longa, em vez de soltar uma rajada', () => {
    const intervalMs = 83.33;
    const pausedFor = intervalMs * (CADENCE_RECOVERY_INTERVALS + 1);
    assert.equal(resolveFireCadence(0, pausedFor, intervalMs), pausedFor);
  });

  it('recupera um atraso dentro do teto sem reancorar', () => {
    const intervalMs = 83.33;
    const late = intervalMs * CADENCE_RECOVERY_INTERVALS;
    assert.equal(resolveFireCadence(0, late, intervalMs), intervalMs);
  });

  it('não acumula rajada depois de uma pausa longa', () => {
    // Uma aba em segundo plano por 5s não pode virar 60 disparos instantâneos quando ela volta.
    const intervalMs = 1000 / 12;
    const frameMs = 1000 / 60;
    let anchor = resolveFireCadence(-Infinity, 0, intervalMs)!;
    let shots = 0;
    for (let now = 5000; now < 5000 + frameMs * 5; now += frameMs) {
      const next = resolveFireCadence(anchor, now, intervalMs);
      if (next !== null) {
        anchor = next;
        shots++;
      }
    }
    assert.equal(shots, 1, 'só o primeiro quadro depois da pausa deve disparar');
  });
});
