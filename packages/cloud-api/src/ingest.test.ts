import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ingestBatch } from './ingest.js';
import { testDb, clearFirestore, matchFixture } from './test-helpers.js';

describe('ingestBatch', () => {
  beforeEach(async () => { await clearFirestore(); });

  it('grava a partida e devolve o match_id como aceito', async () => {
    const r = await ingestBatch(testDb, [matchFixture({ match_id: 'm1', final_score: 18450 })]);
    assert.deepEqual(r.accepted, ['m1']);
    const doc = await testDb.collection('matches').doc('m1').get();
    assert.equal(doc.data()!.final_score, 18450);
  });

  it('é idempotente: reenviar o mesmo match_id não duplica nem soma duas vezes', async () => {
    const m = matchFixture({ match_id: 'm1', final_score: 1000, company_canonical: 'Google' });
    await ingestBatch(testDb, [m]);
    await ingestBatch(testDb, [m]);
    const rank = await testDb.collection('company_rankings').doc('Google').get();
    assert.equal(rank.data()!.total_score, 1000, 'o agregado somou o reenvio');
    assert.equal(rank.data()!.pilots_count, 1);
  });

  it('acumula o agregado corporativo entre pilotos diferentes', async () => {
    await ingestBatch(testDb, [
      matchFixture({ match_id: 'a', pilot_id: 'p1', final_score: 1000, company_canonical: 'Google' }),
      matchFixture({ match_id: 'b', pilot_id: 'p2', final_score: 2500, company_canonical: 'Google' })
    ]);
    const rank = (await testDb.collection('company_rankings').doc('Google').get()).data()!;
    assert.equal(rank.total_score, 3500);
    assert.equal(rank.pilots_count, 2);
    assert.equal(rank.top_individual_score, 2500);
  });

  it('mantém o melhor score do piloto e conta as partidas', async () => {
    await ingestBatch(testDb, [matchFixture({ match_id: 'a', pilot_id: 'p1', final_score: 5000 })]);
    await ingestBatch(testDb, [matchFixture({ match_id: 'b', pilot_id: 'p1', final_score: 900 })]);
    const pilot = (await testDb.collection('pilots').doc('p1').get()).data()!;
    assert.equal(pilot.best_score, 5000);
    assert.equal(pilot.matches_played, 2);
  });

  it('conta o piloto na empresa nova quando ele joga de novo por outra empresa', async () => {
    await ingestBatch(testDb, [
      matchFixture({ match_id: 'a', pilot_id: 'p1', final_score: 1000, company_canonical: 'Gogle' })
    ]);
    await ingestBatch(testDb, [
      matchFixture({ match_id: 'b', pilot_id: 'p1', final_score: 1200, company_canonical: 'Google' })
    ]);
    const nova = (await testDb.collection('company_rankings').doc('Google').get()).data()!;
    assert.equal(nova.pilots_count, 1, 'a empresa nova ficou com zero pilotos');
  });

  it('conta cada piloto uma vez só na mesma empresa, mesmo com várias partidas', async () => {
    await ingestBatch(testDb, [
      matchFixture({ match_id: 'a', pilot_id: 'p1', final_score: 1000, company_canonical: 'Google' }),
      matchFixture({ match_id: 'b', pilot_id: 'p1', final_score: 2000, company_canonical: 'Google' })
    ]);
    const rank = (await testDb.collection('company_rankings').doc('Google').get()).data()!;
    assert.equal(rank.pilots_count, 1);
    assert.equal(rank.total_score, 3000);
  });

  it('rejeita score fora da faixa plausível sem derrubar o lote', async () => {
    const r = await ingestBatch(testDb, [
      matchFixture({ match_id: 'ok', final_score: 12000 }),
      matchFixture({ match_id: 'absurdo', final_score: 99_000_000 })
    ]);
    assert.deepEqual(r.accepted, ['ok']);
    assert.equal(r.rejected[0].match_id, 'absurdo');
    assert.match(r.rejected[0].reason, /score/i);
  });

  it('rejeita partida sem telemetria em vez de gravar um documento vazio', async () => {
    const r = await ingestBatch(testDb, [matchFixture({ match_id: 'x', telemetry: undefined as any })]);
    assert.equal(r.accepted.length, 0);
    assert.match(r.rejected[0].reason, /telemetry/i);
  });

  // Revisão final Fase C — Crítico 1: um `company_canonical` que não é um ID de documento
  // Firestore válido (aqui, contendo `/`) precisa cair em `rejected[]` ANTES da transação,
  // não travar `ingestOne` no meio de `db.runTransaction`.
  it('rejeita company_canonical que não seria um ID de documento Firestore válido, sem derrubar o lote', async () => {
    const r = await ingestBatch(testDb, [
      matchFixture({ match_id: 'ok', final_score: 1000, company_canonical: 'Google' }),
      matchFixture({ match_id: 'ruim', final_score: 1000, company_canonical: 'Ambev/InBev' })
    ]);
    assert.deepEqual(r.accepted, ['ok']);
    assert.equal(r.rejected.length, 1);
    assert.equal(r.rejected[0].match_id, 'ruim');
    assert.match(r.rejected[0].reason, /company_canonical/i);
  });

  // Revisão final Fase C — Crítico 1, parte 3 (defesa em profundidade): mesmo uma partida que
  // passa em `validate()` pode fazer a transação do Firestore lançar por outro motivo qualquer.
  // Sem o try/catch em `ingestBatch`, isso rejeitaria a Promise inteira e derrubaria as OUTRAS
  // partidas boas do mesmo lote — exatamente o cenário que este teste simula travando
  // `db.runTransaction` na primeira chamada.
  it('uma transação que falha por qualquer outro motivo cai em rejected sem derrubar o lote inteiro', async () => {
    const realRunTransaction = testDb.runTransaction.bind(testDb);
    let calls = 0;
    (testDb as any).runTransaction = (fn: any) => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(new Error('falha simulada de transação'));
      }
      return realRunTransaction(fn);
    };
    try {
      const r = await ingestBatch(testDb, [
        matchFixture({ match_id: 'boom', final_score: 1000 }),
        matchFixture({ match_id: 'ok2', final_score: 500 })
      ]);
      assert.deepEqual(r.accepted, ['ok2']);
      assert.equal(r.rejected.length, 1);
      assert.equal(r.rejected[0].match_id, 'boom');
      assert.match(r.rejected[0].reason, /ingestOne threw/i);
    } finally {
      (testDb as any).runTransaction = realRunTransaction;
    }
  });

  // --- station_id / played_at (dois estandes) ------------------------------------------
  //
  // O par de campos que diz de qual Mac veio cada partida e a que horas ela foi de fato
  // jogada. Ambos OPCIONAIS, e este primeiro teste é a regressão que trava essa decisão:
  // um estande atualizado no dia do evento tem partidas já enfileiradas no SQLite de antes
  // da mudança. Se a ingestão passar a exigir os campos, essas partidas são rejeitadas em
  // bloco — perder partidas reais de visitantes para ganhar um campo de observabilidade.
  it('aceita partida SEM station_id — as que ficaram na fila antes do upgrade', async () => {
    const r = await ingestBatch(testDb, [matchFixture({ match_id: 'sem-estacao', final_score: 1000 })]);
    assert.deepEqual(r.accepted, ['sem-estacao']);
    assert.equal(r.rejected.length, 0);

    const doc = await testDb.collection('matches').doc('sem-estacao').get();
    assert.equal(doc.data()!.station_id, undefined);
  });

  it('persiste station_id e played_at quando presentes', async () => {
    const jogadaEm = '2026-09-06T13:45:00.000Z';
    await ingestBatch(testDb, [
      matchFixture({ match_id: 'com-estacao', station_id: 'booth-b', played_at: jogadaEm })
    ]);

    const doc = (await testDb.collection('matches').doc('com-estacao').get()).data()!;
    assert.equal(doc.station_id, 'booth-b');
    assert.equal(doc.played_at, jogadaEm);
    // `created_at` continua sendo a hora de INGESTÃO, sobrescrita pelo servidor — é
    // justamente por isso que `played_at` existe. Os dois não podem ser a mesma coisa.
    assert.notEqual(doc.created_at, jogadaEm);
  });

  it('station_id inválido rejeita só a própria partida, preservando o resto do lote', async () => {
    const r = await ingestBatch(testDb, [
      matchFixture({ match_id: 'boa', final_score: 1000, station_id: 'booth-a' }),
      matchFixture({ match_id: 'longa', final_score: 1000, station_id: 'x'.repeat(65) }),
      matchFixture({ match_id: 'controle', final_score: 1000, station_id: 'booth\u0007a' }),
      matchFixture({ match_id: 'numero', final_score: 1000, station_id: 7 as unknown as string }),
      matchFixture({ match_id: 'vazia', final_score: 1000, station_id: '' })
    ]);

    assert.deepEqual(r.accepted, ['boa']);
    assert.deepEqual(r.rejected.map((x) => x.match_id).sort(), ['controle', 'longa', 'numero', 'vazia']);
    for (const rejeitada of r.rejected) assert.match(rejeitada.reason, /station_id/i);
  });

  it('played_at que não é data ISO é recusado, sem derrubar o lote', async () => {
    const r = await ingestBatch(testDb, [
      matchFixture({ match_id: 'ok-data', played_at: new Date().toISOString() }),
      matchFixture({ match_id: 'data-ruim', played_at: 'ontem de tarde' })
    ]);
    assert.deepEqual(r.accepted, ['ok-data']);
    assert.equal(r.rejected.length, 1);
    assert.match(r.rejected[0].reason, /played_at/i);
  });
});
