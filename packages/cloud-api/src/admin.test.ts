/**
 * Painel de administração — Tarefa C7 (Spec 05 §4.3, brief `task-C7-brief.md`).
 *
 * Os quatro primeiros casos são dados verbatim pelo plano: o núcleo perigoso de
 * `patchMatch` é que mover a empresa de uma partida precisa acertar DOIS agregados
 * (o antigo e o novo), que anular precisa tirar a partida dos agregados sem apagar o
 * documento, e que anular duas vezes não pode descontar duas vezes. O quarto é a mesma
 * validação de faixa plausível de `ingest.ts`, aplicada à correção manual.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ingestBatch } from './ingest.js';
import { patchMatch, listMatches, getCompanyCatalog, putCompanyCatalog, getHealthReport } from './admin.js';
import { testDb, clearFirestore, matchFixture } from './test-helpers.js';
import type { MatchDocument } from '@jogo/shared';

describe('PATCH /v1/admin/matches/:id', () => {
  beforeEach(async () => { await clearFirestore(); });

  it('mover uma partida de empresa acerta os dois agregados', async () => {
    await ingestBatch(testDb, [
      matchFixture({ match_id: 'm1', pilot_id: 'p1', final_score: 1000, company_canonical: 'Gogle' })
    ]);

    await patchMatch(testDb, 'm1', { company_canonical: 'Google' });

    const errada = await testDb.collection('company_rankings').doc('Gogle').get();
    const certa = (await testDb.collection('company_rankings').doc('Google').get()).data()!;
    assert.equal(errada.data()?.total_score ?? 0, 0, 'a empresa errada ficou com o score');
    assert.equal(certa.total_score, 1000);
    assert.equal(certa.pilots_count, 1);
  });

  it('anular uma partida a tira do agregado e do placar, sem apagá-la', async () => {
    await ingestBatch(testDb, [
      matchFixture({ match_id: 'm1', final_score: 1000, company_canonical: 'Google' }),
      matchFixture({ match_id: 'm2', pilot_id: 'p2', final_score: 300, company_canonical: 'Google' })
    ]);

    await patchMatch(testDb, 'm1', { voided: true });

    const rank = (await testDb.collection('company_rankings').doc('Google').get()).data()!;
    assert.equal(rank.total_score, 300);
    assert.equal(rank.top_individual_score, 300, 'o recorde precisa cair junto');
    const doc = await testDb.collection('matches').doc('m1').get();
    assert.ok(doc.exists, 'anular não apaga');
    assert.equal(doc.data()!.voided, true);
  });

  it('anular duas vezes não desconta duas vezes', async () => {
    await ingestBatch(testDb, [matchFixture({ match_id: 'm1', final_score: 1000, company_canonical: 'Google' })]);
    await patchMatch(testDb, 'm1', { voided: true });
    await patchMatch(testDb, 'm1', { voided: true });
    const rank = (await testDb.collection('company_rankings').doc('Google').get()).data()!;
    assert.equal(rank.total_score, 0);
  });

  it('recusa uma correção que deixaria o score fora da faixa plausível', async () => {
    await ingestBatch(testDb, [matchFixture({ match_id: 'm1', final_score: 1000 })]);
    await assert.rejects(() => patchMatch(testDb, 'm1', { final_score: 9_000_000 }), /score/i);
  });

  it('recusa corrigir uma partida que não existe', async () => {
    await assert.rejects(() => patchMatch(testDb, 'nao-existe', { voided: true }), /not found/i);
  });

  it('corrigir o final_score de uma partida recalcula o total sem duplicar', async () => {
    await ingestBatch(testDb, [
      matchFixture({ match_id: 'm1', pilot_id: 'p1', final_score: 1000, company_canonical: 'Google' }),
      matchFixture({ match_id: 'm2', pilot_id: 'p2', final_score: 500, company_canonical: 'Google' })
    ]);
    await patchMatch(testDb, 'm1', { final_score: 1500 });
    const rank = (await testDb.collection('company_rankings').doc('Google').get()).data()!;
    assert.equal(rank.total_score, 2000);
    assert.equal(rank.top_individual_score, 1500);
  });
});

describe('listMatches', () => {
  beforeEach(async () => { await clearFirestore(); });

  it('busca por callsign, sem diferenciar maiúsculas', async () => {
    await ingestBatch(testDb, [
      matchFixture({ match_id: 'm1', callsign: 'SKILLER', company_canonical: 'Google' }),
      matchFixture({ match_id: 'm2', callsign: 'OUTRO', company_canonical: 'Nubank' })
    ]);
    const found = await listMatches(testDb, { q: 'skill' });
    assert.deepEqual(found.map((m: MatchDocument) => m.match_id), ['m1']);
  });

  it('filtra por empresa exata', async () => {
    await ingestBatch(testDb, [
      matchFixture({ match_id: 'm1', company_canonical: 'Google' }),
      matchFixture({ match_id: 'm2', company_canonical: 'Nubank' })
    ]);
    const found = await listMatches(testDb, { company: 'Nubank' });
    assert.deepEqual(found.map((m: MatchDocument) => m.match_id), ['m2']);
  });
});

describe('companies/catalog', () => {
  beforeEach(async () => { await clearFirestore(); });

  it('devolve um catálogo vazio quando o documento ainda não existe', async () => {
    const catalog = await getCompanyCatalog(testDb);
    assert.deepEqual(catalog.companies, []);
  });

  it('PUT grava e GET devolve o mesmo catálogo', async () => {
    await putCompanyCatalog(testDb, ['Google', 'Nubank']);
    const catalog = await getCompanyCatalog(testDb);
    assert.deepEqual(catalog.companies, ['Google', 'Nubank']);
    assert.equal(catalog.schema_version, 1);
  });
});

describe('getHealthReport', () => {
  beforeEach(async () => { await clearFirestore(); });

  it('calcula a taxa de preset de emergência a partir da telemetria', async () => {
    await ingestBatch(testDb, [
      matchFixture({ match_id: 'm1', telemetry: { ...matchFixture().telemetry, fallback_used: true } }),
      matchFixture({ match_id: 'm2', telemetry: { ...matchFixture().telemetry, fallback_used: false } })
    ]);
    const report = await getHealthReport(testDb);
    assert.equal(report.emergencyPreset.sampleSize, 2);
    assert.equal(report.emergencyPreset.rate, 0.5);
  });
});
