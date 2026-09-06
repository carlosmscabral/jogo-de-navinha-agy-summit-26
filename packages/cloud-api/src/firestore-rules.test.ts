import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  initializeTestEnvironment, assertFails, assertSucceeds, RulesTestEnvironment
} from '@firebase/rules-unit-testing';
import * as fs from 'node:fs';

let env: RulesTestEnvironment;

/**
 * Porta do emulador vinda de `FIRESTORE_EMULATOR_HOST` (o mesmo "host:porta" que o Admin SDK já
 * lê sozinho nos outros testes deste pacote), com 8080 — o valor do `firebase.json` — como
 * padrão. Antes isto era `8080` fixo, e era o único arquivo do pacote que não podia rodar numa
 * máquina onde algo já ocupasse a 8080: os demais testes só precisavam da variável de ambiente.
 * Nada muda no Mac, onde a 8080 está livre e a variável nem precisa existir.
 */
function emulatorAddress(): { host: string; port: number } {
  const raw = process.env.FIRESTORE_EMULATOR_HOST;
  if (!raw) return { host: '127.0.0.1', port: 8080 };
  const sep = raw.lastIndexOf(':');
  const port = Number(raw.slice(sep + 1));
  if (sep < 1 || !Number.isInteger(port) || port <= 0) {
    throw new Error(`FIRESTORE_EMULATOR_HOST inválido: "${raw}" — esperado "host:porta".`);
  }
  return { host: raw.slice(0, sep), port };
}

before(async () => {
  const { host, port } = emulatorAddress();
  env = await initializeTestEnvironment({
    projectId: 'jogo-navinha-test',
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8'), host, port }
  });
});

after(async () => { await env.cleanup(); });

describe('firestore.rules', () => {
  it('permite leitura pública do placar', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertSucceeds(db.collection('matches').doc('m1').get());
    await assertSucceeds(db.collection('company_rankings').doc('Google').get());
    await assertSucceeds(db.collection('pilots').doc('p1').get());
  });

  it('permite leitura pública do catálogo de empresas (Tarefa C7)', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertSucceeds(db.collection('companies').doc('catalog').get());
  });

  it('nega escrita de cliente em matches', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(db.collection('matches').doc('m1').set({ final_score: 999999 }));
  });

  it('nega escrita de cliente em company_rankings e pilots', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(db.collection('company_rankings').doc('Google').set({ total_score: 1 }));
    await assertFails(db.collection('pilots').doc('p1').set({ best_score: 1 }));
  });

  it('nega escrita de cliente no catálogo de empresas (Tarefa C7)', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(db.collection('companies').doc('catalog').set({ companies: ['Hackeado'] }));
  });

  it('nega escrita mesmo para um cliente autenticado', async () => {
    const db = env.authenticatedContext('alguem').firestore();
    await assertFails(db.collection('matches').doc('m2').set({ final_score: 1 }));
  });

  it('nega LEITURA do lease de canonicalização, ao contrário das coleções do placar', async () => {
    // `system/` é coordenação interna entre instâncias do Cloud Run. A regra existe declarada
    // (e não só coberta pelo catch-all) para que uma coleção nova entre aqui de propósito — e
    // este caso trava a diferença: as outras quatro coleções são de leitura pública, esta não.
    const db = env.unauthenticatedContext().firestore();
    await assertFails(db.collection('system').doc('canonicalization_lease').get());
    await assertFails(db.collection('system').doc('canonicalization_lease').set({ holder: 'x' }));
  });

  it('nega qualquer acesso a coleções não previstas', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(db.collection('segredos').doc('x').get());
  });
});
