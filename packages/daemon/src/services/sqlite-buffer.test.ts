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
});
