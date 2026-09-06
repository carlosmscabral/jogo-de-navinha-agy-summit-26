/**
 * Worker de entrada do estande: puxa da nuvem o catálogo de empresas e os aliases resolvidos.
 *
 * POR QUE EXISTE. Até aqui o daemon só FALAVA com a nuvem (`POST /v1/matches`,
 * `POST /v1/moderate`); nada viajava no sentido contrário. Com um estande só isso passava, porque
 * o `config/companies.json` do disco era, na prática, a fonte de verdade. Com dois estandes
 * contra o mesmo placar deixa de passar: `company_canonical` é o ID do documento em
 * `company_rankings`, então cada Mac casando nomes contra a própria lista racha a mesma empresa
 * em dois rankings. E o pior caso é silencioso — se um Mac tem "Itaú Unibanco" e o outro tem
 * "Itau", os DOIS resolvem com confiança alta, nenhum é marcado com `needs_company_review`, e a
 * varredura de canonicalização na nuvem nunca os enxerga.
 *
 * SÃO DOIS PULLS, e é preciso que sejam os dois. Só aliases não resolve o parágrafo acima: alias
 * só nasce de uma partida que foi marcada para revisão, e a divergência de catálogo justamente
 * nunca é marcada. Só catálogo também não basta: o aprendizado de grafias que a nuvem faz com o
 * Vertex (e as correções humanas do painel) precisa chegar às duas estações.
 *
 * O QUE NÃO MUDA. A decisão no momento da partida continua local e síncrona — `resolveCompany`
 * roda dentro de `POST /api/session/start` e não pode bloquear na rede ali. Isto aqui é
 * "resolvido local, convergido pela nuvem", não "online", e é de propósito: o estande tem que
 * sobreviver a queda de rede. A consequência a aceitar é que existe uma janela em que o telão
 * pode mostrar um rateio antes de convergir.
 *
 * Molde herdado de `CloudSyncService` (`cloud-sync.ts`): `setTimeout` que se reagenda,
 * `backoffMsFor` com teto de 5 min, `auth_failed` fixado no teto sem matar o worker, store
 * injetado para o teste rodar sem SQLite, e `token` como FUNÇÃO pelo motivo documentado lá — uma
 * string capturada no construtor congelaria um token expirado para sempre.
 *
 * Uma diferença deliberada: o primeiro tick usa jitter em vez de disparar em 0. Os dois Macs são
 * ligados pelo mesmo script, na mesma hora, e sem jitter bateriam na API em uníssono para sempre.
 */
import type { CatalogApplyResult } from './sqlite-buffer.js';

/**
 * Estado de cada pull, separadamente. `refused` é exclusivo do catálogo e NÃO é uma falha de
 * transporte: a rede funcionou, o dado chegou, e uma trava local recusou aplicá-lo (lista vazia,
 * remoção em massa). Distinguir importa porque as ações do operador são opostas — `retrying` é
 * esperar, `refused` é ir olhar o que foi salvo no painel.
 */
export type PullState = 'ok' | 'retrying' | 'auth_failed' | 'refused' | 'disabled';

export interface CatalogPullStatus {
  state: PullState;
  lastAttempt: string | null;
  lastSuccess: string | null;
  consecutiveFailures: number;
  lastError: string | null;
  /** Versão do catálogo hoje aplicada nesta máquina. `null` = nenhum pull aplicou nada ainda. */
  appliedVersion: number | null;
  /** Quantas empresas o catálogo local tem agora. */
  companies: number;
  lastApplied: { at: string; added: string[]; removed: string[] } | null;
}

export interface AliasPullStatus {
  state: PullState;
  lastAttempt: string | null;
  lastSuccess: string | null;
  consecutiveFailures: number;
  lastError: string | null;
  /** Cursor ISO do último alias mesclado. `null` = nunca puxou. */
  cursor: string | null;
  lastPageApplied: number;
  lastPageSkipped: number;
}

export interface CatalogSyncStatus {
  catalog: CatalogPullStatus;
  aliases: AliasPullStatus;
}

/**
 * O contrato mínimo com o buffer local — menor que `SQLiteBufferService` de propósito, para os
 * testes deste worker não precisarem de um banco. `SQLiteBufferService` o satisfaz por estrutura.
 */
export interface CatalogSyncStore {
  getMetadata(key: string): string | null;
  setMetadata(key: string, value: string): void;
  getCanonicalList(): string[];
  applyCanonicalCatalog(
    companies: string[],
    opts?: { allowMassRemoval?: boolean; maxRemovalRatio?: number; additiveOnly?: boolean }
  ): CatalogApplyResult;
  mergeCloudAliases(
    aliases: { raw: string; canonical: string; resolved_at: string }[]
  ): { applied: number; skipped: number };
}

export interface CatalogSyncOptions {
  /** `null` = nenhuma nuvem configurada. O worker fica `disabled` e não agenda nada. */
  base: string | null;
  token: string | null | (() => string | null);
  fetchImpl?: typeof fetch;
  jitter?: () => number;
  /** `BOOTH_CATALOG_ALLOW_MASS_REMOVAL=1`. Escape explícito para uma remoção grande intencional. */
  allowMassRemoval?: boolean;
  /** Teto de páginas de alias por tick, para o primeiro boot não travar o laço. */
  maxPagesPerTick?: number;
  aliasPageLimit?: number;
}

/** Chaves em `booth_metadata`. Só este worker escreve nelas; `GET /api/catalog/status` lê. */
export const METADATA_CATALOG_VERSION = 'catalog_version';
export const METADATA_ALIAS_CURSOR = 'alias_cursor';

export class CatalogSyncService {
  static readonly MAX_BACKOFF_MS = 5 * 60_000;
  private static readonly BASE_BACKOFF_MS = 2_000;
  /** 120 s: um alias só nasce depois de uma partida de baixa confiança chegar à nuvem E a
   *  varredura resolvê-la acima de 0,85. Puxar mais rápido que isso é gastar requisição à toa. */
  static readonly DEFAULT_INTERVAL_MS = 120_000;

  private readonly store: CatalogSyncStore;
  private readonly base: string | null;
  private readonly tokenOpt: string | null | (() => string | null);
  private readonly fetchImpl: typeof fetch;
  private readonly jitter: () => number;
  private readonly allowMassRemoval: boolean;
  private readonly maxPagesPerTick: number;
  private readonly aliasPageLimit: number;

  private catalog: CatalogPullStatus;
  private aliases: AliasPullStatus;
  private timer: NodeJS.Timeout | null = null;

  constructor(store: CatalogSyncStore, options: CatalogSyncOptions) {
    this.store = store;
    this.base = options.base;
    this.tokenOpt = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.jitter = options.jitter ?? Math.random;
    this.allowMassRemoval = options.allowMassRemoval ?? false;
    this.maxPagesPerTick = options.maxPagesPerTick ?? 10;
    this.aliasPageLimit = options.aliasPageLimit ?? 500;

    const enabled = Boolean(this.base && this.resolveToken());
    const storedVersion = Number(store.getMetadata(METADATA_CATALOG_VERSION));

    this.catalog = {
      state: enabled ? 'ok' : 'disabled',
      lastAttempt: null,
      lastSuccess: null,
      consecutiveFailures: 0,
      lastError: null,
      appliedVersion: Number.isFinite(storedVersion) && store.getMetadata(METADATA_CATALOG_VERSION) !== null
        ? storedVersion
        : null,
      companies: store.getCanonicalList().length,
      lastApplied: null
    };
    this.aliases = {
      state: enabled ? 'ok' : 'disabled',
      lastAttempt: null,
      lastSuccess: null,
      consecutiveFailures: 0,
      lastError: null,
      cursor: store.getMetadata(METADATA_ALIAS_CURSOR),
      lastPageApplied: 0,
      lastPageSkipped: 0
    };
  }

  private resolveToken(): string | null {
    return typeof this.tokenOpt === 'function' ? this.tokenOpt() : this.tokenOpt;
  }

  /** Idêntico ao de `CloudSyncService`, inclusive o clamp final. Ver o comentário de lá. */
  backoffMsFor(consecutiveFailures: number): number {
    const raw = CatalogSyncService.BASE_BACKOFF_MS * 2 ** Math.min(consecutiveFailures - 1, 10);
    const capped = Math.min(raw, CatalogSyncService.MAX_BACKOFF_MS);
    const jittered = Math.round(capped * (0.8 + this.jitter() * 0.4));
    return Math.min(jittered, CatalogSyncService.MAX_BACKOFF_MS);
  }

  private classify(res: Response | null, error: unknown): 'ok' | 'retrying' | 'auth_failed' {
    if (error) return 'retrying';
    if (res!.status === 401 || res!.status === 403) return 'auth_failed';
    if (res!.ok) return 'ok';
    return 'retrying';
  }

  private async get(path: string): Promise<{ res: Response | null; error: unknown }> {
    const base = this.base!.replace(/\/+$/, '');
    try {
      const res = await this.fetchImpl(`${base}${path}`, {
        headers: { Authorization: `Bearer ${this.resolveToken()}` }
      });
      return { res, error: null };
    } catch (error) {
      return { res: null, error };
    }
  }

  /**
   * Um tick: catálogo e DEPOIS aliases.
   *
   * A ordem importa — um alias cujo canônico não está mais no catálogo precisa ser avaliado
   * contra a lista já atualizada, não contra a anterior. E uma falha em um dos pulls não pode
   * impedir o outro: são dois estados de erro independentes justamente porque as causas são
   * independentes (um catálogo recusado por trava local não diz nada sobre a rede).
   */
  async syncNow(): Promise<CatalogSyncStatus> {
    if (!this.base || !this.resolveToken()) {
      this.catalog.state = 'disabled';
      this.aliases.state = 'disabled';
      return this.status();
    }

    await this.pullCatalog();
    await this.pullAliases();
    return this.status();
  }

  private async pullCatalog(): Promise<void> {
    const now = new Date().toISOString();
    this.catalog.lastAttempt = now;

    const { res, error } = await this.get('/v1/companies');
    const classification = this.classify(res, error);

    if (classification !== 'ok') {
      this.noteFailure(this.catalog, classification, res, error, 'catálogo');
      return;
    }

    let body: { companies?: unknown; version?: unknown };
    try {
      body = (await res!.json()) as { companies?: unknown; version?: unknown };
    } catch (e) {
      this.noteFailure(this.catalog, 'retrying', null, e, 'catálogo', 'resposta');
      return;
    }

    const companies = Array.isArray(body.companies)
      ? body.companies.filter((c): c is string => typeof c === 'string')
      : [];
    const version = typeof body.version === 'number' ? body.version : 0;

    this.catalog.consecutiveFailures = 0;
    this.catalog.lastSuccess = now;
    this.catalog.lastError = null;

    // Só reaplica quando a versão mudou. Mais barato e mais previsível que difar o SQLite a cada
    // tick — e, com dois estandes, evita churn de escrita sem nenhuma mudança real.
    // Exceção: versão 0 (a nuvem está servindo a semente de disco) é sempre reavaliada, porque
    // ali "a versão não mudou" não significa "nada mudou".
    if (version !== 0 && this.catalog.appliedVersion === version) {
      this.catalog.state = 'ok';
      return;
    }

    const result = this.store.applyCanonicalCatalog(companies, {
      allowMassRemoval: this.allowMassRemoval,
      additiveOnly: version === 0
    });

    if (!result.applied) {
      // Transição, não todo tick: isto se repete a cada 2 minutos enquanto o catálogo na nuvem
      // continuar como está, e encher o console esconde o resto.
      if (this.catalog.state !== 'refused') {
        console.error(
          `[CatalogSync] CATÁLOGO RECUSADO (versão ${version}): ${result.refusedReason} ` +
            `O estande continua com as ${this.store.getCanonicalList().length} empresas que já tinha.`
        );
      }
      this.catalog.state = 'refused';
      this.catalog.lastError = result.refusedReason ?? 'recusado';
      return;
    }

    this.catalog.state = 'ok';
    this.catalog.appliedVersion = version;
    this.catalog.companies = this.store.getCanonicalList().length;
    this.store.setMetadata(METADATA_CATALOG_VERSION, String(version));

    if (result.added.length > 0 || result.removed.length > 0) {
      this.catalog.lastApplied = { at: now, added: result.added, removed: result.removed };
      // Nome a nome, de propósito: "3 empresas removidas" não deixa ninguém perceber que a
      // empresa removida era a do visitante que está na fila.
      console.log(
        `[CatalogSync] Catálogo v${version} aplicado — ` +
          `${result.added.length} adicionada(s): [${result.added.join(', ')}]; ` +
          `${result.removed.length} removida(s): [${result.removed.join(', ')}]. ` +
          'Aliases já aprendidos para as removidas continuam resolvendo.'
      );
    }
  }

  private async pullAliases(): Promise<void> {
    const now = new Date().toISOString();
    this.aliases.lastAttempt = now;

    // Primeiro boot puxa desde a epoch, de propósito: começar de "agora" faria uma estação nova
    // ignorar todo o aprendizado anterior, que é exatamente a convergência que queremos.
    let since = this.store.getMetadata(METADATA_ALIAS_CURSOR) ?? new Date(0).toISOString();
    let totalApplied = 0;
    let totalSkipped = 0;

    for (let page = 0; page < this.maxPagesPerTick; page++) {
      const { res, error } = await this.get(
        `/v1/aliases?since=${encodeURIComponent(since)}&limit=${this.aliasPageLimit}`
      );
      const classification = this.classify(res, error);
      if (classification !== 'ok') {
        this.noteFailure(this.aliases, classification, res, error, 'aliases');
        return;
      }

      let body: { aliases?: unknown; next_since?: unknown; has_more?: unknown };
      try {
        body = (await res!.json()) as typeof body;
      } catch (e) {
        this.noteFailure(this.aliases, 'retrying', null, e, 'aliases', 'resposta');
        return;
      }

      const items = Array.isArray(body.aliases)
        ? (body.aliases as { raw: string; canonical: string; resolved_at: string }[])
        : [];
      const merged = this.store.mergeCloudAliases(items);
      totalApplied += merged.applied;
      totalSkipped += merged.skipped;

      const nextSince = typeof body.next_since === 'string' ? body.next_since : since;
      const hasMore = body.has_more === true;

      // Cursor gravado SÓ DEPOIS do merge: se o processo morrer entre as duas coisas, a próxima
      // subida repuxa a página, e repuxar é idempotente. A ordem inversa perderia aliases.
      if (nextSince !== since) {
        this.store.setMetadata(METADATA_ALIAS_CURSOR, nextSince);
        this.aliases.cursor = nextSince;
        since = nextSince;
      } else if (hasMore) {
        // Cursor travado: a página veio cheia e todos os `resolved_at` são iguais ao `since`
        // (vários aliases gravados no mesmo milissegundo). Avançar 1 ms é a única saída, e o
        // custo é perder o que estiver exatamente naquele milissegundo — muito melhor que um
        // laço que nunca termina.
        const bumped = new Date(Date.parse(since) + 1).toISOString();
        console.warn(
          `[CatalogSync] Cursor de aliases travado em ${since} com página cheia — avançando 1ms para ${bumped}.`
        );
        this.store.setMetadata(METADATA_ALIAS_CURSOR, bumped);
        this.aliases.cursor = bumped;
        since = bumped;
      }

      if (!hasMore) break;
    }

    this.aliases.state = 'ok';
    this.aliases.consecutiveFailures = 0;
    this.aliases.lastSuccess = now;
    this.aliases.lastError = null;
    this.aliases.lastPageApplied = totalApplied;
    this.aliases.lastPageSkipped = totalSkipped;

    if (totalApplied > 0 || totalSkipped > 0) {
      console.log(`[CatalogSync] Aliases da nuvem: ${totalApplied} aplicado(s), ${totalSkipped} descartado(s).`);
    }
  }

  private noteFailure(
    target: CatalogPullStatus | AliasPullStatus,
    classification: 'retrying' | 'auth_failed',
    res: Response | null,
    error: unknown,
    label: string,
    // Um corpo ilegível chega aqui pelo mesmo caminho de um socket recusado, mas mandar o
    // operador olhar a rede quando o problema é a resposta desperdiça o único diagnóstico que
    // ele tem no dia. Quem sabe a causa passa o rótulo certo.
    kind: 'rede' | 'resposta' = 'rede'
  ): void {
    const description = error
      ? `erro de ${kind}: ${error instanceof Error ? error.message : String(error)}`
      : `HTTP ${res!.status}`;

    if (classification === 'auth_failed' && target.state !== 'auth_failed') {
      console.warn(
        `[CatalogSync] Pull de ${label} recusado pelo token (401/403) — indo para o teto de ` +
          `${CatalogSyncService.MAX_BACKOFF_MS / 60_000} min até BOOTH_INGEST_TOKEN ser rotacionado. ` +
          'O worker continua vivo: o token pode voltar a valer sem reiniciar o daemon.'
      );
    } else if (classification === 'retrying') {
      console.warn(`[CatalogSync] Pull de ${label} falhou (${description}).`);
    }

    target.state = classification;
    target.consecutiveFailures += 1;
    target.lastError = description;
  }

  status(): CatalogSyncStatus {
    return {
      catalog: { ...this.catalog, companies: this.store.getCanonicalList().length },
      aliases: { ...this.aliases }
    };
  }

  /**
   * Laço auto-reagendado. O atraso do próximo tick olha os DOIS pulls: `auth_failed` em qualquer
   * um vai direto ao teto (o token é o mesmo para os dois), e senão vale o backoff do pull que
   * está pior.
   */
  start(intervalMs = CatalogSyncService.DEFAULT_INTERVAL_MS): void {
    if (this.timer) return;
    if (!this.base || !this.resolveToken()) {
      console.log('[CatalogSync] Sem nuvem configurada — pull de catálogo e aliases desligado.');
      return;
    }

    const tick = (): void => {
      void this.syncNow()
        .catch((e) => {
          // Nada aqui pode virar unhandledRejection: derrubaria o daemon do estande por causa de
          // um pull de segundo plano. Mesmo raciocínio do try/catch de `cloud-sync.ts`.
          console.warn('[CatalogSync] Tick falhou de forma inesperada:', e);
        })
        .finally(() => {
          const failures = Math.max(this.catalog.consecutiveFailures, this.aliases.consecutiveFailures);
          const authFailed = this.catalog.state === 'auth_failed' || this.aliases.state === 'auth_failed';
          const delay = authFailed
            ? CatalogSyncService.MAX_BACKOFF_MS
            : failures > 0
              ? this.backoffMsFor(failures)
              : intervalMs;
          this.timer = setTimeout(tick, delay);
        });
    };

    // Jitter no PRIMEIRO tick, ao contrário de `CloudSyncService`, que dispara em 0: as duas
    // estações são ligadas pelo mesmo script, na mesma hora, e sem isto baterem juntas na API
    // seria o comportamento permanente, não um acaso.
    const firstDelay = Math.round(intervalMs * this.jitter());
    console.log(`[CatalogSync] Primeiro pull em ${Math.round(firstDelay / 1000)}s (jitter), depois a cada ${Math.round(intervalMs / 1000)}s.`);
    this.timer = setTimeout(tick, firstDelay);
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
