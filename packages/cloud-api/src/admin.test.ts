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
import { FieldValue } from 'firebase-admin/firestore';
import { ingestBatch } from './ingest.js';
import {
  patchMatch,
  deleteMatch,
  listMatches,
  getCompanyCatalog,
  putCompanyCatalog,
  seedCompanyCatalogIfMissing,
  CatalogConflictError,
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

  // Spec 11 §4.12: o `match_id` é o identificador que o staff tem na mão (log do daemon, JSON do
  // debriefing) e era o único que a busca não enxergava.
  it('busca por match_id, inteiro ou em pedaço', async () => {
    await ingestBatch(testDb, [
      matchFixture({ match_id: 'match_1756000000001', callsign: 'UM', company_canonical: 'Google' }),
      matchFixture({ match_id: 'match_1756000000002', callsign: 'DOIS', company_canonical: 'Nubank' })
    ]);
    const inteiro = await listMatches(testDb, { q: 'match_1756000000002' });
    assert.deepEqual(inteiro.map((m: MatchDocument) => m.match_id), ['match_1756000000002']);

    const pedaco = await listMatches(testDb, { q: '0000002' });
    assert.deepEqual(pedaco.map((m: MatchDocument) => m.match_id), ['match_1756000000002']);
  });

  // O ponto do fallback por leitura direta: a varredura em memória só vê as 500 partidas mais
  // recentes, e um `match_id` vindo de um log pode ser de horas antes. Sem forjar 500 partidas,
  // o caso é exercido pelo caminho equivalente — um documento que a varredura não devolve.
  it('acha por match_id exato mesmo quando a varredura por created_at não traz o documento', async () => {
    await ingestBatch(testDb, [matchFixture({ match_id: 'antiga', callsign: 'VELHA' })]);
    // APAGAR o campo (não gravar `null`): um `orderBy` do Firestore só omite documentos em que o
    // campo está AUSENTE — `null` é um valor ordenável e continua vindo na varredura. Com o campo
    // fora, temos a mesma invisibilidade de estar além da janela de 500, sem forjar 500 partidas.
    await testDb.collection('matches').doc('antiga').update({ created_at: FieldValue.delete() });

    const varredura = await listMatches(testDb, {});
    assert.equal(varredura.length, 0, 'pré-condição: a varredura não enxerga este documento');

    const found = await listMatches(testDb, { q: 'antiga' });
    assert.deepEqual(found.map((m: MatchDocument) => m.match_id), ['antiga']);
  });

  it('não duplica quando o match_id exato também aparece na varredura', async () => {
    await ingestBatch(testDb, [matchFixture({ match_id: 'm1', callsign: 'UM' })]);
    const found = await listMatches(testDb, { q: 'm1' });
    assert.equal(found.length, 1);
  });

  it('respeita o filtro de empresa mesmo num match_id exato de outra empresa', async () => {
    await ingestBatch(testDb, [
      matchFixture({ match_id: 'm1', company_canonical: 'Google' }),
      matchFixture({ match_id: 'm2', company_canonical: 'Nubank' })
    ]);
    const found = await listMatches(testDb, { q: 'm1', company: 'Nubank' });
    assert.deepEqual(found.map((m: MatchDocument) => m.match_id), []);
  });

  // `q` é texto livre digitado por gente, e `.doc()` lança para caminho com `/`. Sem o guarda,
  // este caso derruba o endpoint com 500 em vez de devolver uma lista vazia.
  it('não quebra quando q tem caracteres inválidos para um ID de documento', async () => {
    await ingestBatch(testDb, [matchFixture({ match_id: 'm1', callsign: 'UM' })]);
    const found = await listMatches(testDb, { q: 'a/b' });
    assert.deepEqual(found, []);
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

  it('documento ausente é versão 0, e cada gravação incrementa', async () => {
    assert.equal((await getCompanyCatalog(testDb)).version, 0);
    assert.equal((await putCompanyCatalog(testDb, ['Google'])).version, 1);
    assert.equal((await getCompanyCatalog(testDb)).version, 1);
    assert.equal((await putCompanyCatalog(testDb, ['Google', 'Nubank'])).version, 2);
    assert.equal((await getCompanyCatalog(testDb)).version, 2);
  });

  it('documento gravado antes do campo `version` existir é lido como versão 1', async () => {
    // Zero significa "nunca gravado". Devolver 0 para um catálogo real faria um PUT com
    // expectedVersion: 0 passar por cima dele — o oposto do que a trava existe para impedir.
    await testDb.collection('companies').doc('catalog').set({
      schema_version: 1,
      companies: ['Google'],
      updated_at: FieldValue.serverTimestamp()
    });
    assert.equal((await getCompanyCatalog(testDb)).version, 1);
  });

  it('uma versão obsoleta NÃO altera o documento', async () => {
    // Dois operadores com a tela aberta. O primeiro salva; o segundo salva por cima com a
    // versão que carregou antes. Antes da trava, o segundo apagava as edições do primeiro
    // em silêncio, e este documento hoje alimenta as DUAS estações.
    await putCompanyCatalog(testDb, ['Google']); // versão 1
    await putCompanyCatalog(testDb, ['Google', 'Nubank'], { expectedVersion: 1 }); // versão 2

    await assert.rejects(
      () => putCompanyCatalog(testDb, ['Só o que eu tinha na tela'], { expectedVersion: 1 }),
      (err: unknown) => {
        assert.ok(err instanceof CatalogConflictError);
        assert.deepEqual(err.current.companies, ['Google', 'Nubank'], 'o 409 carrega o estado atual');
        assert.equal(err.current.version, 2);
        return true;
      }
    );

    const catalog = await getCompanyCatalog(testDb);
    assert.deepEqual(catalog.companies, ['Google', 'Nubank'], 'nada pode ter sido gravado');
    assert.equal(catalog.version, 2, 'nem a versão pode ter avançado');
  });

  it('PUT sem expectedVersion continua gravando (compatibilidade)', async () => {
    await putCompanyCatalog(testDb, ['Google']);
    await putCompanyCatalog(testDb, ['Ambev']);
    assert.deepEqual((await getCompanyCatalog(testDb)).companies, ['Ambev']);
  });

  it('recusa gravar um catálogo VAZIO sem force', async () => {
    await putCompanyCatalog(testDb, ['Google', 'Nubank']);
    await assert.rejects(() => putCompanyCatalog(testDb, []), /VAZIO/);
    assert.deepEqual((await getCompanyCatalog(testDb)).companies, ['Google', 'Nubank']);
  });

  it('aceita esvaziar com force, que é o caso legítimo e explícito', async () => {
    await putCompanyCatalog(testDb, ['Google']);
    await putCompanyCatalog(testDb, [], { force: true });
    assert.deepEqual((await getCompanyCatalog(testDb)).companies, []);
  });

  it('recusa entradas em branco ou não-string', async () => {
    await assert.rejects(() => putCompanyCatalog(testDb, ['Google', '   ']), /non-blank/);
    await assert.rejects(
      () => putCompanyCatalog(testDb, ['Google', 42] as unknown as string[]),
      /non-blank/
    );
    assert.deepEqual((await getCompanyCatalog(testDb)).companies, []);
  });
});

describe('seedCompanyCatalogIfMissing', () => {
  beforeEach(async () => { await clearFirestore(); });

  it('cria o documento quando ele não existe', async () => {
    assert.equal(await seedCompanyCatalogIfMissing(testDb, ['Google', 'Nubank']), true);
    const catalog = await getCompanyCatalog(testDb);
    assert.deepEqual(catalog.companies, ['Google', 'Nubank']);
    assert.equal(catalog.version, 1);
  });

  it('NUNCA sobrescreve um catálogo que já tem empresas', async () => {
    // Um deploy na véspera do evento que apagasse as empresas cadastradas pelo operador seria
    // muito pior que um deploy que não semeia.
    await putCompanyCatalog(testDb, ['Empresa do operador']);
    assert.equal(await seedCompanyCatalogIfMissing(testDb, ['Google', 'Nubank']), false);
    assert.deepEqual((await getCompanyCatalog(testDb)).companies, ['Empresa do operador']);
  });

  it('semeia por cima de um documento que existe mas está VAZIO', async () => {
    // Resíduo exato do "Salvar" descuidado numa tela que abriu vazia — não é conteúdo a
    // preservar, é o estado que a semeadura existe para consertar.
    await putCompanyCatalog(testDb, [], { force: true });
    assert.equal(await seedCompanyCatalogIfMissing(testDb, ['Google']), true);
    assert.deepEqual((await getCompanyCatalog(testDb)).companies, ['Google']);
  });

  it('é idempotente: a segunda chamada não faz nada', async () => {
    await seedCompanyCatalogIfMissing(testDb, ['Google']);
    assert.equal(await seedCompanyCatalogIfMissing(testDb, ['Google']), false);
    assert.equal((await getCompanyCatalog(testDb)).version, 1, 'a versão não pode avançar à toa');
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

  it('agrupa as partidas por estação com contagem e último horário', async () => {
    await ingestBatch(testDb, [
      matchFixture({ match_id: 'm1', station_id: 'booth-a' }),
      matchFixture({ match_id: 'm2', station_id: 'booth-b' }),
      matchFixture({ match_id: 'm3', station_id: 'booth-a' })
    ]);

    const { stations } = (await getHealthReport(testDb)).stationActivity;
    const porId = new Map(stations.map((s) => [s.stationId, s]));

    assert.equal(stations.length, 2);
    assert.equal(porId.get('booth-a')?.matches, 2);
    assert.equal(porId.get('booth-b')?.matches, 1);
  });

  it('lastMatchAt é string ISO, nunca o Timestamp cru do Firestore', async () => {
    // Mesma regressão de `listMatches`: `created_at` é gravado com `FieldValue.serverTimestamp()`
    // e volta como `Timestamp` do Admin SDK. Serializado na resposta HTTP isso vira
    // `{_seconds,_nanoseconds}`, e o React quebra com "Objects are not valid as a React child"
    // — tela branca no painel, no meio do evento.
    await ingestBatch(testDb, [matchFixture({ match_id: 'm1', station_id: 'booth-a' })]);

    const { stations } = (await getHealthReport(testDb)).stationActivity;
    assert.equal(typeof stations[0].lastMatchAt, 'string');
    assert.ok(!Number.isNaN(Date.parse(stations[0].lastMatchAt)), 'lastMatchAt não é uma data legível');
  });

  it('partidas sem station_id caem num rótulo próprio, não somem nem viram "undefined"', async () => {
    // As partidas ingeridas antes do campo existir, e as de um daemon sem a env configurada.
    await ingestBatch(testDb, [
      matchFixture({ match_id: 'm1' }),
      matchFixture({ match_id: 'm2', station_id: 'booth-a' })
    ]);

    const ids = (await getHealthReport(testDb)).stationActivity.stations.map((s) => s.stationId);
    assert.deepEqual([...ids].sort(), ['(sem station_id)', 'booth-a']);
  });

  it('a estação com atividade mais recente vem primeiro', async () => {
    // No dia a pergunta é "qual Mac parou?", e ordenar por recência põe a resposta na última linha.
    await ingestBatch(testDb, [matchFixture({ match_id: 'm1', station_id: 'booth-a' })]);
    await new Promise((r) => setTimeout(r, 50));
    await ingestBatch(testDb, [matchFixture({ match_id: 'm2', station_id: 'booth-b' })]);

    const { stations } = (await getHealthReport(testDb)).stationActivity;
    assert.equal(stations[0].stationId, 'booth-b');
    assert.equal(stations[1].stationId, 'booth-a');
  });

  it('sem partida nenhuma, a seção vem vazia em vez de quebrar', async () => {
    const report = await getHealthReport(testDb);
    assert.deepEqual(report.stationActivity.stations, []);
    assert.equal(report.stationActivity.sampleSize, 0);
  });
});

describe('listMatches — filtro por estação', () => {
  beforeEach(async () => { await clearFirestore(); });

  it('filtra pelas partidas de um único Mac', async () => {
    await ingestBatch(testDb, [
      matchFixture({ match_id: 'm1', station_id: 'booth-a' }),
      matchFixture({ match_id: 'm2', station_id: 'booth-b' }),
      matchFixture({ match_id: 'm3', station_id: 'booth-a' })
    ]);

    const docs = await listMatches(testDb, { station: 'booth-a' });
    assert.deepEqual(docs.map((d) => d.match_id).sort(), ['m1', 'm3']);
  });

  it('o rótulo das partidas sem station_id também filtra', async () => {
    await ingestBatch(testDb, [
      matchFixture({ match_id: 'm1' }),
      matchFixture({ match_id: 'm2', station_id: 'booth-a' })
    ]);

    const docs = await listMatches(testDb, { station: '(sem station_id)' });
    assert.deepEqual(docs.map((d) => d.match_id), ['m1']);
  });

  it('combina com o filtro de empresa em vez de substituí-lo', async () => {
    await ingestBatch(testDb, [
      matchFixture({ match_id: 'm1', station_id: 'booth-a', company_canonical: 'Google' }),
      matchFixture({ match_id: 'm2', station_id: 'booth-a', company_canonical: 'Itaú' }),
      matchFixture({ match_id: 'm3', station_id: 'booth-b', company_canonical: 'Google' })
    ]);

    const docs = await listMatches(testDb, { station: 'booth-a', company: 'Google' });
    assert.deepEqual(docs.map((d) => d.match_id), ['m1']);
  });
});
