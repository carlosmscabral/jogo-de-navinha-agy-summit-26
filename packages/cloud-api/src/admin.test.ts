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
import {
  patchMatch,
  deleteMatch,
  listMatches,
  getCompanyCatalog,
  putCompanyCatalog,
  getHealthReport
} from './admin.js';
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

  // Revisão final Fase C — Importante 6: uma correção manual de empresa não pode ser
  // sobrescrita depois por uma varredura de canonicalização que ainda veja a marca antiga.
  it('corrigir a empresa de uma partida limpa needs_company_review', async () => {
    await ingestBatch(testDb, [
      matchFixture({
        match_id: 'm1',
        pilot_id: 'p1',
        final_score: 1000,
        company_canonical: 'Gogle',
        needs_company_review: true
      })
    ]);
    await patchMatch(testDb, 'm1', { company_canonical: 'Google' });
    const doc = await testDb.collection('matches').doc('m1').get();
    assert.equal(doc.data()!.needs_company_review, undefined);
  });

  // Revisão final Fase C — Importante 7: `patchMatch` recalculava `company_rankings`
  // corretamente, mas nunca tocava `pilots/{pilot_id}` — anular a melhor partida de um
  // piloto deixava `best_score`/`matches_played` desatualizados para sempre.
  it('anular a melhor partida do piloto recalcula pilots/{id}.best_score e matches_played', async () => {
    await ingestBatch(testDb, [
      matchFixture({ match_id: 'm1', pilot_id: 'p1', final_score: 1000, company_canonical: 'Google' }),
      matchFixture({ match_id: 'm2', pilot_id: 'p1', final_score: 400, company_canonical: 'Google' })
    ]);
    await patchMatch(testDb, 'm1', { voided: true });
    const pilot = (await testDb.collection('pilots').doc('p1').get()).data()!;
    assert.equal(pilot.best_score, 400, 'o melhor score cai para o próximo colocado');
    assert.equal(pilot.matches_played, 1, 'a partida anulada não conta mais');
  });

  it('anular a única partida do piloto zera best_score e matches_played', async () => {
    await ingestBatch(testDb, [matchFixture({ match_id: 'm1', pilot_id: 'p1', final_score: 1000 })]);
    await patchMatch(testDb, 'm1', { voided: true });
    const pilot = (await testDb.collection('pilots').doc('p1').get()).data()!;
    assert.equal(pilot.best_score, 0);
    assert.equal(pilot.matches_played, 0);
  });

  it('corrigir o final_score da melhor partida do piloto atualiza pilots/{id}.best_score', async () => {
    await ingestBatch(testDb, [
      matchFixture({ match_id: 'm1', pilot_id: 'p1', final_score: 1000 }),
      matchFixture({ match_id: 'm2', pilot_id: 'p1', final_score: 400 })
    ]);
    await patchMatch(testDb, 'm1', { final_score: 250 });
    const pilot = (await testDb.collection('pilots').doc('p1').get()).data()!;
    assert.equal(pilot.best_score, 400, 'o segundo colocado vira o novo melhor score');
    assert.equal(pilot.matches_played, 2);
  });
});

describe('DELETE /v1/admin/matches/:id', () => {
  beforeEach(async () => { await clearFirestore(); });

  it('apaga o documento e recalcula company_rankings só com a partida que sobrou', async () => {
    await ingestBatch(testDb, [
      matchFixture({ match_id: 'm1', final_score: 1000, company_canonical: 'Google' }),
      matchFixture({ match_id: 'm2', pilot_id: 'p2', final_score: 300, company_canonical: 'Google' })
    ]);

    await deleteMatch(testDb, 'm1');

    const rank = (await testDb.collection('company_rankings').doc('Google').get()).data()!;
    assert.equal(rank.total_score, 300);
    assert.equal(rank.pilots_count, 1);
    assert.equal(rank.top_individual_score, 300, 'o recorde precisa cair junto');
    const doc = await testDb.collection('matches').doc('m1').get();
    assert.equal(doc.exists, false, 'deleteMatch apaga de verdade, ao contrário de anular');
  });

  it('recalcula pilots/{id}.best_score e matches_played sem a partida apagada', async () => {
    await ingestBatch(testDb, [
      matchFixture({ match_id: 'm1', pilot_id: 'p1', final_score: 1000, company_canonical: 'Google' }),
      matchFixture({ match_id: 'm2', pilot_id: 'p1', final_score: 400, company_canonical: 'Google' })
    ]);
    await deleteMatch(testDb, 'm1');
    const pilot = (await testDb.collection('pilots').doc('p1').get()).data()!;
    assert.equal(pilot.best_score, 400, 'o melhor score cai para o próximo colocado');
    assert.equal(pilot.matches_played, 1, 'a partida apagada não conta mais');
  });

  it('recusa apagar uma partida que não existe', async () => {
    await assert.rejects(() => deleteMatch(testDb, 'nao-existe'), /not found/i);
  });

  // Revisão final Fase C follow-up — Importante 2: apagar a última partida de uma empresa
  // (ou a única de um piloto) não pode deixar um documento de agregado zero-valorado para
  // trás -- isso reapareceria no ranking do painel ou, cedo num evento, até no telão.
  it('apagar a única partida de uma empresa remove o documento de company_rankings, não só zera', async () => {
    await ingestBatch(testDb, [
      matchFixture({ match_id: 'm1', pilot_id: 'p1', final_score: 1000, company_canonical: 'Google' })
    ]);

    await deleteMatch(testDb, 'm1');

    const rank = await testDb.collection('company_rankings').doc('Google').get();
    assert.equal(rank.exists, false, 'não deve sobrar um documento fantasma zero-valorado');
  });

  it('apagar a única partida de um piloto remove o documento de pilots, não só zera', async () => {
    await ingestBatch(testDb, [
      matchFixture({ match_id: 'm1', pilot_id: 'p1', final_score: 1000, company_canonical: 'Google' })
    ]);

    await deleteMatch(testDb, 'm1');

    const pilot = await testDb.collection('pilots').doc('p1').get();
    assert.equal(pilot.exists, false, 'não deve sobrar um documento fantasma zero-valorado');
  });

  it('apagar uma de duas partidas da mesma empresa mantém um agregado real e não vazio para a sobrevivente', async () => {
    await ingestBatch(testDb, [
      matchFixture({ match_id: 'm1', pilot_id: 'p1', final_score: 1000, company_canonical: 'Google' }),
      matchFixture({ match_id: 'm2', pilot_id: 'p2', final_score: 300, company_canonical: 'Google' })
    ]);

    await deleteMatch(testDb, 'm1');

    const rank = await testDb.collection('company_rankings').doc('Google').get();
    assert.equal(rank.exists, true, 'a empresa ainda tem uma partida real -- o documento não pode sumir');
    assert.equal(rank.data()!.total_score, 300);
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

  // Revisão final Fase C — Crítico 2: `ingestOne` grava `created_at` via
  // `FieldValue.serverTimestamp()`, então o documento devolvido pelo emulador AQUI já é um
  // `Timestamp` real, não uma string ISO de fixture — exatamente o caso que os testes
  // antigos (todos com fixtures de string) nunca cobriam.
  it('devolve created_at como string ISO válida, não o Timestamp cru do Firestore', async () => {
    await ingestBatch(testDb, [matchFixture({ match_id: 'm1' })]);
    const found = await listMatches(testDb, {});
    assert.equal(found.length, 1);
    assert.equal(typeof found[0].created_at, 'string');
    assert.equal(Number.isNaN(Date.parse(found[0].created_at)), false, 'created_at precisa ser parseável');
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
