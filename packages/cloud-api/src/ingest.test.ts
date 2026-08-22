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
});
