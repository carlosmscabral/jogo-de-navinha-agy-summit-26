import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MatchRecord } from '@jogo/shared';

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

  constructor(dbPath = './booth_local.sqlite') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.initTables();
    this.seedCanonicalCompanies();
    this.seedInitialLeaderboard();
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

  private seedCanonicalCompanies(): void {
    const seeds = [
      'Google', 'Google Cloud', 'Android', 'YouTube', 'Alphabet',
      'Itaú', 'Bradesco', 'Nubank', 'Mercado Livre', 'Stone',
      'Globo', 'Embraer', 'Petrobras', 'Ambev', 'Totvs',
      'Votorantim', 'Magazine Luiza', 'iFood', 'QuintoAndar', 'C6 Bank',
      'Accenture', 'Deloitte', 'PwC', 'KPMG', 'CI&T'
    ];

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

  searchCompanies(query: string): string[] {
    if (!query || query.trim().length === 0) {
      const stmt = this.db.prepare('SELECT name FROM canonical_companies ORDER BY name ASC LIMIT 10');
      return (stmt.all() as { name: string }[]).map((r) => r.name);
    }

    const stmt = this.db.prepare(`
      SELECT name FROM canonical_companies 
      WHERE name LIKE ? 
      ORDER BY 
        CASE WHEN name LIKE ? THEN 1 ELSE 2 END,
        name ASC 
      LIMIT 8
    `);
    const q = query.trim();
    const rows = stmt.all(`${q}%`, `%${q}%`) as { name: string }[];
    return rows.map((r) => r.name);
  }

  resolveCompany(rawInput: string): string {
    const raw = rawInput.trim();
    if (!raw) return 'Google';

    // 1. Exact or alias match
    const aliasStmt = this.db.prepare('SELECT canonical_name FROM company_aliases WHERE raw_input = ?');
    const alias = aliasStmt.get(raw.toLowerCase()) as { canonical_name: string } | undefined;
    if (alias) return alias.canonical_name;

    // 2. Exact match in canonical
    const exactStmt = this.db.prepare('SELECT name FROM canonical_companies WHERE LOWER(name) = ?');
    const exact = exactStmt.get(raw.toLowerCase()) as { name: string } | undefined;
    if (exact) {
      this.cacheAlias(raw, exact.name);
      return exact.name;
    }

    // 3. Fallback to raw formatted capitalized
    const formatted = raw.charAt(0).toUpperCase() + raw.slice(1);
    this.cacheAlias(raw, formatted);
    return formatted;
  }

  private cacheAlias(raw: string, canonical: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO company_aliases (raw_input, canonical_name, created_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(raw.toLowerCase(), canonical, new Date().toISOString());
  }

  saveMatch(match: MatchRecord): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO local_matches (
        match_id, pilot_id, callsign, company_canonical, final_score,
        telemetry_json, ship_spec_json, synced_to_cloud, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
    `);

    stmt.run(
      match.match_id,
      match.pilot_id || `pilot_${Date.now()}`,
      match.callsign,
      match.company_canonical,
      match.final_score,
      JSON.stringify(match.telemetry || {}),
      JSON.stringify(match.ship_spec_snapshot || {}),
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
