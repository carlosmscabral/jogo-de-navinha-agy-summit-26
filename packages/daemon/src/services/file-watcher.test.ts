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

  it('aceita uma spec que traz "$schema" no topo em vez de rejeitá-la por additionalProperties', async () => {
    const dir3 = tempSession();
    fs.writeFileSync(path.join(dir3, 'mcp_audit.log'), '', 'utf8');

    const rejections: any[] = [];
    const readySpecs: any[] = [];
    const w = new FileWatcherService();
    w.startWatching(dir3, {
      requiredMcps: [],
      onShipReady: (s) => readySpecs.push(s),
      onSpecRejected: (r) => rejections.push(r)
    });

    // Convenção comum de agentes de IA ao escrever JSON "à mão": incluir $schema
    // no topo. O schema estrito não declara essa chave — normalizeSpec precisa
    // descartá-la incondicionalmente, e não apenas evitar adicioná-la de novo.
    const specWithSchema = {
      $schema: 'https://json-schema.org/draft-07/schema#',
      ...FALLBACK_PRESETS.interceptor
    };
    fs.writeFileSync(path.join(dir3, 'ship_spec.json'), JSON.stringify(specWithSchema), 'utf8');
    await wait(900);

    assert.equal(rejections.length, 0, 'não deve rejeitar por additionalProperties por causa de $schema');
    assert.equal(readySpecs.length, 1, 'deve liberar a spec normalmente');
    assert.equal((readySpecs[0] as any).$schema, undefined, 'a spec liberada não deve carregar $schema');

    w.stopWatching();
    fs.rmSync(dir3, { recursive: true, force: true });
  });

  it('dispara onAuditGateSatisfied exatamente uma vez, quando o último MCP obrigatório é registrado', async () => {
    const dir4 = tempSession();
    const auditPath = path.join(dir4, 'mcp_audit.log');
    fs.writeFileSync(auditPath, '', 'utf8');

    let satisfiedCount = 0;
    const w = new FileWatcherService();
    w.startWatching(dir4, {
      requiredMcps: ['weapons-arsenal', 'hull-propulsion'],
      onShipReady: () => {},
      onAuditGateSatisfied: () => { satisfiedCount += 1; }
    });

    fs.appendFileSync(auditPath, auditLine('weapons-arsenal', 'configure_primary_cannon'));
    await wait(900);
    assert.equal(satisfiedCount, 0, 'gate não deve disparar com apenas 1 dos 2 MCPs obrigatórios');

    fs.appendFileSync(auditPath, auditLine('hull-propulsion', 'tune_thrusters'));
    await wait(900);
    assert.equal(satisfiedCount, 1, 'gate deve disparar exatamente uma vez quando o último MCP é registrado');

    // Uma terceira chamada MCP não deve disparar de novo
    fs.appendFileSync(auditPath, auditLine('weapons-arsenal', 'attach_secondary_ordnance'));
    await wait(900);
    assert.equal(satisfiedCount, 1, 'gate não deve disparar de novo após já satisfeito');

    w.stopWatching();
    fs.rmSync(dir4, { recursive: true, force: true });
  });

  it('forceCheckNow() libera uma spec válida e já auditada antes mesmo do poll de 400ms ou do chokidar rodarem', () => {
    const dir5 = tempSession();
    const auditPath = path.join(dir5, 'mcp_audit.log');
    fs.writeFileSync(auditPath, '', 'utf8');

    const readySpecs: any[] = [];
    const w = new FileWatcherService();
    w.startWatching(dir5, {
      requiredMcps: ['weapons-arsenal'],
      onShipReady: (s) => readySpecs.push(s)
    });

    // Escreve a auditoria e a spec, e chama forceCheckNow() imediatamente —
    // na mesma volta síncrona, sem nenhum await/setTimeout entre a escrita e
    // a checagem. Como Node.js é single-threaded e tanto o pollIntervalTimer
    // (400ms) quanto o chokidar (que depende de I/O assíncrono e de um
    // awaitWriteFinish com pollInterval de 50ms) só entregam eventos em ciclos
    // futuros do event loop, nenhum dos dois pode ter processado estes
    // arquivos dentro desta mesma função síncrona. A única forma de
    // readySpecs já conter o resultado na asserção abaixo é o efeito
    // síncrono do próprio forceCheckNow() — não uma coincidência de timing
    // com o poller de fundo.
    fs.appendFileSync(auditPath, auditLine('weapons-arsenal', 'configure_primary_cannon'));
    fs.writeFileSync(path.join(dir5, 'ship_spec.json'), JSON.stringify(FALLBACK_PRESETS.interceptor), 'utf8');
    w.forceCheckNow();

    assert.equal(readySpecs.length, 1, 'forceCheckNow deve liberar a spec sincronamente, sem esperar o poll/chokidar');
    assert.equal(readySpecs[0].pilot.callsign, FALLBACK_PRESETS.interceptor.pilot.callsign);

    w.stopWatching();
    fs.rmSync(dir5, { recursive: true, force: true });
  });

  it('forceCheckNow() é um no-op seguro antes de startWatching() e depois de stopWatching()', () => {
    const w = new FileWatcherService();
    assert.doesNotThrow(() => w.forceCheckNow());

    const dir6 = tempSession();
    fs.writeFileSync(path.join(dir6, 'mcp_audit.log'), '', 'utf8');
    w.startWatching(dir6, { requiredMcps: [], onShipReady: () => {} });
    w.stopWatching();

    assert.doesNotThrow(() => w.forceCheckNow());

    fs.rmSync(dir6, { recursive: true, force: true });
  });
});
