import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MatchRecord,
  calculateSimilarity,
  isValidFirestoreDocId,
  resolveCompanyFromCatalog,
  validateCallsign
} from '@jogo/shared';

// dist/services/ -> dist/ -> raiz do pacote daemon (mesmo cálculo de SQLiteBufferService.defaultDbPath)
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Catálogo embutido de último recurso: usado só se config/companies.json não existir
// (build antigo, máquina nova) ou BOOTH_COMPANIES_FILE apontar para um caminho ausente.
// A fonte de verdade operacional é o arquivo — ver loadCompanyCatalog.
const BUILTIN_COMPANIES = [
  'Google', 'Google Cloud', 'Android', 'YouTube', 'Alphabet',
  'Itaú', 'Bradesco', 'Nubank', 'Mercado Livre', 'Stone',
  'Globo', 'Embraer', 'Petrobras', 'Ambev', 'Totvs',
  'Votorantim', 'Magazine Luiza', 'iFood', 'QuintoAndar', 'C6 Bank',
  'Accenture', 'Deloitte', 'PwC', 'KPMG', 'CI&T'
];

/**
 * Catálogo de empresas para auto-complete e normalização.
 * Arquivo em vez de literal no código para que a lista do evento possa ser
 * trocada sem rebuild — ver Spec 05 §3.1.
 */
export function loadCompanyCatalog(filePath?: string): string[] {
  const target = filePath
    || process.env.BOOTH_COMPANIES_FILE
    || path.join(packageRoot, '..', '..', 'config', 'companies.json');

  if (!fs.existsSync(target)) {
    console.warn(`[SQLiteBuffer] ${target} não encontrado; usando o catálogo embutido.`);
    return [...BUILTIN_COMPANIES];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (e) {
    // Malformado é diferente de ausente: ausente é uma máquina nova, malformado
    // é alguém que editou e errou. Silenciar o segundo esconde o erro até o evento.
    throw new Error(`[SQLiteBuffer] companies.json inválido em ${target}: ${(e as Error).message}`);
  }
  const list = (parsed as { companies?: unknown }).companies;
  if (!Array.isArray(list) || list.some((c) => typeof c !== 'string')) {
    throw new Error(`[SQLiteBuffer] companies.json em ${target} precisa de um array "companies" de strings.`);
  }
  return list as string[];
}

export interface CompanyMatch {
  raw: string;
  canonical: string;
  confidence: number;
}

/**
 * De onde veio um alias, e portanto quem ganha quando dois discordam.
 *
 * - `local`: resolução desta máquina (catálogo + fuzzy). O palpite mais fraco.
 * - `cloud`: veio de `GET /v1/aliases` — saída do Vertex contra o catálogo curado, e às vezes
 *   uma correção humana feita no painel de admin. Vence o local, e é isso que faz as duas
 *   estações convergirem para a mesma grafia.
 * - `override`: decisão desta máquina que não pode ser desfeita pela nuvem, hoje só o bloqueio
 *   por profanidade. Se a nuvem pudesse vencer aqui, um nome ofensivo voltaria ao telão.
 */
export type AliasSource = 'local' | 'cloud' | 'override';

const ALIAS_SOURCE_RANK: Record<AliasSource, number> = { local: 0, cloud: 1, override: 2 };

/** Resultado de espelhar o catálogo da nuvem no SQLite. Serve ao log e ao `/api/catalog/status`. */
export interface CatalogApplyResult {
  applied: boolean;
  added: string[];
  removed: string[];
  /** Preenchido quando `applied` é falso: por que a aplicação foi RECUSADA. */
  refusedReason?: string;
}

export interface LeaderboardData {
  topPilots: {
    rank: number;
    match_id: string;
    callsign: string;
    company_canonical: string;
    final_score: number;
    created_at: string;
    ship_style_name?: string;
  }[];
  companyRankings: {
    rank: number;
    company_canonical: string;
    total_score: number;
    pilots_count: number;
    top_individual_score: number;
  }[];
  recentMatches: {
    match_id: string;
    callsign: string;
    company_canonical: string;
    final_score: number;
    created_at: string;
  }[];
  stats: {
    total_pilots: number;
    total_matches: number;
    top_score: number;
  };
}

export class SQLiteBufferService {
  private db: Database.Database;

  static defaultDbPath(): string {
    if (process.env.BOOTH_DB_PATH) return path.resolve(process.env.BOOTH_DB_PATH);
    // dist/services/ -> dist/ -> raiz do pacote daemon
    const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    return path.join(packageRoot, 'data', 'booth_buffer.sqlite');
  }

  constructor(dbPath = SQLiteBufferService.defaultDbPath()) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    console.log(`[SQLiteBuffer] Banco local em ${dbPath}`);
    this.initTables();
    this.seedCanonicalCompanies();

    // [D6] Pilotos de demonstração jamais no estande. Só com opt-in explícito.
    if (process.env.BOOTH_SEED_DEMO === '1') {
      console.warn('[SQLiteBuffer] BOOTH_SEED_DEMO=1 — inserindo pilotos fictícios de desenvolvimento.');
      this.seedInitialLeaderboard();
    }
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS canonical_companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        category TEXT DEFAULT 'TECH'
      );

      CREATE TABLE IF NOT EXISTS company_aliases (
        raw_input TEXT PRIMARY KEY,
        canonical_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'local',
        resolved_at TEXT
      );

      -- Chave/valor genérico do estande: cursor do pull de aliases, versão do catálogo
      -- aplicada. Uma tabela genérica em vez de uma por propósito porque o daemon já tem um
      -- SQLite com caminho de migração e um segundo mecanismo de persistência seria mais uma
      -- coisa para o operador ter que lembrar de resetar.
      CREATE TABLE IF NOT EXISTS booth_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS local_matches (
        match_id TEXT PRIMARY KEY,
        pilot_id TEXT NOT NULL,
        callsign TEXT NOT NULL,
        company_canonical TEXT NOT NULL,
        final_score INTEGER NOT NULL,
        telemetry_json TEXT NOT NULL,
        ship_spec_json TEXT NOT NULL,
        synced_to_cloud INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        company_raw TEXT,
        company_confidence REAL,
        score_breakdown_json TEXT,
        needs_company_review INTEGER DEFAULT 0,
        station_id TEXT,
        played_at TEXT
      );
    `);

    this.migrateSchema();
  }

  // Auto-cura para um banco pré-existente criado antes da Tarefa C8: `CREATE TABLE IF
  // NOT EXISTS` acima é um no-op silencioso quando a tabela já existe com o schema
  // antigo, e sem isso todo saveMatch() falharia com "no such column" sem log nenhum
  // no daemon. ALTER TABLE ADD COLUMN é seguro em SQLite para colunas anuláveis: linhas
  // existentes recebem NULL, novas linhas populam normalmente.
  //
  // Toda coluna acrescentada ao `CREATE TABLE` acima precisa aparecer aqui também. Esquecer
  // significa que a máquina do desenvolvedor (banco novo, schema completo) funciona e o Mac do
  // estande (banco com meses de partidas) quebra — a pior forma de descobrir isso é às 9h.
  private migrateSchema(): void {
    this.ensureColumns('local_matches', [
      { name: 'company_raw', ddl: 'TEXT' },
      { name: 'company_confidence', ddl: 'REAL' },
      { name: 'score_breakdown_json', ddl: 'TEXT' },
      { name: 'needs_company_review', ddl: 'INTEGER DEFAULT 0' },
      { name: 'station_id', ddl: 'TEXT' },
      { name: 'played_at', ddl: 'TEXT' }
    ]);

    // `company_aliases` ganhou procedência quando os aliases passaram a vir também da nuvem.
    // Linha antiga fica com `source = 'local'` (o default da coluna), que é exatamente o que
    // ela é: um palpite local. Isso importa para o merge — um alias da nuvem PODE sobrescrever
    // um palpite local, e é essa sobrescrita que faz as duas estações convergirem.
    this.ensureColumns('company_aliases', [
      { name: 'source', ddl: "TEXT NOT NULL DEFAULT 'local'" },
      { name: 'resolved_at', ddl: 'TEXT' }
    ]);
  }

  private ensureColumns(table: string, required: { name: string; ddl: string }[]): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    const existing = new Set(columns.map((c) => c.name));

    for (const col of required) {
      if (!existing.has(col.name)) {
        console.warn(`[SQLiteBuffer] ${table} sem a coluna ${col.name} — adicionando via ALTER TABLE.`);
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col.name} ${col.ddl}`);
      }
    }
  }

  // INSERT OR IGNORE torna isto idempotente entre reinícios. Empresas removidas do
  // arquivo continuam na tabela de propósito — uma empresa que já tem partidas não
  // pode sumir do placar.
  private seedCanonicalCompanies(): void {
    const seeds = loadCompanyCatalog();

    const insert = this.db.prepare('INSERT OR IGNORE INTO canonical_companies (name) VALUES (?)');
    const insertMany = this.db.transaction((names: string[]) => {
      for (const name of names) insert.run(name);
    });
    insertMany(seeds);
  }

  private seedInitialLeaderboard(): void {
    const count = this.db.prepare('SELECT COUNT(*) as c FROM local_matches').get() as { c: number };
    if (count.c > 0) return;

    const dummyMatches = [
      {
        match_id: 'seed_1',
        pilot_id: 'p_1',
        callsign: 'CYBER_ACE',
        company_canonical: 'Google',
        final_score: 48500,
        created_at: new Date(Date.now() - 3600000).toISOString()
      },
      {
        match_id: 'seed_2',
        pilot_id: 'p_2',
        callsign: 'NEO_PILOT',
        company_canonical: 'Nubank',
        final_score: 44200,
        created_at: new Date(Date.now() - 3000000).toISOString()
      },
      {
        match_id: 'seed_3',
        pilot_id: 'p_3',
        callsign: 'QUANTUM_VIPER',
        company_canonical: 'Itaú',
        final_score: 39800,
        created_at: new Date(Date.now() - 2400000).toISOString()
      },
      {
        match_id: 'seed_4',
        pilot_id: 'p_4',
        callsign: 'STAR_STRIKER',
        company_canonical: 'Mercado Livre',
        final_score: 35600,
        created_at: new Date(Date.now() - 1800000).toISOString()
      },
      {
        match_id: 'seed_5',
        pilot_id: 'p_5',
        callsign: 'NEXUS_WING',
        company_canonical: 'Embraer',
        final_score: 31200,
        created_at: new Date(Date.now() - 1200000).toISOString()
      },
      {
        match_id: 'seed_6',
        pilot_id: 'p_6',
        callsign: 'TITAN_SHIELD',
        company_canonical: 'Globo',
        final_score: 28400,
        created_at: new Date(Date.now() - 600000).toISOString()
      }
    ];

    const insert = this.db.prepare(`
      INSERT INTO local_matches (
        match_id, pilot_id, callsign, company_canonical, final_score,
        telemetry_json, ship_spec_json, synced_to_cloud, created_at
      ) VALUES (?, ?, ?, ?, ?, '{}', '{}', 1, ?)
    `);

    for (const m of dummyMatches) {
      insert.run(m.match_id, m.pilot_id, m.callsign, m.company_canonical, m.final_score, m.created_at);
    }
  }

  getCanonicalList(): string[] {
    const stmt = this.db.prepare('SELECT name FROM canonical_companies ORDER BY name ASC');
    return (stmt.all() as { name: string }[]).map((r) => r.name);
  }

  // -------------------------------------------------------------------------
  // booth_metadata — estado do worker de sincronização (Fase 3)
  // -------------------------------------------------------------------------

  getMetadata(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM booth_metadata WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setMetadata(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO booth_metadata (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, value, new Date().toISOString());
  }

  /**
   * Espelha EXATAMENTE o catálogo vindo da nuvem: insere o que falta e remove o que sumiu,
   * numa transação só.
   *
   * Espelhar (em vez de só somar) foi decisão consciente: é o que dá ao painel de admin poder
   * real sobre as duas estações — remover uma empresa digitada errado tem que sumir dos dois
   * Macs, não ficar para sempre no autocomplete de um deles. O preço é que um clique errado no
   * painel degrada as duas estações de uma vez, e é por isso que as travas abaixo existem no
   * CLIENTE, e não só no servidor: o daemon não pode confiar que a validação do outro lado
   * rodou (um `PUT` direto no Firestore, um script, uma versão antiga da API).
   *
   * Trava 1 — **catálogo vazio nunca é aplicado**. Sem catálogo, toda empresa cai no fallback e
   * `company_rankings` racha em uma entrada por grafia digitada.
   * Trava 2 — **remoção em massa é recusada** acima de `maxRemovalRatio` (default 30%), a menos
   * que `allowMassRemoval` esteja ligado. O caso real é banal: um `PUT` com a lista truncada, ou
   * um operador que apagou linhas sem querer, 40 minutos antes de abrir o estande.
   *
   * O que NÃO acontece: remover uma empresa **não** apaga os aliases já aprendidos que apontam
   * para ela. Resoluções passadas seguem estáveis e só as novas caem no fallback — reescrever o
   * histórico no meio do evento seria pior que manter um nome fora do catálogo vivo no cache.
   */
  applyCanonicalCatalog(
    companies: string[],
    opts: { allowMassRemoval?: boolean; maxRemovalRatio?: number; additiveOnly?: boolean } = {}
  ): CatalogApplyResult {
    const desired = [...new Set(companies.filter((c) => typeof c === 'string' && c.trim().length > 0))];

    if (desired.length === 0) {
      return {
        applied: false,
        added: [],
        removed: [],
        refusedReason: 'catálogo vazio — recusado sempre, sem exceção nem env de escape'
      };
    }

    const current = this.getCanonicalList();
    const desiredSet = new Set(desired);
    const currentSet = new Set(current);
    const added = desired.filter((c) => !currentSet.has(c));
    // `additiveOnly` existe para um caso específico: a nuvem respondeu com `version: 0`, isto é,
    // o painel nunca gravou o catálogo e o que veio é a semente de disco do container. Espelhar
    // (remover) contra um fallback não é espelhar a fonte de verdade — seria deixar a imagem do
    // container, congelada no build, apagar empresas cadastradas nesta máquina.
    const removed = opts.additiveOnly ? [] : current.filter((c) => !desiredSet.has(c));

    if (added.length === 0 && removed.length === 0) {
      return { applied: true, added: [], removed: [] };
    }

    const maxRatio = opts.maxRemovalRatio ?? 0.3;
    if (
      !opts.allowMassRemoval &&
      current.length > 0 &&
      removed.length / current.length > maxRatio
    ) {
      return {
        applied: false,
        added: [],
        removed: [],
        refusedReason:
          `remoção em massa recusada: ${removed.length} de ${current.length} empresas sumiriam ` +
          `(acima de ${Math.round(maxRatio * 100)}%). Se for intencional, suba o daemon com ` +
          'BOOTH_CATALOG_ALLOW_MASS_REMOVAL=1.'
      };
    }

    const insert = this.db.prepare('INSERT OR IGNORE INTO canonical_companies (name) VALUES (?)');
    const remove = this.db.prepare('DELETE FROM canonical_companies WHERE name = ?');
    const apply = this.db.transaction(() => {
      for (const name of added) insert.run(name);
      for (const name of removed) remove.run(name);
    });
    apply();

    return { applied: true, added, removed };
  }

  /**
   * Aplica uma página de aliases vinda de `GET /v1/aliases`, um por um, pela precedência de
   * `cacheAlias`. Devolve o que entrou e o que foi descartado, para o worker logar.
   *
   * Confiar MAIS no remoto não é confiar cegamente: o `canonical` da nuvem ainda passa pelo
   * mesmo filtro de ID de documento e de profanidade que o caminho local, porque o telão
   * exibe esse texto e uma correção no painel também é digitada por um humano.
   */
  mergeCloudAliases(aliases: { raw: string; canonical: string; resolved_at: string }[]): {
    applied: number;
    skipped: number;
  } {
    let applied = 0;
    let skipped = 0;

    const run = this.db.transaction(() => {
      for (const a of aliases) {
        const raw = (a?.raw ?? '').trim();
        const canonical = (a?.canonical ?? '').trim();
        if (!raw || !canonical || !isValidFirestoreDocId(canonical)) {
          skipped++;
          continue;
        }
        const check = validateCallsign(canonical);
        if (!check.isValid && check.reasonCode === 'profanity') {
          console.warn(`[SQLiteBuffer] alias da nuvem "${raw}" -> "${canonical}" barrado pelo filtro local.`);
          skipped++;
          continue;
        }
        const resolvedAt = a.resolved_at && !Number.isNaN(Date.parse(a.resolved_at))
          ? new Date(a.resolved_at).toISOString()
          : new Date().toISOString();
        // Só conta o que mudou de verdade: a página sempre repete o alias da fronteira do
        // cursor (ver `cacheAlias`), e contá-lo faria o worker relatar trabalho a cada tick.
        applied += this.cacheAlias(raw, canonical, 'cloud', resolvedAt);
      }
    });
    run();

    return { applied, skipped };
  }

  searchCompanies(query: string): string[] {
    const q = (query || '').trim();
    const catalog = this.getCanonicalList();

    if (!q) {
      return catalog.slice(0, 10);
    }

    // 1. Direct and fuzzy matching ranked by relevance
    const matches: { name: string; score: number }[] = [];
    for (const name of catalog) {
      const lower = name.toLowerCase();
      const qLower = q.toLowerCase();

      if (lower === qLower) {
        matches.push({ name, score: 1.0 });
      } else if (lower.startsWith(qLower)) {
        matches.push({ name, score: 0.9 });
      } else if (lower.includes(qLower)) {
        matches.push({ name, score: 0.75 });
      } else {
        const sim = calculateSimilarity(q, name);
        if (sim >= 0.65) {
          matches.push({ name, score: sim * 0.7 });
        }
      }
    }

    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, 8).map((m) => m.name);
  }

  resolveCompany(rawInput: string): CompanyMatch {
    const raw = (rawInput || '').trim();
    // 'Independente', não 'Google': num evento do Google, o default errado infla
    // o ranking corporativo do próprio anfitrião. Spec 05 §3.1. Confiança 1.0: é um
    // default deliberado para entrada vazia, não uma dúvida a sinalizar.
    if (!raw) return { raw, canonical: 'Independente', confidence: 1.0 };

    // 1. Check cached alias in SQLite. Um hit de cache é, por construção, uma
    // resolução já aceita antes -- confiança 1.0, mesmo que a resolução original
    // (linha abaixo) tenha sido incerta.
    const aliasStmt = this.db.prepare('SELECT canonical_name FROM company_aliases WHERE raw_input = ?');
    const alias = aliasStmt.get(raw.toLowerCase()) as { canonical_name: string } | undefined;
    if (alias) return { raw, canonical: alias.canonical_name, confidence: 1.0 };

    // 2. Proactive multi-layer resolution (exact, suffix stripping, containment, Levenshtein fuzzy)
    const catalog = this.getCanonicalList();
    const resolution = resolveCompanyFromCatalog(raw, catalog);

    // Empresa que casou com o catálogo é confiável por construção: o catálogo é
    // curado. Só o fallback — texto cru do visitante — precisa passar pelo filtro,
    // porque é o único caminho em que texto arbitrário chega ao telão.
    if (resolution.matchedBy === 'fallback') {
      const check = validateCallsign(resolution.canonical);
      if (!check.isValid && check.reasonCode === 'profanity') {
        // 'override', não 'local': este bloqueio precisa VENCER um alias vindo da nuvem.
        // Sem essa precedência, o pull ressuscitaria o nome ofensivo no telão.
        this.cacheAlias(raw, 'Independente', 'override');
        // Override deliberado, não incerteza: confiança 1.0.
        return { raw, canonical: 'Independente', confidence: 1.0 };
      }
    }

    // 3. Cache the resolved alias
    this.cacheAlias(raw, resolution.canonical, 'local');
    return { raw, canonical: resolution.canonical, confidence: resolution.confidence };
  }

  /**
   * Grava um alias respeitando a precedência entre as fontes: `override` > `cloud` > `local`,
   * e entre dois `cloud` ganha o `resolved_at` mais recente.
   *
   * Era um `INSERT OR REPLACE` puro, e isso bastava enquanto a única fonte era esta máquina.
   * Com o pull da nuvem existem três, e as duas escolhas erradas são simétricas: um merge
   * ingênuo ou atropela o bloqueio local de profanidade, ou é atropelado por um palpite fuzzy
   * local que a nuvem já corrigiu contra o catálogo curado.
   *
   * A PK é sempre `raw.toLowerCase()` — o `raw` que vem da nuvem é o `company_raw` digitado
   * pelo visitante, sem lowercase. Normalizar aqui, num lugar só, é o que faz o cache acertar.
   *
   * Devolve quantas linhas mudaram **de verdade** (0 ou 1). Reescrever uma linha idêntica não
   * conta, e essa distinção não é cosmética: `GET /v1/aliases` usa `resolved_at >= since` e
   * devolve o `resolved_at` do último item como próximo cursor, então o alias da fronteira volta
   * em toda página — de propósito, para nunca perder um alias gravado no mesmo milissegundo.
   * Sem esta guarda o worker "aplicava" o mesmo alias a cada tick para sempre: um `UPDATE`
   * inútil no SQLite, `lastPageApplied` preso em 1 no `/api/catalog/status`, e o log do estande
   * com centenas de linhas idênticas onde um pull de verdade deveria se destacar.
   */
  cacheAlias(
    raw: string,
    canonical: string,
    source: AliasSource = 'local',
    resolvedAt: string = new Date().toISOString()
  ): number {
    const stmt = this.db.prepare(`
      INSERT INTO company_aliases (raw_input, canonical_name, created_at, source, resolved_at)
      VALUES (@raw, @canonical, @now, @source, @resolvedAt)
      ON CONFLICT(raw_input) DO UPDATE SET
        canonical_name = excluded.canonical_name,
        created_at = excluded.created_at,
        source = excluded.source,
        resolved_at = excluded.resolved_at
      WHERE (
        @rank > (
          CASE COALESCE(company_aliases.source, 'local')
            WHEN 'override' THEN 2
            WHEN 'cloud' THEN 1
            ELSE 0
          END
        )
        OR (
          @rank = (
            CASE COALESCE(company_aliases.source, 'local')
              WHEN 'override' THEN 2
              WHEN 'cloud' THEN 1
              ELSE 0
            END
          )
          AND (company_aliases.resolved_at IS NULL OR excluded.resolved_at >= company_aliases.resolved_at)
        )
      )
      -- ...E algo precisa mudar de fato. A precedência acima decide QUEM pode escrever; esta
      -- linha decide SE há o que escrever. A coluna created_at fica fora da comparação de
      -- propósito: é a hora da gravação local, sempre diferente, e incluí-la faria toda
      -- reescrita idêntica parecer novidade.
      AND (
        company_aliases.canonical_name <> excluded.canonical_name
        OR COALESCE(company_aliases.source, 'local') <> excluded.source
        OR COALESCE(company_aliases.resolved_at, '') <> excluded.resolved_at
      )
    `);
    return stmt.run({
      raw: raw.toLowerCase(),
      canonical,
      now: new Date().toISOString(),
      source,
      resolvedAt,
      rank: ALIAS_SOURCE_RANK[source]
    }).changes;
  }

  /** Só para teste e diagnóstico: a resolução normal passa por `resolveCompany`. */
  getAlias(raw: string): { canonical: string; source: AliasSource; resolved_at: string | null } | null {
    const row = this.db
      .prepare('SELECT canonical_name, source, resolved_at FROM company_aliases WHERE raw_input = ?')
      .get(raw.toLowerCase()) as
      | { canonical_name: string; source: string | null; resolved_at: string | null }
      | undefined;
    if (!row) return null;
    return {
      canonical: row.canonical_name,
      source: (row.source as AliasSource) ?? 'local',
      resolved_at: row.resolved_at
    };
  }

  saveMatch(match: MatchRecord): void {
    if (!match.telemetry || typeof match.telemetry.enemies_killed !== 'number') {
      throw new Error(`[SQLiteBuffer] Partida ${match.match_id} sem telemetry — recusada. Ver D5.`);
    }
    if (!match.ship_spec_snapshot || !match.ship_spec_snapshot.pilot) {
      throw new Error(`[SQLiteBuffer] Partida ${match.match_id} sem ship_spec_snapshot — recusada. Ver D5.`);
    }
    if (!match.pilot_id) {
      throw new Error(`[SQLiteBuffer] Partida ${match.match_id} sem pilot_id — recusada. Ver D5.`);
    }

    // needs_company_review é derivado aqui, não confiado ao chamador: a fonte de verdade da
    // confiança é o próprio company_confidence gravado, e o limiar (0.80) é o mesmo de
    // resolveCompanyFromCatalog -- um único lugar decide "isso precisa de revisão humana".
    const needsCompanyReview = (match.company_confidence ?? 1.0) < 0.80;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO local_matches (
        match_id, pilot_id, callsign, company_canonical, final_score,
        telemetry_json, ship_spec_json, synced_to_cloud, created_at,
        company_raw, company_confidence, score_breakdown_json, needs_company_review,
        station_id, played_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      match.match_id,
      match.pilot_id,
      match.callsign,
      match.company_canonical,
      match.final_score,
      JSON.stringify(match.telemetry),
      JSON.stringify(match.ship_spec_snapshot),
      match.created_at || new Date().toISOString(),
      match.company_raw ?? null,
      match.company_confidence ?? null,
      match.score_breakdown ? JSON.stringify(match.score_breakdown) : null,
      needsCompanyReview ? 1 : 0,
      match.station_id ?? null,
      match.played_at ?? null
    );
  }

  getLeaderboardData(): LeaderboardData {
    // 1. Top 10 Pilots
    const topPilotsStmt = this.db.prepare(`
      SELECT match_id, callsign, company_canonical, final_score, created_at
      FROM local_matches
      ORDER BY final_score DESC, created_at ASC
      LIMIT 10
    `);
    const rawPilots = topPilotsStmt.all() as any[];
    const topPilots = rawPilots.map((p, idx) => ({
      rank: idx + 1,
      match_id: p.match_id,
      callsign: p.callsign,
      company_canonical: p.company_canonical,
      final_score: p.final_score,
      created_at: p.created_at
    }));

    // 2. Top 5 Companies (Aggregated by sum of scores)
    const companyStmt = this.db.prepare(`
      SELECT 
        company_canonical,
        SUM(final_score) as total_score,
        COUNT(DISTINCT match_id) as pilots_count,
        MAX(final_score) as top_individual_score
      FROM local_matches
      GROUP BY company_canonical
      ORDER BY total_score DESC
      LIMIT 5
    `);
    const rawCompanies = companyStmt.all() as any[];
    const companyRankings = rawCompanies.map((c, idx) => ({
      rank: idx + 1,
      company_canonical: c.company_canonical,
      total_score: c.total_score,
      pilots_count: c.pilots_count,
      top_individual_score: c.top_individual_score
    }));

    // 3. Recent 10 Matches
    const recentStmt = this.db.prepare(`
      SELECT match_id, callsign, company_canonical, final_score, created_at
      FROM local_matches
      ORDER BY created_at DESC
      LIMIT 10
    `);
    const recentMatches = recentStmt.all() as any[];

    // 4. Overall Stats
    const statsStmt = this.db.prepare(`
      SELECT 
        COUNT(DISTINCT callsign) as total_pilots,
        COUNT(*) as total_matches,
        COALESCE(MAX(final_score), 0) as top_score
      FROM local_matches
    `);
    const stats = statsStmt.get() as any;

    return {
      topPilots,
      companyRankings,
      recentMatches,
      stats: {
        total_pilots: stats.total_pilots,
        total_matches: stats.total_matches,
        top_score: stats.top_score
      }
    };
  }

  getPendingMatches(): MatchRecord[] {
    const stmt = this.db.prepare('SELECT * FROM local_matches WHERE synced_to_cloud = 0 LIMIT 50');
    const rows = stmt.all() as any[];

    return rows.map((r) => ({
      match_id: r.match_id,
      pilot_id: r.pilot_id,
      callsign: r.callsign,
      company_canonical: r.company_canonical,
      company_raw: r.company_raw,
      company_confidence: r.company_confidence,
      final_score: r.final_score,
      telemetry: JSON.parse(r.telemetry_json),
      ship_spec_snapshot: JSON.parse(r.ship_spec_json),
      score_breakdown: r.score_breakdown_json ? JSON.parse(r.score_breakdown_json) : undefined,
      needs_company_review: r.needs_company_review === 1,
      created_at: r.created_at,
      // `?? undefined` e não `?? null`: uma partida gravada antes destas colunas existirem tem
      // NULL aqui, e `station_id: null` no JSON enviado à nuvem seria rejeitado pela validação
      // de `ingest.ts` (que aceita ausente, não aceita presente-e-não-string). Omitir é o que
      // mantém as partidas pré-upgrade drenando.
      station_id: r.station_id ?? undefined,
      played_at: r.played_at ?? undefined
    }));
  }

  markMatchSynced(matchId: string): void {
    const stmt = this.db.prepare('UPDATE local_matches SET synced_to_cloud = 1 WHERE match_id = ?');
    stmt.run(matchId);
  }

  // Contagem total, sem o LIMIT 50 de getPendingMatches(): usado por CloudSyncService.status()
  // (Tarefa C5) para reportar o tamanho real da fila, não só o tamanho do próximo lote.
  countPending(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as c FROM local_matches WHERE synced_to_cloud = 0');
    return (stmt.get() as { c: number }).c;
  }

  close(): void {
    this.db.close();
  }
}
