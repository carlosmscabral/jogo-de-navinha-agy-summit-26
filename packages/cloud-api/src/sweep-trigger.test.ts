/**
 * Gatilho da varredura de canonicalização (`sweep-trigger.ts`).
 *
 * Teste puro: `run` e `withLease` são injetados, então nada aqui toca Firestore ou Vertex. Era
 * exatamente por não ser injetável — um closure dentro de `createApp` — que a versão anterior
 * deste gatilho só era alcançável subindo um servidor HTTP, e portanto nunca foi testada.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSweepTrigger } from './sweep-trigger.js';

/** Uma varredura que só resolve quando o teste mandar — é como se observa "em voo". */
function varreduraControlada() {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  let chamadas = 0;
  const run = () => {
    chamadas += 1;
    return new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
  };
  return { run, resolve: () => resolve(), reject: (e: unknown) => reject(e), chamadas: () => chamadas };
}

describe('createSweepTrigger', () => {
  it('a primeira chamada dispara a varredura', async () => {
    const v = varreduraControlada();
    const trigger = createSweepTrigger({ run: v.run });

    trigger.trigger();
    assert.equal(v.chamadas(), 1);

    v.resolve();
    await trigger.inFlight();
  });

  it('descarta disparos enquanto uma varredura está em voo', async () => {
    // O caso real: duas ingestões consecutivas na MESMA instância (--min-instances 1, tráfego
    // esparso), os dois estandes terminando partidas com segundos de diferença.
    const v = varreduraControlada();
    const trigger = createSweepTrigger({ run: v.run });

    trigger.trigger();
    trigger.trigger();
    trigger.trigger();

    assert.equal(v.chamadas(), 1, 'chamou o Vertex mais de uma vez para o mesmo trabalho');

    v.resolve();
    await trigger.inFlight();
  });

  it('um disparo depois do fim da varredura anterior roda de novo', async () => {
    // A guarda descarta, não desliga: a próxima partida marcada precisa de uma varredura nova.
    const v1 = varreduraControlada();
    const trigger = createSweepTrigger({ run: v1.run });

    trigger.trigger();
    v1.resolve();
    await trigger.inFlight();

    assert.equal(trigger.inFlight(), null, 'o gatilho ficou preso em "em voo"');
    trigger.trigger();
    assert.equal(v1.chamadas(), 2);
    v1.resolve();
    await trigger.inFlight();
  });

  it('uma varredura que falha não derruba o processo e libera o gatilho', async () => {
    // Sem o `.catch`, esta promessa desanexada vira `unhandledRejection` — o serviço inteiro cai
    // por causa de uma partida.
    const v = varreduraControlada();
    const erros: unknown[] = [];
    const trigger = createSweepTrigger({ run: v.run, onError: (e) => erros.push(e) });

    trigger.trigger();
    v.reject(new Error('vertex caiu'));
    await trigger.inFlight();

    assert.equal(erros.length, 1);
    assert.match((erros[0] as Error).message, /vertex caiu/);
    assert.equal(trigger.inFlight(), null);

    trigger.trigger();
    assert.equal(v.chamadas(), 2, 'uma falha deixou o gatilho travado para o resto do evento');
    v.resolve();
    await trigger.inFlight();
  });

  it('um `run` que lança de forma SÍNCRONA vira erro tratado, não exceção no chamador', async () => {
    // `trigger()` é chamado de dentro de `ingestBatch`, no caminho de resposta do visitante.
    const erros: unknown[] = [];
    const trigger = createSweepTrigger({
      run: () => {
        throw new Error('catálogo explodiu');
      },
      onError: (e) => erros.push(e)
    });

    assert.doesNotThrow(() => trigger.trigger());
    await trigger.inFlight();
    assert.equal(erros.length, 1);
  });

  it('com lease, a varredura roda por dentro dele', async () => {
    const chamadasDoLease: number[] = [];
    let rodou = 0;
    const trigger = createSweepTrigger({
      run: async () => {
        rodou += 1;
      },
      withLease: async (fn) => {
        chamadasDoLease.push(1);
        return fn();
      }
    });

    trigger.trigger();
    await trigger.inFlight();

    assert.equal(chamadasDoLease.length, 1);
    assert.equal(rodou, 1);
  });

  it('lease negado por outra instância: nada roda, e nada falha', async () => {
    let rodou = 0;
    const erros: unknown[] = [];
    const trigger = createSweepTrigger({
      run: async () => {
        rodou += 1;
      },
      // `null` é o contrato de `withLease` para "outra instância está varrendo".
      withLease: async () => null,
      onError: (e) => erros.push(e)
    });

    trigger.trigger();
    await trigger.inFlight();

    assert.equal(rodou, 0);
    assert.deepEqual(erros, [], 'perder o lease foi tratado como erro');
    assert.equal(trigger.inFlight(), null);
  });
});
