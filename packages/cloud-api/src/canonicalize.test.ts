import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveCompanies,
  runCanonicalizationSweep,
  listAliasesSince,
  type CanonicalizeRequestItem
} from './canonicalize.js';
import { testDb, clearFirestore, matchFixture } from './test-helpers.js';
import { ingestBatch } from './ingest.js';

const CATALOG = ['Google', 'Itaú', 'Nubank'];

describe('resolveCompanies (injetado, sem rede)', () => {
  it('devolve o que o modelo resolveu para cada item, casando por match_id', async () => {
    const items: CanonicalizeRequestItem[] = [
      { match_id: 'a', company_raw: 'gogle', local_guess: 'Gogle' },
      { match_id: 'b', company_raw: 'itau', local_guess: 'Itau' }
    ];
    const generate = async () =>
      JSON.stringify([
        { match_id: 'a', company_canonical: 'Google', confidence: 0.95 },
        { match_id: 'b', company_canonical: 'Itaú', confidence: 0.9 }
      ]);

    const resolved = await resolveCompanies(items, generate, CATALOG);
    assert.deepEqual(
      resolved.map((r) => r.company_canonical),
      ['Google', 'Itaú']
    );
  });

  it('cai para o palpite local com confidence 0 quando o modelo devolve lixo', async () => {
    const items: CanonicalizeRequestItem[] = [{ match_id: 'a', company_raw: 'x', local_guess: 'X Corp' }];
    const generate = async () => 'não é json';

    const resolved = await resolveCompanies(items, generate, CATALOG);
    assert.deepEqual(resolved, [{ match_id: 'a', company_canonical: 'X Corp', confidence: 0 }]);
  });

  it('cai para o palpite local com confidence 0 quando a chamada ao modelo falha', async () => {
    const items: CanonicalizeRequestItem[] = [{ match_id: 'a', company_raw: 'x', local_guess: 'X Corp' }];
    const generate = async () => { throw new Error('rede fora'); };

    const resolved = await resolveCompanies(items, generate, CATALOG);
    assert.deepEqual(resolved, [{ match_id: 'a', company_canonical: 'X Corp', confidence: 0 }]);
  });

  it('devolve lista vazia sem chamar o modelo quando não há itens', async () => {
    let called = false;
    const generate = async () => { called = true; return '[]'; };
    const resolved = await resolveCompanies([], generate, CATALOG);
    assert.deepEqual(resolved, []);
    assert.equal(called, false);
  });
});

describe('runCanonicalizationSweep (Firestore emulator)', () => {
  beforeEach(async () => { await clearFirestore(); });

  it('corrige o documento da partida e os DOIS agregados quando a confiança supera o limiar e o nome difere', async () => {
    await ingestBatch(testDb, [
      matchFixture({
        match_id: 'm1',
        pilot_id: 'p1',
        final_score: 1000,
        company_raw: 'gogle',
        company_canonical: 'Gogle',
        needs_company_review: true
      })
    ]);

    const generate = async () =>
      JSON.stringify([{ match_id: 'm1', company_canonical: 'Google', confidence: 0.95 }]);

    await runCanonicalizationSweep(testDb, generate, CATALOG, 0.85);

    const match = (await testDb.collection('matches').doc('m1').get()).data()!;
    assert.equal(match.company_canonical, 'Google');
    assert.equal(match.needs_company_review, undefined, 'a marca precisa ser limpa');

    const wrong = (await testDb.collection('company_rankings').doc('Gogle').get()).data();
    assert.equal(wrong?.total_score ?? 0, 0, 'a empresa errada não pode ficar com o score');
    assert.equal(wrong?.pilots_count ?? 0, 0);

    const right = (await testDb.collection('company_rankings').doc('Google').get()).data()!;
    assert.equal(right.total_score, 1000);
    assert.equal(right.pilots_count, 1);

    const pilot = (await testDb.collection('pilots').doc('p1').get()).data()!;
    assert.equal(pilot.company_canonical, 'Google');
  });

  it('não corrige nada quando a confiança fica abaixo do limiar — a marca continua para retentar depois', async () => {
    await ingestBatch(testDb, [
      matchFixture({
        match_id: 'm2',
        pilot_id: 'p2',
        final_score: 500,
        company_canonical: 'Gogle',
        needs_company_review: true
      })
    ]);

    const generate = async () =>
      JSON.stringify([{ match_id: 'm2', company_canonical: 'Google', confidence: 0.4 }]);

    await runCanonicalizationSweep(testDb, generate, CATALOG, 0.85);

    const match = (await testDb.collection('matches').doc('m2').get()).data()!;
    assert.equal(match.company_canonical, 'Gogle', 'não corrigido: confiança baixa demais');
    assert.equal(match.needs_company_review, true, 'continua marcada para a próxima varredura');

    const rank = await testDb.collection('company_rankings').doc('Google').get();
    assert.equal(rank.exists, false, 'nenhum agregado deve nascer da correção que não aconteceu');
  });

  it('confirma e limpa a marca sem tocar nos agregados quando o modelo concorda com o palpite local', async () => {
    await ingestBatch(testDb, [
      matchFixture({
        match_id: 'm3',
        pilot_id: 'p3',
        final_score: 700,
        company_canonical: 'Google',
        needs_company_review: true
      })
    ]);

    const generate = async () =>
      JSON.stringify([{ match_id: 'm3', company_canonical: 'Google', confidence: 0.99 }]);

    await runCanonicalizationSweep(testDb, generate, CATALOG, 0.85);

    const match = (await testDb.collection('matches').doc('m3').get()).data()!;
    assert.equal(match.needs_company_review, undefined);

    const rank = (await testDb.collection('company_rankings').doc('Google').get()).data()!;
    assert.equal(rank.total_score, 700, 'não pode ter sido somado duas vezes');
  });

  it('não faz nada quando não há partidas marcadas', async () => {
    let called = false;
    const generate = async () => { called = true; return '[]'; };
    await runCanonicalizationSweep(testDb, generate, CATALOG, 0.85);
    assert.equal(called, false);
  });
});

describe('listAliasesSince (Firestore emulator)', () => {
  beforeEach(async () => { await clearFirestore(); });

  it('devolve só os aliases resolvidos depois de "since"', async () => {
    await ingestBatch(testDb, [
      matchFixture({ match_id: 'm4', company_raw: 'gogle', company_canonical: 'Gogle', needs_company_review: true })
    ]);
    const before = new Date(Date.now() - 1000).toISOString();

    const generate = async () =>
      JSON.stringify([{ match_id: 'm4', company_canonical: 'Google', confidence: 0.9 }]);
    await runCanonicalizationSweep(testDb, generate, CATALOG, 0.85);

    const aliases = await listAliasesSince(testDb, before);
    assert.equal(aliases.length, 1);
    assert.equal(aliases[0].raw, 'gogle');
    assert.equal(aliases[0].canonical, 'Google');

    const future = new Date(Date.now() + 60_000).toISOString();
    assert.deepEqual(await listAliasesSince(testDb, future), []);
  });
});
