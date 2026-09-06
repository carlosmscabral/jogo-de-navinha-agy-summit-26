/**
 * Testes do provedor de catálogo. Puros: `read`, `now` e `onSeedNeeded` são injetados, então
 * nada aqui precisa do emulador.
 *
 * O que estes testes protegem é uma única propriedade, e ela é operacional, não estética:
 * **`get()` nunca lança e nunca devolve `[]` enquanto houver semente de disco.** Um catálogo
 * vazio chegando à canonicalização significa "nenhum nome pode ser casado" nas duas estações
 * ao mesmo tempo, e o sintoma no telão é a mesma empresa rachada em vários rankings.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCompanyCatalogProvider, DEFAULT_CATALOG_TTL_MS } from './company-catalog.js';
import type { CompanyCatalogDocument } from '@jogo/shared';

const DISK = ['Google', 'Itaú', 'Nubank'];

function doc(companies: string[], version?: number): CompanyCatalogDocument {
  return {
    schema_version: 1,
    companies,
    updated_at: '2026-09-06T12:00:00.000Z',
    ...(version !== undefined ? { version } : {})
  };
}

describe('createCompanyCatalogProvider', () => {
  it('serve o documento do Firestore quando ele existe e não está vazio', async () => {
    const provider = createCompanyCatalogProvider({
      read: async () => doc(['Ambev', 'Vale'], 7),
      diskSeed: DISK
    });

    const snap = await provider.get();
    assert.deepEqual(snap.companies, ['Ambev', 'Vale']);
    assert.equal(snap.version, 7);
    assert.equal(snap.source, 'firestore');
  });

  it('trata documento sem `version` como versão 1, não 0', async () => {
    // 0 é reservado para "o painel nunca gravou". Um documento gravado antes do campo existir
    // é um catálogo real, e devolvê-lo como 0 faria o daemon reaplicar a semente por cima.
    const provider = createCompanyCatalogProvider({ read: async () => doc(['Ambev']), diskSeed: DISK });
    assert.equal((await provider.get()).version, 1);
  });

  it('cai para o disco quando o documento não existe', async () => {
    const provider = createCompanyCatalogProvider({ read: async () => null, diskSeed: DISK });

    const snap = await provider.get();
    assert.deepEqual(snap.companies, DISK);
    assert.equal(snap.version, 0);
    assert.equal(snap.source, 'disk');
  });

  it('cai para o disco quando o documento existe mas está VAZIO', async () => {
    // Este é o resíduo exato do "Salvar" descuidado numa tela que abriu vazia. Servir `[]`
    // como se fosse um catálogo válido propagaria o clique errado para as duas estações.
    const provider = createCompanyCatalogProvider({ read: async () => doc([], 3), diskSeed: DISK });

    const snap = await provider.get();
    assert.deepEqual(snap.companies, DISK);
    assert.equal(snap.source, 'disk');
  });

  it('descarta entradas em branco vindas do documento', async () => {
    const provider = createCompanyCatalogProvider({
      read: async () => doc(['Ambev', '   ', '', 'Vale'], 2),
      diskSeed: DISK
    });
    assert.deepEqual((await provider.get()).companies, ['Ambev', 'Vale']);
  });

  it('avisa uma única vez que a semeadura é necessária, mesmo com vários get()', async () => {
    const seeded: string[][] = [];
    let clock = 0;
    const provider = createCompanyCatalogProvider({
      read: async () => null,
      diskSeed: DISK,
      now: () => clock,
      onSeedNeeded: (seed) => seeded.push(seed)
    });

    await provider.get();
    clock += DEFAULT_CATALOG_TTL_MS * 3;
    await provider.get();
    clock += DEFAULT_CATALOG_TTL_MS * 3;
    await provider.get();

    assert.equal(seeded.length, 1, 'a semeadura não pode ser repedida a cada expiração do TTL');
    assert.deepEqual(seeded[0], DISK);
  });

  it('não chama onSeedNeeded quando o documento tem conteúdo', async () => {
    let calls = 0;
    const provider = createCompanyCatalogProvider({
      read: async () => doc(['Ambev'], 1),
      diskSeed: DISK,
      onSeedNeeded: () => calls++
    });
    await provider.get();
    assert.equal(calls, 0);
  });

  it('não lê de novo dentro do TTL, e relê depois dele', async () => {
    let reads = 0;
    let clock = 1_000;
    const provider = createCompanyCatalogProvider({
      read: async () => {
        reads++;
        return doc([`Empresa ${reads}`], reads);
      },
      diskSeed: DISK,
      ttlMs: 60_000,
      now: () => clock
    });

    assert.deepEqual((await provider.get()).companies, ['Empresa 1']);
    clock += 59_999;
    assert.deepEqual((await provider.get()).companies, ['Empresa 1']);
    assert.equal(reads, 1);

    clock += 2;
    assert.deepEqual((await provider.get()).companies, ['Empresa 2']);
    assert.equal(reads, 2);
  });

  it('invalidate() força a próxima leitura, sem esperar o TTL', async () => {
    let reads = 0;
    const provider = createCompanyCatalogProvider({
      read: async () => {
        reads++;
        return doc([`Empresa ${reads}`], reads);
      },
      diskSeed: DISK,
      now: () => 0
    });

    await provider.get();
    provider.invalidate();
    assert.deepEqual((await provider.get()).companies, ['Empresa 2']);
    assert.equal(reads, 2);
  });

  it('serve o último cache bom, mesmo vencido, quando a leitura falha', async () => {
    let clock = 0;
    let fail = false;
    const provider = createCompanyCatalogProvider({
      read: async () => {
        if (fail) throw new Error('Firestore fora do ar');
        return doc(['Ambev', 'Vale'], 4);
      },
      diskSeed: DISK,
      ttlMs: 1_000,
      now: () => clock
    });

    await provider.get();
    fail = true;
    clock += 10_000; // muito além do TTL: a leitura é tentada e falha

    const snap = await provider.get();
    assert.deepEqual(snap.companies, ['Ambev', 'Vale'], 'obsoleto é melhor que ausente');
    assert.equal(snap.version, 4);
    assert.equal(snap.source, 'stale-cache');
  });

  it('cai para o disco quando a leitura falha e nunca houve cache', async () => {
    const provider = createCompanyCatalogProvider({
      read: async () => {
        throw new Error('Firestore fora do ar');
      },
      diskSeed: DISK
    });

    const snap = await provider.get();
    assert.deepEqual(snap.companies, DISK);
    assert.equal(snap.source, 'disk');
  });

  it('nunca lança e nunca devolve lista vazia, qualquer que seja a resposta do Firestore', async () => {
    // A invariante do módulo, varrida sobre todas as formas de resposta ruim que já vimos.
    const respostas: Array<() => Promise<CompanyCatalogDocument | null>> = [
      async () => null,
      async () => doc([]),
      async () => ({ companies: undefined } as unknown as CompanyCatalogDocument),
      async () => ({ companies: 'Ambev' } as unknown as CompanyCatalogDocument),
      async () => ({ companies: [null, 3, ''] } as unknown as CompanyCatalogDocument),
      async () => {
        throw new Error('boom');
      }
    ];

    for (const read of respostas) {
      const provider = createCompanyCatalogProvider({ read, diskSeed: DISK });
      const snap = await provider.get();
      assert.deepEqual(snap.companies, DISK);
    }
  });

  it('devolve lista vazia — sem lançar — quando nem o Firestore nem o disco têm nada', async () => {
    // O único caso em que `[]` sai daqui, e é honesto: não há de onde tirar nome nenhum.
    const provider = createCompanyCatalogProvider({ read: async () => null, diskSeed: [] });
    const snap = await provider.get();
    assert.deepEqual(snap.companies, []);
    assert.equal(snap.source, 'disk');
  });
});
