/**
 * Lease da varredura de canonicalização (`lease.ts`).
 *
 * Roda contra o emulador porque o valor inteiro do lease está na transação: um teste com um
 * Firestore falso provaria que a função escreve o documento certo e não provaria a única coisa
 * que importa, que é duas instâncias chegando juntas.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  acquireLease,
  releaseLease,
  withLease,
  CANONICALIZATION_LEASE_DOC,
  LEASE_COLLECTION,
  DEFAULT_LEASE_TTL_MS,
  type LeaseDocument
} from './lease.js';
import { testDb, clearFirestore } from './test-helpers.js';

function leaseDoc() {
  return testDb.collection(LEASE_COLLECTION).doc(CANONICALIZATION_LEASE_DOC);
}

async function readLease(): Promise<LeaseDocument | null> {
  const snap = await leaseDoc().get();
  return snap.exists ? (snap.data() as LeaseDocument) : null;
}

describe('lease de canonicalização', () => {
  beforeEach(async () => {
    await clearFirestore();
  });

  it('o primeiro a chegar toma o lease e o segundo é recusado', async () => {
    assert.equal(await acquireLease(testDb, { holderId: 'A' }), true);
    assert.equal(await acquireLease(testDb, { holderId: 'B' }), false);

    const doc = await readLease();
    assert.equal(doc?.holder, 'A');
  });

  it('duas aquisições concorrentes produzem exatamente um vencedor', async () => {
    // O caso que motiva a transação. Sem ela, as duas leriam "não existe" e as duas gravariam.
    const results = await Promise.all([
      acquireLease(testDb, { holderId: 'A' }),
      acquireLease(testDb, { holderId: 'B' })
    ]);
    assert.equal(results.filter(Boolean).length, 1, 'os dois se declararam donos do lease');
  });

  it('um lease vencido é readquirido por outra instância', async () => {
    // O crash que um booleano `running` não sobreviveria: a instância A morre com o lease na
    // mão e nunca libera. O TTL é o que devolve a canonicalização ao evento.
    const t0 = 1_000_000;
    await acquireLease(testDb, { holderId: 'A', now: () => t0, ttlMs: 60_000 });

    assert.equal(await acquireLease(testDb, { holderId: 'B', now: () => t0 + 59_999 }), false);
    assert.equal(await acquireLease(testDb, { holderId: 'B', now: () => t0 + 60_001 }), true);
    assert.equal((await readLease())?.holder, 'B');
  });

  it('o mesmo dono readquire e renova a validade mesmo dentro do TTL', async () => {
    const t0 = 1_000_000;
    await acquireLease(testDb, { holderId: 'A', now: () => t0, ttlMs: 60_000 });
    assert.equal(await acquireLease(testDb, { holderId: 'A', now: () => t0 + 30_000, ttlMs: 60_000 }), true);

    const doc = await readLease();
    assert.equal(doc?.expires_at, new Date(t0 + 90_000).toISOString());
  });

  it('um expires_at ilegível é tratado como vencido, não como válido para sempre', async () => {
    await leaseDoc().set({ holder: 'fantasma', acquired_at: 'nada', expires_at: 'nada' });
    assert.equal(await acquireLease(testDb, { holderId: 'A' }), true);
  });

  it('o TTL default é gravado quando nenhum é passado', async () => {
    const t0 = 1_000_000;
    await acquireLease(testDb, { holderId: 'A', now: () => t0 });
    const doc = await readLease();
    assert.equal(doc?.expires_at, new Date(t0 + DEFAULT_LEASE_TTL_MS).toISOString());
  });

  it('releaseLease apaga o lease do próprio dono', async () => {
    await acquireLease(testDb, { holderId: 'A' });
    await releaseLease(testDb, { holderId: 'A' });
    assert.equal(await readLease(), null);
  });

  it('releaseLease NÃO apaga o lease de outra instância', async () => {
    // A instância lenta que só termina depois do TTL. Se ela apagasse o lease de quem tomou o
    // lugar dela, uma terceira varredura entraria no meio — o oposto do objetivo.
    await acquireLease(testDb, { holderId: 'B' });
    await releaseLease(testDb, { holderId: 'A' });
    assert.equal((await readLease())?.holder, 'B');
  });

  it('releaseLease num lease inexistente não lança', async () => {
    await releaseLease(testDb, { holderId: 'A' });
    assert.equal(await readLease(), null);
  });

  it('withLease roda a função e devolve o lease no fim', async () => {
    let rodou = 0;
    const out = await withLease(testDb, async () => { rodou += 1; return 'pronto'; }, { holderId: 'A' });

    assert.equal(out, 'pronto');
    assert.equal(rodou, 1);
    assert.equal(await readLease(), null, 'o lease ficou preso depois do sucesso');
  });

  it('withLease devolve null e NÃO roda a função quando outra instância está varrendo', async () => {
    await acquireLease(testDb, { holderId: 'B' });

    let rodou = 0;
    const out = await withLease(testDb, async () => { rodou += 1; }, { holderId: 'A' });

    assert.equal(out, null);
    assert.equal(rodou, 0);
    assert.equal((await readLease())?.holder, 'B', 'o lease alheio foi mexido');
  });

  it('withLease libera o lease mesmo quando a varredura lança', async () => {
    // Sem o `finally`, uma falha do Vertex prenderia a canonicalização pelo TTL inteiro.
    await assert.rejects(
      withLease(testDb, async () => { throw new Error('vertex caiu'); }, { holderId: 'A' }),
      /vertex caiu/
    );
    assert.equal(await readLease(), null);
  });
});
