import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  initializeTestEnvironment, assertFails, assertSucceeds, RulesTestEnvironment
} from '@firebase/rules-unit-testing';
import * as fs from 'node:fs';

let env: RulesTestEnvironment;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'jogo-navinha-test',
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 }
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

  it('nega qualquer acesso a coleções não previstas', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(db.collection('segredos').doc('x').get());
  });
});
