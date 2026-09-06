import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { FieldValue } from 'firebase-admin/firestore';
import { SCHEMA_VERSION } from '@jogo/shared';
import {
  resolveCompanies,
  runCanonicalizationSweep,
  correctMatchCompany,
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

  // Revisão final Fase C — Importante 6: uma partida anulada nunca pode voltar a somar em
  // nenhum agregado, nem por uma correção de canonicalização em segundo plano.
  it('correctMatchCompany não mexe em nada quando a partida está anulada (voided)', async () => {
    await ingestBatch(testDb, [
      matchFixture({
        match_id: 'm5',
        pilot_id: 'p5',
        final_score: 900,
        company_canonical: 'Gogle',
        needs_company_review: true
      })
    ]);
    await testDb.collection('matches').doc('m5').update({ voided: true });

    await correctMatchCompany(testDb, 'm5', 'Google', 0.95);

    const match = (await testDb.collection('matches').doc('m5').get()).data()!;
    assert.equal(match.company_canonical, 'Gogle', 'partida anulada não deve ser corrigida');
    assert.equal(match.needs_company_review, true, 'a marca não é tocada pelo no-op');

    const newCompany = await testDb.collection('company_rankings').doc('Google').get();
    assert.equal(newCompany.exists, false, 'nenhum agregado novo pode nascer de uma correção pulada');
  });

  // Importante 6: `schema_version` deve vir da constante, não do campo (possivelmente
  // ausente) da partida legada — escrever `undefined` explicitamente faria o Admin SDK lançar.
  it('usa a constante SCHEMA_VERSION ao gravar o novo agregado, não o campo da partida', async () => {
    await ingestBatch(testDb, [
      matchFixture({
        match_id: 'm6',
        pilot_id: 'p6',
        final_score: 300,
        company_canonical: 'Gogle',
        needs_company_review: true
      })
    ]);
    // Simula uma partida legada sem schema_version.
    await testDb.collection('matches').doc('m6').update({ schema_version: FieldValue.delete() });

    await correctMatchCompany(testDb, 'm6', 'Google', 0.95);

    const right = (await testDb.collection('company_rankings').doc('Google').get()).data()!;
    assert.equal(right.schema_version, SCHEMA_VERSION);
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

    const page = await listAliasesSince(testDb, before);
    assert.equal(page.aliases.length, 1);
    assert.equal(page.aliases[0].raw, 'gogle');
    assert.equal(page.aliases[0].canonical, 'Google');
    assert.equal(page.has_more, false);
    assert.equal(page.next_since, page.aliases[0].resolved_at, 'o cursor é o último alias da página');

    const future = new Date(Date.now() + 60_000).toISOString();
    const empty = await listAliasesSince(testDb, future);
    assert.deepEqual(empty.aliases, []);
    assert.equal(empty.has_more, false);
    assert.equal(empty.next_since, future, 'página vazia devolve o próprio since — cursor não anda sozinho');
  });

  it('pagina: respeita o limite, sinaliza has_more e o cursor cobre tudo sem perder alias', async () => {
    // O primeiro boot de uma estação nova puxa desde a epoch. Sem `.limit()` isso era a coleção
    // inteira numa resposta só, no pior momento do dia (a abertura do estande).
    for (let i = 0; i < 5; i++) {
      await testDb.collection('company_aliases').add({
        raw: `raw-${i}`,
        canonical: `Empresa ${i}`,
        // Timestamps distintos e crescentes: é o que o cursor usa para avançar.
        resolved_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i))
      });
    }

    const vistos: string[] = [];
    let since = new Date(0).toISOString();
    let voltas = 0;
    for (;;) {
      const page = await listAliasesSince(testDb, since, 2);
      assert.ok(page.aliases.length <= 2, 'o limite tem que ser respeitado');
      for (const a of page.aliases) if (!vistos.includes(a.raw)) vistos.push(a.raw);
      if (!page.has_more) break;
      // Mesmo avanço que o daemon faz: repetir o último alias é idempotente, perder um não é.
      since = page.next_since;
      assert.ok(++voltas < 10, 'o cursor precisa avançar — laço infinito é falha');
    }

    assert.deepEqual(vistos, ['raw-0', 'raw-1', 'raw-2', 'raw-3', 'raw-4']);
  });

  it('clampa o limite: 0, negativo e absurdo não viram varredura da coleção nem página vazia', async () => {
    for (let i = 0; i < 3; i++) {
      await testDb.collection('company_aliases').add({
        raw: `raw-${i}`,
        canonical: `Empresa ${i}`,
        resolved_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i))
      });
    }
    const epoch = new Date(0).toISOString();

    assert.equal((await listAliasesSince(testDb, epoch, 0)).aliases.length, 3, '0 cai no default');
    assert.equal((await listAliasesSince(testDb, epoch, -5)).aliases.length, 1, 'negativo vira 1');
    assert.equal((await listAliasesSince(testDb, epoch, 10_000_000)).aliases.length, 3, 'clampado no teto');
  });

  it('um documento com resolved_at de outro tipo é PULADO, não derruba a rota', async () => {
    // Era `data.resolved_at.toDate()` direto. Um único documento estranho — de um script, de uma
    // escrita manual no console — transformava GET /v1/aliases em 500 permanente para as DUAS
    // estações, e o sintoma seria "o estande parou de aprender", não "há um doc malformado".
    await testDb.collection('company_aliases').add({
      raw: 'bom',
      canonical: 'Empresa Boa',
      resolved_at: new Date(Date.UTC(2026, 0, 1, 0, 0, 1))
    });
    await testDb.collection('company_aliases').add({
      raw: 'ruim',
      canonical: 'Empresa Ruim',
      resolved_at: '2026-01-01T00:00:02.000Z' // string, não Timestamp
    });
    await testDb.collection('company_aliases').add({
      raw: 'sem canonical',
      resolved_at: new Date(Date.UTC(2026, 0, 1, 0, 0, 3))
    });

    const page = await listAliasesSince(testDb, new Date(0).toISOString());
    assert.deepEqual(
      page.aliases.map((a) => a.raw),
      ['bom'],
      'o alias bom precisa chegar mesmo com lixo na coleção'
    );
  });
});
