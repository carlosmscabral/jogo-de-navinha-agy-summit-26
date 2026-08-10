import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FALLBACK_PRESETS } from '@jogo/shared';
import { FileWatcherService } from './file-watcher.js';

function tempSession(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'booth-test-'));
}

function auditLine(server: string, tool: string): string {
  return JSON.stringify({ timestamp: new Date().toISOString(), server, tool, args: {}, result: {} }) + '\n';
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('FileWatcherService — validação estrita e gate de auditoria', () => {
  let dir: string;
  let watcher: FileWatcherService;

  before(() => {
    dir = tempSession();
    fs.writeFileSync(path.join(dir, 'mcp_audit.log'), '', 'utf8');
  });

  after(() => {
    watcher?.stopWatching();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejeita spec que não passa no schema e não emite EVENT_SHIP_READY', async () => {
    const rejections: any[] = [];
    let ready = 0;
    watcher = new FileWatcherService();
    watcher.startWatching(dir, {
      requiredMcps: [],
      onShipReady: () => { ready += 1; },
      onSpecRejected: (r) => rejections.push(r)
    });

    fs.writeFileSync(path.join(dir, 'ship_spec.json'), JSON.stringify({ pilot: { callsign: 'X' } }), 'utf8');
    await wait(900);

    assert.equal(ready, 0);
    assert.equal(rejections.length, 1);
    assert.equal(rejections[0].reason, 'SCHEMA_INVALID');
    watcher.stopWatching();
  });

  it('segura uma spec válida até que todo MCP selecionado tenha registro de auditoria', async () => {
    const dir2 = tempSession();
    const auditPath = path.join(dir2, 'mcp_audit.log');
    fs.writeFileSync(auditPath, '', 'utf8');

    const rejections: any[] = [];
    const readySpecs: any[] = [];
    const w = new FileWatcherService();
    w.startWatching(dir2, {
      requiredMcps: ['weapons-arsenal', 'hull-propulsion'],
      onShipReady: (s) => readySpecs.push(s),
      onSpecRejected: (r) => rejections.push(r)
    });

    fs.appendFileSync(auditPath, auditLine('weapons-arsenal', 'configure_primary_cannon'));
    fs.writeFileSync(path.join(dir2, 'ship_spec.json'), JSON.stringify(FALLBACK_PRESETS.interceptor), 'utf8');
    await wait(900);
    assert.equal(readySpecs.length, 0, 'não pode decolar com auditoria incompleta');

    fs.appendFileSync(auditPath, auditLine('hull-propulsion', 'tune_engine_output'));
    await wait(900);
    assert.equal(readySpecs.length, 1, 'decola assim que a auditoria fecha');
    assert.equal(rejections.length, 0);

    w.stopWatching();
    fs.rmSync(dir2, { recursive: true, force: true });
  });
});
