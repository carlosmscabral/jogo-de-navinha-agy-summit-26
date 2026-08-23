import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CloudSyncService, type PendingMatch, type SyncBuffer } from './cloud-sync.js';

/**
 * Duplo de teste para `SyncBuffer` — espelha o comportamento real de
 * `SQLiteBufferService`: `getPendingMatches()` só devolve o que ainda não foi
 * marcado sincronizado, e `markMatchSynced` é o único jeito de tirar algo da
 * lista. Ao contrário do buffer real (que já limita a query a 50 linhas),
 * este duplo devolve TODOS os pendentes de uma vez — é assim que o teste de
 * lote (abaixo) consegue exercitar o corte de 50 do próprio CloudSyncService,
 * em vez do limite da query SQL.
 */
function fakeBufferWith(ids: string[]): SyncBuffer & { pending: string[]; markedSynced: string[] } {
  const pending = [...ids];
  const markedSynced: string[] = [];

  return {
    pending,
    markedSynced,
    getPendingMatches(): PendingMatch[] {
      return pending
        .filter((id) => !markedSynced.includes(id))
        .map((id) => ({ match_id: id }));
    },
    markMatchSynced(matchId: string): void {
      markedSynced.push(matchId);
    },
    countPending(): number {
      return pending.filter((id) => !markedSynced.includes(id)).length;
    }
  };
}

/** Resposta 200 com corpo JSON — o formato que `POST /v1/matches` devolve em sucesso. */
function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

describe('CloudSyncService', () => {
  it('envia os pendentes e marca como sincronizados apenas os aceitos', async () => {
    const buffer = fakeBufferWith(['m1', 'm2', 'm3']);
    const fetchDuplo = async () => okJson({ accepted: ['m1', 'm3'], rejected: [{ match_id: 'm2', reason: 'telemetry ausente' }] });
    const sync = new CloudSyncService(buffer, { base: 'https://api', token: 't', fetchImpl: fetchDuplo });

    await sync.syncNow();

    assert.deepEqual(buffer.markedSynced, ['m1', 'm3']);
    assert.ok(!buffer.markedSynced.includes('m2'), 'uma rejeição não pode ser marcada como sincronizada');
  });

  it('não marca nada quando a rede falha', async () => {
    const buffer = fakeBufferWith(['m1']);
    const sync = new CloudSyncService(buffer, { base: 'https://api', token: 't', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
    const outcome = await sync.syncNow();
    assert.equal(outcome.status, 'failed');
    assert.deepEqual(buffer.markedSynced, []);
  });

  it('cresce o backoff a cada falha consecutiva e para no teto', () => {
    // Jitter fixo (em vez do default Math.random) é necessário aqui: com jitter
    // aleatório, o valor de n=8 (256000ms, ainda sem teto) e o de n=9 (300000ms,
    // já com teto) ficam a ±20% um do outro, e uma comparação de monotonicidade
    // entre um sorteio alto de n=8 e um sorteio baixo de n=9 pode inverter a
    // ordem por puro acaso (~90% de chance de falhar em 20 mil simulações). O
    // próprio texto da tarefa diz que `jitter()` é injetável exatamente "para o
    // teste ser determinístico" — este é esse teste.
    const sync = new CloudSyncService(fakeBufferWith([]), {
      base: 'https://api', token: 't', fetchImpl: async () => okJson({}), jitter: () => 0.5
    });
    const delays = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => sync.backoffMsFor(n));
    for (let i = 1; i < delays.length; i++) assert.ok(delays[i] >= delays[i - 1]);
    assert.ok(delays.at(-1)! <= CloudSyncService.MAX_BACKOFF_MS);
  });

  it('zera o backoff depois de um sucesso', async () => {
    const buffer = fakeBufferWith(['m1']);
    let calls = 0;
    const sync = new CloudSyncService(buffer, {
      base: 'https://api', token: 't',
      fetchImpl: async () => {
        calls++;
        if (calls <= 2) throw new Error('ECONNREFUSED');
        return okJson({ accepted: ['m1'], rejected: [] });
      }
    });

    await sync.syncNow();
    await sync.syncNow();
    assert.equal(sync.status().consecutiveFailures, 2, 'duas falhas consecutivas devem ter incrementado o contador');

    await sync.syncNow();
    assert.equal(sync.status().consecutiveFailures, 0, 'um sucesso deve zerar o contador de falhas');
    assert.equal(sync.status().state, 'ok');
    assert.deepEqual(buffer.markedSynced, ['m1']);
  });

  it('envia no máximo o tamanho do lote de uma vez', async () => {
    const buffer = fakeBufferWith(Array.from({ length: 120 }, (_, i) => `m${i}`));
    let maiorLote = 0;
    const sync = new CloudSyncService(buffer, {
      base: 'https://api', token: 't',
      fetchImpl: async (_url: unknown, init: any) => {
        const body = JSON.parse(init.body);
        maiorLote = Math.max(maiorLote, body.matches.length);
        return okJson({ accepted: body.matches.map((m: any) => m.match_id), rejected: [] });
      }
    });
    await sync.syncNow();
    assert.ok(maiorLote <= 50, `lote de ${maiorLote} excede o limite da Spec 05 §5`);
  });

  it('não faz nada, e não lança, quando não há nuvem configurada', async () => {
    const sync = new CloudSyncService(fakeBufferWith(['m1']), { base: null, token: null, fetchImpl: async () => { throw new Error('não deveria chamar'); } });
    assert.equal((await sync.syncNow()).status, 'disabled');
  });

  it('distingue token inválido de falha de rede', async () => {
    const buffer = fakeBufferWith(['m1']);
    const sync = new CloudSyncService(buffer, {
      base: 'https://api', token: 'expirado',
      fetchImpl: async () => new Response('', { status: 401 })
    });

    const outcome = await sync.syncNow();

    assert.equal(outcome.status, 'auth_failed');
    assert.equal(sync.status().state, 'auth_failed', 'o estado precisa ser visível no /api/sync/status');
    assert.deepEqual(buffer.markedSynced, [], 'nada pode ser marcado como sincronizado');
  });

  it('não deixa o estado auth_failed grudado depois que o token é corrigido', async () => {
    const buffer = fakeBufferWith(['m1']);
    let token = 'expirado';
    const sync = new CloudSyncService(buffer, {
      base: 'https://api',
      token: () => token,
      fetchImpl: async (_u: unknown, init: any) =>
        init.headers.Authorization === 'Bearer bom'
          ? okJson({ accepted: ['m1'], rejected: [] })
          : new Response('', { status: 401 })
    });

    await sync.syncNow();
    assert.equal(sync.status().state, 'auth_failed');

    token = 'bom';                       // o operador trocou o token e reiniciou nada
    await sync.syncNow();

    assert.equal(sync.status().state, 'ok');
    assert.deepEqual(buffer.markedSynced, ['m1']);
  });

  it('continua tentando mesmo em auth_failed, com o backoff no teto', async () => {
    let chamadas = 0;
    const sync = new CloudSyncService(fakeBufferWith(['m1']), {
      base: 'https://api', token: 'x',
      fetchImpl: async () => { chamadas++; return new Response('', { status: 403 }); }
    });
    await sync.syncNow();
    await sync.syncNow();
    assert.equal(chamadas, 2, 'auth_failed não pode desligar o worker: o token pode ser corrigido');
  });
});
