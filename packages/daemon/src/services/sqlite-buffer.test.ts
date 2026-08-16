import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SQLiteBufferService } from './sqlite-buffer.js';

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
      final_score: 12345,
      telemetry: {
        duration_s: 90, enemies_killed: 42, boss_defeated: true, damage_taken: 2,
        accuracy_pct: 61.5, shots_fired: 400, shots_hit: 246,
        fallback_used: false, seed: 7, boss_ttk_s: 31.2, boss_fight_min_fps: 58.4
      },
      ship_spec_snapshot: { pilot: { callsign: 'NOVA' } } as any,
      created_at: new Date().toISOString()
    });

    const pending = db.getPendingMatches();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].pilot_id, 'pilot-abc');
    assert.equal(pending[0].telemetry.enemies_killed, 42);
    assert.equal(pending[0].telemetry.seed, 7);
    assert.equal(pending[0].ship_spec_snapshot.pilot.callsign, 'NOVA');
    db.close();
  });
});
