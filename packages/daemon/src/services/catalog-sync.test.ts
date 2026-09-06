import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CatalogSyncService,
  METADATA_ALIAS_CURSOR,
  METADATA_CATALOG_VERSION,
  type CatalogSyncStore
} from './catalog-sync.js';
import type { CatalogApplyResult } from './sqlite-buffer.js';

/**
 * Duplo de `CatalogSyncStore` com a mesma semântica do SQLite real, resumida ao que este worker
 * enxerga: `applyCanonicalCatalog` espelha a lista (adiciona e remove), `mergeCloudAliases` só
 * conta, e os metadados são um mapa. Registra as chamadas porque metade dos testes daqui é sobre
 * QUANDO o worker chama o store, não sobre o que o store faz — isso é assunto de
 * `sqlite-buffer.test.ts`.
 */
function fakeStore(initial: string[] = []): CatalogSyncStore & {
  companies: string[];
  metadata: Map<string, string>;
  applyCalls: { companies: string[]; additiveOnly?: boolean; allowMassRemoval?: boolean }[];
  mergedAliases: { raw: string; canonical: string; resolved_at: string }[];
  refuseNext: string | null;
} {
  const store = {
    companies: [...initial],
    metadata: new Map<string, string>(),
    applyCalls: [] as { companies: string[]; additiveOnly?: boolean; allowMassRemoval?: boolean }[],
    mergedAliases: [] as { raw: string; canonical: string; resolved_at: string }[],
    refuseNext: null as string | null,

    getMetadata(key: string): string | null {
      return store.metadata.get(key) ?? null;
    },
    setMetadata(key: string, value: string): void {
      store.metadata.set(key, value);
    },
    getCanonicalList(): string[] {
      return [...store.companies];
    },
    applyCanonicalCatalog(
      companies: string[],
      opts: { allowMassRemoval?: boolean; maxRemovalRatio?: number; additiveOnly?: boolean } = {}
    ): CatalogApplyResult {
      store.applyCalls.push({ companies: [...companies], ...opts });
      if (store.refuseNext) {
        return { applied: false, added: [], removed: [], refusedReason: store.refuseNext };
      }
      const added = companies.filter((c) => !store.companies.includes(c));
      const removed = opts.additiveOnly ? [] : store.companies.filter((c) => !companies.includes(c));
      store.companies = opts.additiveOnly ? [...store.companies, ...added] : [...companies];
      return { applied: true, added, removed };
    },
    mergeCloudAliases(
      aliases: { raw: string; canonical: string; resolved_at: string }[]
    ): { applied: number; skipped: number } {
      store.mergedAliases.push(...aliases);
      return { applied: aliases.length, skipped: 0 };
    }
  };
  return store;
}

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

/** Roteador de `fetch` por caminho, para os dois pulls de um tick serem servidos separadamente. */
function routes(handlers: {
  companies?: (url: URL) => Response | Promise<Response> | never;
  aliases?: (url: URL) => Response | Promise<Response> | never;
}): { impl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const raw = typeof input === 'string' ? input : input.toString();
    urls.push(raw);
    const url = new URL(raw);
    if (url.pathname === '/v1/companies') {
      if (!handlers.companies) return new Response('', { status: 500 });
      return handlers.companies(url);
    }
    if (url.pathname === '/v1/aliases') {
      if (!handlers.aliases) return new Response('', { status: 500 });
      return handlers.aliases(url);
    }
    throw new Error(`rota inesperada: ${url.pathname}`);
  }) as unknown as typeof fetch;
  return { impl, urls };
}

const BASE = { base: 'https://api', token: 't' } as const;

describe('CatalogSyncService — pull de catálogo', () => {
  it('aplica o catálogo da nuvem espelhando adições e remoções', async () => {
    const store = fakeStore(['Google', 'Empresa Que Saiu']);
    const { impl } = routes({
      companies: () => okJson({ companies: ['Google', 'Nubank'], version: 3 }),
      aliases: () => okJson({ aliases: [], next_since: '1970-01-01T00:00:00.000Z', has_more: false })
    });
    const sync = new CatalogSyncService(store, { ...BASE, fetchImpl: impl });

    const status = await sync.syncNow();

    assert.deepEqual(store.companies, ['Google', 'Nubank']);
    assert.equal(status.catalog.state, 'ok');
    assert.equal(status.catalog.appliedVersion, 3);
    assert.deepEqual(status.catalog.lastApplied?.added, ['Nubank']);
    assert.deepEqual(status.catalog.lastApplied?.removed, ['Empresa Que Saiu']);
    assert.equal(store.metadata.get(METADATA_CATALOG_VERSION), '3');
  });

  it('não reaplica o catálogo quando a versão não mudou', async () => {
    const store = fakeStore(['Google']);
    const { impl } = routes({
      companies: () => okJson({ companies: ['Google', 'Nubank'], version: 7 }),
      aliases: () => okJson({ aliases: [], next_since: '1970-01-01T00:00:00.000Z', has_more: false })
    });
    const sync = new CatalogSyncService(store, { ...BASE, fetchImpl: impl });

    await sync.syncNow();
    await sync.syncNow();
    await sync.syncNow();

    assert.equal(store.applyCalls.length, 1, 'três ticks, uma aplicação só — o resto é ruído de escrita');
  });

  it('reavalia sempre quando a nuvem responde version 0, e nesse caso só adiciona', async () => {
    // version 0 = o documento do Firestore está ausente/vazio e a cloud-api está servindo a
    // PRÓPRIA semente de disco, congelada na imagem do container. Espelhar remoções contra isso
    // deixaria a imagem apagar empresas cadastradas neste Mac.
    const store = fakeStore(['Cadastrada No Mac']);
    const { impl } = routes({
      companies: () => okJson({ companies: ['Google'], version: 0 }),
      aliases: () => okJson({ aliases: [], next_since: '1970-01-01T00:00:00.000Z', has_more: false })
    });
    const sync = new CatalogSyncService(store, { ...BASE, fetchImpl: impl });

    await sync.syncNow();
    await sync.syncNow();

    assert.equal(store.applyCalls.length, 2, 'version 0 não é uma versão: "não mudou" não quer dizer nada');
    assert.equal(store.applyCalls[0].additiveOnly, true);
    assert.ok(store.companies.includes('Cadastrada No Mac'), 'a semente da nuvem não pode podar o Mac');
    assert.ok(store.companies.includes('Google'));
  });

  it('repassa allowMassRemoval para o store e marca refused quando a trava local recusa', async () => {
    const store = fakeStore(['Google', 'Nubank', 'Itau']);
    store.refuseNext = 'remoção em massa (3 de 3)';
    const { impl } = routes({
      companies: () => okJson({ companies: [], version: 9 }),
      aliases: () => okJson({ aliases: [], next_since: '1970-01-01T00:00:00.000Z', has_more: false })
    });
    const sync = new CatalogSyncService(store, { ...BASE, fetchImpl: impl, allowMassRemoval: true });

    const status = await sync.syncNow();

    assert.equal(store.applyCalls[0].allowMassRemoval, true, 'a env de escape precisa chegar ao store');
    assert.equal(status.catalog.state, 'refused');
    assert.match(status.catalog.lastError ?? '', /remoção em massa/);
    assert.equal(status.catalog.appliedVersion, null, 'recusa não pode gravar a versão como aplicada');
    assert.equal(store.metadata.get(METADATA_CATALOG_VERSION), undefined);
    assert.deepEqual(store.companies, ['Google', 'Nubank', 'Itau'], 'o estande fica com o que já tinha');
    assert.equal(status.aliases.state, 'ok', 'catálogo recusado não pode impedir o pull de aliases');
  });

  it('tenta de novo depois de uma recusa, e sai de refused quando a nuvem se corrige', async () => {
    const store = fakeStore(['Google']);
    store.refuseNext = 'catálogo vazio';
    let companies: string[] = [];
    const { impl } = routes({
      companies: () => okJson({ companies, version: 4 }),
      aliases: () => okJson({ aliases: [], next_since: '1970-01-01T00:00:00.000Z', has_more: false })
    });
    const sync = new CatalogSyncService(store, { ...BASE, fetchImpl: impl });

    assert.equal((await sync.syncNow()).catalog.state, 'refused');

    store.refuseNext = null;
    companies = ['Google', 'Nubank'];
    const status = await sync.syncNow();

    assert.equal(status.catalog.state, 'ok');
    assert.equal(status.catalog.appliedVersion, 4);
  });
});

describe('CatalogSyncService — pull de aliases', () => {
  it('parte da epoch no primeiro boot e grava o cursor devolvido pelo servidor', async () => {
    const store = fakeStore();
    const { impl, urls } = routes({
      companies: () => okJson({ companies: ['Google'], version: 1 }),
      aliases: () =>
        okJson({
          aliases: [{ raw: 'gogle', canonical: 'Google', resolved_at: '2026-09-01T10:00:00.000Z' }],
          next_since: '2026-09-01T10:00:00.000Z',
          has_more: false
        })
    });
    const sync = new CatalogSyncService(store, { ...BASE, fetchImpl: impl });

    const status = await sync.syncNow();

    const aliasUrl = urls.find((u) => u.includes('/v1/aliases'))!;
    assert.ok(aliasUrl.includes(encodeURIComponent('1970-01-01T00:00:00.000Z')), 'primeiro boot puxa tudo');
    assert.equal(store.metadata.get(METADATA_ALIAS_CURSOR), '2026-09-01T10:00:00.000Z');
    assert.equal(status.aliases.cursor, '2026-09-01T10:00:00.000Z');
    assert.equal(store.mergedAliases.length, 1);
  });

  it('pagina até has_more falso, avançando o cursor a cada página', async () => {
    const store = fakeStore();
    const pages = [
      { aliases: [{ raw: 'a', canonical: 'A', resolved_at: '2026-09-01T00:00:01.000Z' }], next_since: '2026-09-01T00:00:01.000Z', has_more: true },
      { aliases: [{ raw: 'b', canonical: 'B', resolved_at: '2026-09-01T00:00:02.000Z' }], next_since: '2026-09-01T00:00:02.000Z', has_more: true },
      { aliases: [{ raw: 'c', canonical: 'C', resolved_at: '2026-09-01T00:00:03.000Z' }], next_since: '2026-09-01T00:00:03.000Z', has_more: false }
    ];
    let page = 0;
    const { impl } = routes({
      companies: () => okJson({ companies: ['A'], version: 1 }),
      aliases: () => okJson(pages[page++])
    });
    const sync = new CatalogSyncService(store, { ...BASE, fetchImpl: impl });

    await sync.syncNow();

    assert.deepEqual(store.mergedAliases.map((a) => a.raw), ['a', 'b', 'c']);
    assert.equal(store.metadata.get(METADATA_ALIAS_CURSOR), '2026-09-01T00:00:03.000Z');
  });

  it('avança 1 ms quando o cursor trava com página cheia, em vez de girar para sempre', async () => {
    const store = fakeStore();
    const seen: string[] = [];
    const { impl } = routes({
      companies: () => okJson({ companies: ['A'], version: 1 }),
      aliases: (url) => {
        const since = url.searchParams.get('since')!;
        seen.push(since);
        // Todos os aliases no MESMO milissegundo: o servidor devolve o próprio `since` como
        // `next_since` e diz que ainda há mais. Sem o bump, isto é um laço infinito.
        return okJson({
          aliases: [{ raw: 'x', canonical: 'X', resolved_at: since }],
          next_since: since,
          has_more: true
        });
      }
    });
    const sync = new CatalogSyncService(store, { ...BASE, fetchImpl: impl, maxPagesPerTick: 3 });

    await sync.syncNow();

    assert.equal(seen.length, 3, 'o teto de páginas por tick tem que cortar o laço');
    assert.notEqual(seen[0], seen[1], 'o cursor precisa ter avançado entre as páginas');
    assert.equal(Date.parse(seen[1]) - Date.parse(seen[0]), 1);
  });

  it('não avança o cursor quando a página falha', async () => {
    const store = fakeStore();
    store.metadata.set(METADATA_ALIAS_CURSOR, '2026-09-01T10:00:00.000Z');
    const { impl } = routes({
      companies: () => okJson({ companies: ['A'], version: 1 }),
      aliases: () => {
        throw new Error('ECONNREFUSED');
      }
    });
    const sync = new CatalogSyncService(store, { ...BASE, fetchImpl: impl });

    const status = await sync.syncNow();

    assert.equal(status.aliases.state, 'retrying');
    assert.equal(store.metadata.get(METADATA_ALIAS_CURSOR), '2026-09-01T10:00:00.000Z', 'cursor intacto');
    assert.equal(store.mergedAliases.length, 0);
    assert.equal(status.catalog.state, 'ok', 'falha de aliases não contamina o catálogo');
  });

  it('interrompe a paginação na primeira página que falha, mantendo o cursor da última que commitou', async () => {
    const store = fakeStore();
    let page = 0;
    const { impl } = routes({
      companies: () => okJson({ companies: ['A'], version: 1 }),
      aliases: () => {
        page++;
        if (page === 1) {
          return okJson({
            aliases: [{ raw: 'a', canonical: 'A', resolved_at: '2026-09-01T00:00:01.000Z' }],
            next_since: '2026-09-01T00:00:01.000Z',
            has_more: true
          });
        }
        return new Response('', { status: 503 });
      }
    });
    const sync = new CatalogSyncService(store, { ...BASE, fetchImpl: impl });

    const status = await sync.syncNow();

    assert.equal(status.aliases.state, 'retrying');
    assert.equal(store.metadata.get(METADATA_ALIAS_CURSOR), '2026-09-01T00:00:01.000Z');
    assert.deepEqual(store.mergedAliases.map((a) => a.raw), ['a'], 'a página boa não é perdida');
  });
});

describe('CatalogSyncService — ordem, transporte e ciclo de vida', () => {
  it('puxa o catálogo ANTES dos aliases', async () => {
    // Ordem deliberada: um alias cujo canônico saiu do catálogo precisa ser avaliado contra a
    // lista já atualizada.
    const store = fakeStore();
    const { impl, urls } = routes({
      companies: () => okJson({ companies: ['A'], version: 1 }),
      aliases: () => okJson({ aliases: [], next_since: '1970-01-01T00:00:00.000Z', has_more: false })
    });
    const sync = new CatalogSyncService(store, { ...BASE, fetchImpl: impl });

    await sync.syncNow();

    assert.ok(urls[0].includes('/v1/companies'), `primeira chamada foi ${urls[0]}`);
    assert.ok(urls[1].includes('/v1/aliases'));
  });

  it('marca auth_failed em 401 sem matar o worker, e volta a ok quando o token passa a valer', async () => {
    const store = fakeStore(['Google']);
    let token = 'errado';
    const { impl } = routes({
      companies: () => (token === 'certo' ? okJson({ companies: ['Google'], version: 2 }) : new Response('', { status: 401 })),
      aliases: () =>
        token === 'certo'
          ? okJson({ aliases: [], next_since: '1970-01-01T00:00:00.000Z', has_more: false })
          : new Response('', { status: 403 })
    });
    const sync = new CatalogSyncService(store, { base: 'https://api', token: () => token, fetchImpl: impl });

    let status = await sync.syncNow();
    assert.equal(status.catalog.state, 'auth_failed');
    assert.equal(status.aliases.state, 'auth_failed');

    token = 'certo';
    status = await sync.syncNow();
    assert.equal(status.catalog.state, 'ok', 'o token é resolvido por chamada, não congelado no construtor');
    assert.equal(status.aliases.state, 'ok');
  });

  it('vai ao teto de backoff em auth_failed e escala nas falhas comuns', () => {
    const store = fakeStore();
    const sync = new CatalogSyncService(store, { ...BASE, jitter: () => 0.5 });

    assert.equal(sync.backoffMsFor(1), 2_000);
    assert.equal(sync.backoffMsFor(2), 4_000);
    assert.ok(sync.backoffMsFor(20) <= CatalogSyncService.MAX_BACKOFF_MS, 'nunca passa do teto');
  });

  it('fica disabled sem nuvem configurada e não chama fetch', async () => {
    const store = fakeStore(['Google']);
    let called = 0;
    const impl = (async () => {
      called++;
      return okJson({});
    }) as unknown as typeof fetch;
    const sync = new CatalogSyncService(store, { base: null, token: null, fetchImpl: impl });

    const status = await sync.syncNow();

    assert.equal(status.catalog.state, 'disabled');
    assert.equal(status.aliases.state, 'disabled');
    assert.equal(called, 0);
    sync.start(1);
    sync.stop();
  });

  it('agenda o primeiro tick com jitter, não em zero, para os dois Macs não baterem juntos', () => {
    const store = fakeStore();
    const sync = new CatalogSyncService(store, { ...BASE, jitter: () => 0.75 });
    const agendados: number[] = [];
    const realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((_fn: () => void, delay?: number) => {
      agendados.push(delay ?? 0);
      return 0 as unknown as NodeJS.Timeout;
    }) as typeof globalThis.setTimeout;
    try {
      sync.start(120_000);
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }

    assert.deepEqual(agendados, [90_000], '120s * 0.75 — e, acima de tudo, não 0');
  });

  it('recupera a versão e o cursor gravados por uma execução anterior', () => {
    const store = fakeStore(['Google', 'Nubank']);
    store.metadata.set(METADATA_CATALOG_VERSION, '12');
    store.metadata.set(METADATA_ALIAS_CURSOR, '2026-09-01T10:00:00.000Z');
    const sync = new CatalogSyncService(store, BASE);

    const status = sync.status();

    assert.equal(status.catalog.appliedVersion, 12, 'reiniciar o daemon não pode reaplicar tudo do zero');
    assert.equal(status.catalog.companies, 2);
    assert.equal(status.aliases.cursor, '2026-09-01T10:00:00.000Z');
  });

  it('trata corpo ilegível como falha de transporte, sem aplicar nada', async () => {
    const store = fakeStore(['Google']);
    const { impl } = routes({
      companies: () => new Response('isto não é json', { status: 200, headers: { 'content-type': 'application/json' } }),
      aliases: () => okJson({ aliases: [], next_since: '1970-01-01T00:00:00.000Z', has_more: false })
    });
    const sync = new CatalogSyncService(store, { ...BASE, fetchImpl: impl });

    const status = await sync.syncNow();

    assert.equal(status.catalog.state, 'retrying');
    assert.equal(store.applyCalls.length, 0);
    assert.deepEqual(store.companies, ['Google']);
  });
});
