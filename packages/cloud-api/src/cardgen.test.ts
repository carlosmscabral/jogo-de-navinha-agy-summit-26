import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SHIP_CARD_VERSION, renderShipCardSvg } from '@jogo/shared';
import { generateShipCard, matchIdFromSubject } from './cardgen.js';
import { patchMatch } from './admin.js';
import { testDb, clearFirestore, matchFixture } from './test-helpers.js';

describe('matchIdFromSubject', () => {
  it('extrai o match_id do subject que o Eventarc manda', () => {
    assert.equal(matchIdFromSubject('documents/matches/abc-123'), 'abc-123');
  });

  it('devolve null para tudo que não é um documento de matches', () => {
    for (const subject of [
      undefined,
      null,
      '',
      'matches/abc',
      'documents/pilots/abc',
      'documents/matches/',
      'documents/matches/abc/events/x',
      'documents'
    ]) {
      assert.equal(matchIdFromSubject(subject), null, `subject=${JSON.stringify(subject)}`);
    }
  });
});

describe('generateShipCard', () => {
  beforeEach(async () => {
    await clearFirestore();
  });

  it('grava o cartão e a versão num documento recém-criado', async () => {
    const m = matchFixture({ match_id: 'm1' });
    await testDb.collection('matches').doc('m1').set(m);

    assert.equal(await generateShipCard(testDb, 'm1'), 'written');

    const doc = (await testDb.collection('matches').doc('m1').get()).data()!;
    assert.equal(doc.ship_card_version, SHIP_CARD_VERSION);
    assert.equal(doc.ship_card_svg, renderShipCardSvg(m.ship_spec_snapshot));
    assert.match(doc.ship_card_svg, /^<svg /);
  });

  it('não reescreve quando a versão já é a corrente — reentrega do Pub/Sub é normal', async () => {
    await testDb.collection('matches').doc('m1').set(matchFixture({ match_id: 'm1' }));
    await generateShipCard(testDb, 'm1');
    const antes = (await testDb.collection('matches').doc('m1').get()).updateTime!;

    assert.equal(await generateShipCard(testDb, 'm1'), 'up_to_date');

    const depois = (await testDb.collection('matches').doc('m1').get()).updateTime!;
    assert.equal(depois.isEqual(antes), true, 'a segunda chamada escreveu no documento');
  });

  it('devolve not_found quando o documento sumiu entre o evento e a leitura', async () => {
    assert.equal(await generateShipCard(testDb, 'nunca-existiu'), 'not_found');
  });

  it('devolve unrenderable, sem escrever, quando o documento não tem a forma de uma partida', async () => {
    await testDb.collection('matches').doc('m1').set({ match_id: 'm1', ship_spec_snapshot: {} });

    assert.equal(await generateShipCard(testDb, 'm1'), 'unrenderable');

    const doc = (await testDb.collection('matches').doc('m1').get()).data()!;
    assert.equal(doc.ship_card_svg, undefined);
    assert.equal(doc.ship_card_version, undefined);
  });

  it('uma correção do painel de admin preserva o cartão já gerado', async () => {
    await testDb.collection('matches').doc('m1').set(matchFixture({ match_id: 'm1' }));
    await generateShipCard(testDb, 'm1');
    const cartao = (await testDb.collection('matches').doc('m1').get()).data()!.ship_card_svg;

    await patchMatch(testDb, 'm1', { voided: true, final_score: 42 });

    const doc = (await testDb.collection('matches').doc('m1').get()).data()!;
    assert.equal(doc.voided, true);
    assert.equal(doc.final_score, 42);
    assert.equal(doc.ship_card_svg, cartao, 'a correção apagou o cartão');
    assert.equal(doc.ship_card_version, SHIP_CARD_VERSION);
  });
});
