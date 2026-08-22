import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MatchRecord, calculateSimilarity, resolveCompanyFromCatalog, validateCallsign } from '@jogo/shared';

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

// Mensagem exata emitida por validateCallsign (packages/shared/src/utils/moderation.ts)
// quando a reprovação é por palavrão. Não há lá um código de motivo separado (tipo
// 'profanity') — os outros motivos (comprimento, charset, repetição) têm textos próprios,
// então comparar a string isola o caso de palavrão sem duplicar o filtro aqui.
const PROFANITY_REASON = 'Termo impróprio ou não permitido no evento.';

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
        created_at TEXT NOT NULL
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
        created_at TEXT NOT NULL
      );
    `);
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

  resolveCompany(rawInput: string): string {
    const raw = (rawInput || '').trim();
    // 'Independente', não 'Google': num evento do Google, o default errado infla
    // o ranking corporativo do próprio anfitrião. Spec 05 §3.1.
    if (!raw) return 'Independente';

    // 1. Check cached alias in SQLite
    const aliasStmt = this.db.prepare('SELECT canonical_name FROM company_aliases WHERE raw_input = ?');
    const alias = aliasStmt.get(raw.toLowerCase()) as { canonical_name: string } | undefined;
    if (alias) return alias.canonical_name;

    // 2. Proactive multi-layer resolution (exact, suffix stripping, containment, Levenshtein fuzzy)
    const catalog = this.getCanonicalList();
    const resolution = resolveCompanyFromCatalog(raw, catalog);

    // Empresa que casou com o catálogo é confiável por construção: o catálogo é
    // curado. Só o fallback — texto cru do visitante — precisa passar pelo filtro,
    // porque é o único caminho em que texto arbitrário chega ao telão.
    if (resolution.matchedBy === 'fallback') {
      const check = validateCallsign(resolution.canonical);
      if (!check.isValid && check.reason === PROFANITY_REASON) {
        this.cacheAlias(raw, 'Independente');
        return 'Independente';
      }
    }

    // 3. Cache the resolved alias
    this.cacheAlias(raw, resolution.canonical);
    return resolution.canonical;
  }

  private cacheAlias(raw: string, canonical: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO company_aliases (raw_input, canonical_name, created_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(raw.toLowerCase(), canonical, new Date().toISOString());
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

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO local_matches (
        match_id, pilot_id, callsign, company_canonical, final_score,
        telemetry_json, ship_spec_json, synced_to_cloud, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
    `);

    stmt.run(
      match.match_id,
      match.pilot_id,
      match.callsign,
      match.company_canonical,
      match.final_score,
      JSON.stringify(match.telemetry),
      JSON.stringify(match.ship_spec_snapshot),
      match.created_at || new Date().toISOString()
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
      final_score: r.final_score,
      telemetry: JSON.parse(r.telemetry_json),
      ship_spec_snapshot: JSON.parse(r.ship_spec_json),
      created_at: r.created_at
    }));
  }

  markMatchSynced(matchId: string): void {
    const stmt = this.db.prepare('UPDATE local_matches SET synced_to_cloud = 1 WHERE match_id = ?');
    stmt.run(matchId);
  }

  close(): void {
    this.db.close();
  }
}
