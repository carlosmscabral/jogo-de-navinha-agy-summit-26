/**
 * A flag `CARDGEN_ENABLED` é a fronteira de segurança entre os dois serviços que rodam a MESMA
 * imagem: `jogo-navinha-api` (público, `--allow-unauthenticated`) e `jogo-navinha-cardgen`
 * (interno). Uma leitura humana da ordem de registro em `index.ts` não prova nada; este arquivo
 * sobe o `app` de verdade com a flag ligada e bate nele por HTTP para provar que o painel e a
 * ingestão simplesmente NÃO EXISTEM naquele processo.
 *
 * Mesmas armadilhas de `admin-routes.test.ts`: `NODE_ENV=test` antes do import (o módulo derruba
 * o processo sem `GOOGLE_CLOUD_PROJECT` e sobe um `app.listen` fora dessa guarda), e import
 * dinâmico, porque `import` estático é hoisted e rodaria antes das atribuições abaixo.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { SHIP_CARD_VERSION } from '@jogo/shared';

process.env.NODE_ENV = 'test';
process.env.CARDGEN_ENABLED = '1';
// Atribuição, não `||=`: `index.ts` monta seu Firestore com `initializeApp()` sem argumentos, que
// tira o projeto DESTA variável, enquanto `test-helpers.ts` fixa `jogo-navinha-test`. O emulador
// isola um projeto do outro, então uma variável já exportada no shell (um `GOOGLE_CLOUD_PROJECT`
// de trabalho, por exemplo) faria a rota procurar a partida num projeto onde ela não existe — e o
// sintoma seria um 204 "documento não existe", indistinguível de um bug de verdade no cardgen.
process.env.GOOGLE_CLOUD_PROJECT = 'jogo-navinha-test';
process.env.BOOTH_INGEST_TOKEN ||= 'test-booth-token';
process.env.ADMIN_PANEL_PASSWORD ||= 'test-admin-panel-password';
// Mesmo default de test-helpers.ts. Ver o comentário lá sobre a porta 8085 quando a 8080 estiver
// ocupada: `FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npm test`.
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';

const { app } = await import('./index.js');
const { testDb, clearFirestore, matchFixture } = await import('./test-helpers.js');

let baseUrl: string;
let server: import('node:http').Server;

before(async () => {
  await clearFirestore();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

function post(path: string, subject?: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: subject === undefined ? {} : { 'ce-subject': subject }
  });
}

describe('serviço cardgen: superfície exposta', () => {
  it('mantém /v1/health, que é o que o self-test bate antes de haver token', async () => {
    const res = await fetch(`${baseUrl}/v1/health`);
    assert.equal(res.status, 200);
  });

  // 404, e não 401: a rota não está montada. Um 401 significaria que o painel EXISTE neste
  // processo e está apenas atrás de uma senha — que é exatamente o que a flag evita.
  for (const path of ['/v1/matches', '/v1/moderate', '/v1/admin/health', '/v1/admin/matches', '/admin']) {
    it(`não monta ${path} neste processo`, async () => {
      const res = await fetch(`${baseUrl}${path}`, { method: 'POST', redirect: 'manual' });
      assert.equal(res.status, 404, `${path} respondeu ${res.status}`);
    });
  }
});

describe('POST /internal/cardgen', () => {
  it('devolve 204 (permanente, não reentregar) para ce-subject ausente ou malformado', async () => {
    assert.equal((await post('/internal/cardgen')).status, 204);
    assert.equal((await post('/internal/cardgen', 'documents/pilots/x')).status, 204);
  });

  it('devolve 204 quando o documento não existe mais', async () => {
    const res = await post('/internal/cardgen', 'documents/matches/apagada');
    assert.equal(res.status, 204);
  });

  it('gera o cartão na primeira entrega e não reescreve na segunda', async () => {
    await testDb.collection('matches').doc('m-rota').set(matchFixture({ match_id: 'm-rota' }));

    const primeira = await post('/internal/cardgen', 'documents/matches/m-rota');
    assert.equal(primeira.status, 200);
    assert.deepEqual(await primeira.json(), { match_id: 'm-rota', outcome: 'written' });

    const snap = await testDb.collection('matches').doc('m-rota').get();
    assert.equal(snap.data()!.ship_card_version, SHIP_CARD_VERSION);
    assert.match(snap.data()!.ship_card_svg, /^<svg /);

    // Reentrega do mesmo evento: 2xx (senão o Eventarc reentrega para sempre) e documento intacto.
    const segunda = await post('/internal/cardgen', 'documents/matches/m-rota');
    assert.equal(segunda.status, 200);
    assert.deepEqual(await segunda.json(), { match_id: 'm-rota', outcome: 'up_to_date' });

    const depois = await testDb.collection('matches').doc('m-rota').get();
    assert.equal(depois.updateTime!.isEqual(snap.updateTime!), true);
  });
});
