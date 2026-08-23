import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { SQLiteBufferService, loadCompanyCatalog } from './sqlite-buffer.js';

function tempDb(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'booth-db-')), 'booth.sqlite');
}

describe('SQLiteBufferService', () => {
  it('não semeia pilotos fictícios por padrão', () => {
    delete process.env.BOOTH_SEED_DEMO;
    const db = new SQLiteBufferService(tempDb());
    const board = db.getLeaderboardData();
    assert.equal(board.topPilots.length, 0, 'o placar nasce vazio no estande');
    db.close();
  });

  it('semeia apenas quando BOOTH_SEED_DEMO=1', () => {
    process.env.BOOTH_SEED_DEMO = '1';
    const db = new SQLiteBufferService(tempDb());
    assert.ok(db.getLeaderboardData().topPilots.length > 0);
    db.close();
    delete process.env.BOOTH_SEED_DEMO;
  });

  it('resolve o caminho padrão de forma absoluta, independente do cwd', () => {
    delete process.env.BOOTH_DB_PATH;
    assert.ok(path.isAbsolute(SQLiteBufferService.defaultDbPath()));
  });

  it('rejeita partida sem telemetria em vez de gravar objeto vazio', () => {
    const db = new SQLiteBufferService(tempDb());
    assert.throws(
      () => db.saveMatch({ match_id: 'm1', callsign: 'X', company_canonical: 'Acme', final_score: 10 } as any),
      /telemetry/
    );
    db.close();
  });

  it('preserva telemetria e snapshot da nave no round-trip', () => {
    const db = new SQLiteBufferService(tempDb());
    db.saveMatch({
      match_id: 'm2',
      pilot_id: 'pilot-abc',
      callsign: 'NOVA',
      company_canonical: 'Acme',
      company_raw: 'acme corp',
      company_confidence: 0.95,
      final_score: 12345,
      telemetry: {
        duration_s: 90, enemies_killed: 42, boss_defeated: true, damage_taken: 2,
        accuracy_pct: 61.5, shots_fired: 400, shots_hit: 246,
        fallback_used: false, seed: 7, boss_ttk_s: 31.2, boss_fight_min_fps: 58.4,
        boss_damage_dealt: 800, boss_phase_reached: 3
      },
      ship_spec_snapshot: { pilot: { callsign: 'NOVA' } } as any,
      score_breakdown: {
        combatScore: 1000, bossBonus: 500, timeBonus: 100, survivalBonus: 50,
        bossDamageBonus: 0, bossPhaseBonus: 0, synergyBonus: 0, mcpMultiplier: 1.1
      },
      created_at: new Date().toISOString()
    });

    const pending = db.getPendingMatches();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].pilot_id, 'pilot-abc');
    assert.equal(pending[0].telemetry.enemies_killed, 42);
    assert.equal(pending[0].telemetry.seed, 7);
    assert.equal(pending[0].ship_spec_snapshot.pilot.callsign, 'NOVA');
    assert.equal(pending[0].company_raw, 'acme corp');
    assert.equal(pending[0].company_confidence, 0.95);
    assert.deepEqual(pending[0].score_breakdown, {
      combatScore: 1000, bossBonus: 500, timeBonus: 100, survivalBonus: 50,
      bossDamageBonus: 0, bossPhaseBonus: 0, synergyBonus: 0, mcpMultiplier: 1.1
    });
    assert.equal(pending[0].needs_company_review, false, 'confiança 0.95 está acima do limiar de 0.80');
    db.close();
  });

  it('marca needs_company_review quando a confiança fica abaixo de 0.80', () => {
    const db = new SQLiteBufferService(tempDb());
    db.saveMatch({
      match_id: 'm3',
      pilot_id: 'pilot-xyz',
      callsign: 'GHOST',
      company_canonical: 'Startup Do João',
      company_raw: 'startup do joao',
      company_confidence: 0.5,
      final_score: 100,
      telemetry: {
        duration_s: 10, enemies_killed: 1, boss_defeated: false, damage_taken: 0,
        accuracy_pct: 100, shots_fired: 1, shots_hit: 1,
        fallback_used: false, seed: 1, boss_ttk_s: null, boss_fight_min_fps: null,
        boss_damage_dealt: 0, boss_phase_reached: null
      },
      ship_spec_snapshot: { pilot: { callsign: 'GHOST' } } as any,
      score_breakdown: {
        combatScore: 10, bossBonus: 0, timeBonus: 0, survivalBonus: 0,
        bossDamageBonus: 0, bossPhaseBonus: 0, synergyBonus: 0, mcpMultiplier: 1
      },
      created_at: new Date().toISOString()
    });

    const pending = db.getPendingMatches();
    assert.equal(pending[0].needs_company_review, true);
    db.close();
  });

  it('não atribui a Google uma empresa vazia', () => {
    const db = new SQLiteBufferService(tempDb());
    assert.notEqual(db.resolveCompany('').canonical, 'Google');
    assert.notEqual(db.resolveCompany('   ').canonical, 'Google');
    assert.equal(db.resolveCompany('').canonical, 'Independente');
    db.close();
  });

  it('continua resolvendo os typos conhecidos', () => {
    const db = new SQLiteBufferService(tempDb());
    assert.equal(db.resolveCompany('Gooogle').canonical, 'Google');
    db.close();
  });

  it('trata entrada vazia como confiança 1.0 -- é um default deliberado, não uma dúvida', () => {
    const db = new SQLiteBufferService(tempDb());
    assert.equal(db.resolveCompany('').confidence, 1.0);
    db.close();
  });

  it('devolve confiança alta (>= 0.8) para um typo conhecido resolvido via catálogo', () => {
    const db = new SQLiteBufferService(tempDb());
    const resolved = db.resolveCompany('Gooogle');
    assert.equal(resolved.canonical, 'Google');
    assert.ok(resolved.confidence >= 0.8, `esperava confiança >= 0.8, recebeu ${resolved.confidence}`);
    db.close();
  });

  it('devolve confiança baixa para uma entrada nova que só bate no fallback do catálogo', () => {
    const db = new SQLiteBufferService(tempDb());
    const resolved = db.resolveCompany('Startup do João');
    assert.equal(resolved.canonical, 'Startup Do João');
    assert.ok(resolved.confidence < 0.8, `esperava confiança < 0.8, recebeu ${resolved.confidence}`);
    db.close();
  });

  it('trata um hit de cache de alias como confiança 1.0, mesmo que a resolução original tenha sido incerta', () => {
    const db = new SQLiteBufferService(tempDb());
    const first = db.resolveCompany('Startup do João');
    assert.ok(first.confidence < 0.8, 'pré-condição: a primeira resolução precisa ser incerta');

    const second = db.resolveCompany('Startup do João');
    assert.equal(second.canonical, 'Startup Do João');
    assert.equal(second.confidence, 1.0, 'um alias já em cache é uma resolução já aceita antes -- não há dúvida a marcar');
    db.close();
  });
});

describe('auto-cura do schema pré-C8', () => {
  it('adiciona as colunas novas a um banco existente com o schema antigo, sem perder saveMatch', () => {
    const dbPath = tempDb();

    // Simula um banco criado antes da Tarefa C8: só as 9 colunas originais.
    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE local_matches (
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
    raw.close();

    // Antes da correção, isto lançaria "table local_matches has no column named company_raw".
    const db = new SQLiteBufferService(dbPath);
    assert.doesNotThrow(() => db.saveMatch({
      match_id: 'm-old-schema',
      pilot_id: 'pilot-old',
      callsign: 'LEGACY',
      company_canonical: 'Acme',
      company_raw: 'acme',
      company_confidence: 0.95,
      final_score: 100,
      telemetry: {
        duration_s: 10, enemies_killed: 1, boss_defeated: false, damage_taken: 0,
        accuracy_pct: 50, shots_fired: 2, shots_hit: 1,
        fallback_used: false, seed: 1, boss_ttk_s: 0, boss_fight_min_fps: 60,
        boss_damage_dealt: 0, boss_phase_reached: 0
      },
      ship_spec_snapshot: { pilot: { callsign: 'LEGACY' } } as any
    } as any));
    db.close();
  });

  it('continua funcionando normalmente num banco novo, sem arquivo pré-existente (regressão)', () => {
    const db = new SQLiteBufferService(tempDb());
    assert.doesNotThrow(() => db.saveMatch({
      match_id: 'm-fresh',
      pilot_id: 'pilot-fresh',
      callsign: 'FRESH',
      company_canonical: 'Acme',
      final_score: 50,
      telemetry: {
        duration_s: 10, enemies_killed: 1, boss_defeated: false, damage_taken: 0,
        accuracy_pct: 50, shots_fired: 2, shots_hit: 1,
        fallback_used: false, seed: 1, boss_ttk_s: 0, boss_fight_min_fps: 60,
        boss_damage_dealt: 0, boss_phase_reached: 0
      },
      ship_spec_snapshot: { pilot: { callsign: 'FRESH' } } as any
    } as any));
    db.close();
  });
});

describe('catálogo de empresas', () => {
  it('carrega do arquivo apontado por BOOTH_COMPANIES_FILE', () => {
    const f = path.join(os.tmpdir(), `companies-${process.pid}.json`);
    fs.writeFileSync(f, JSON.stringify({ companies: ['Acme Corp', 'Umbrella'] }));
    assert.deepEqual(loadCompanyCatalog(f), ['Acme Corp', 'Umbrella']);
    fs.unlinkSync(f);
  });

  it('cai na lista embutida quando o arquivo não existe, em vez de subir vazio', () => {
    const catalog = loadCompanyCatalog('/caminho/que/nao/existe.json');
    assert.ok(catalog.includes('Google'));
    assert.ok(catalog.length >= 20);
  });

  it('recusa um arquivo malformado em vez de silenciar', () => {
    const f = path.join(os.tmpdir(), `bad-${process.pid}.json`);
    fs.writeFileSync(f, '{ isto não é json');
    assert.throws(() => loadCompanyCatalog(f), /companies\.json/i);
    fs.unlinkSync(f);
  });
});

describe('moderação do campo empresa', () => {
  it('não deixa texto ofensivo virar nome de empresa no telão', () => {
    const buffer = new SQLiteBufferService(tempDb());
    assert.equal(buffer.resolveCompany('PORRA LTDA').canonical, 'Independente');
    assert.equal(buffer.resolveCompany('p0rr4 tech').canonical, 'Independente');
    buffer.close();
  });

  it('trata o override de profanidade como confiança 1.0 -- é uma decisão deliberada, não incerteza', () => {
    const buffer = new SQLiteBufferService(tempDb());
    assert.equal(buffer.resolveCompany('PORRA LTDA').confidence, 1.0);
    buffer.close();
  });

  it('não afeta empresa desconhecida mas inofensiva', () => {
    const buffer = new SQLiteBufferService(tempDb());
    assert.equal(buffer.resolveCompany('Startup do João').canonical, 'Startup Do João');
    buffer.close();
  });

  it('não afeta empresa do catálogo', () => {
    const buffer = new SQLiteBufferService(tempDb());
    assert.equal(buffer.resolveCompany('Gooogle Brasil').canonical, 'Google');
    buffer.close();
  });
});
