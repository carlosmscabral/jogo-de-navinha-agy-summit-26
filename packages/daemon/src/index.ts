import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SQLiteBufferService } from './services/sqlite-buffer.js';
import { WorkspaceGeneratorService } from './services/workspace-generator.js';
import { FileWatcherService } from './services/file-watcher.js';
import { validateCallsign, selectFallbackPreset, EnergySliders } from '@jogo/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mcpsDistDir = path.resolve(__dirname, '../../mcps/dist');

const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/pty' });

const sqliteBuffer = new SQLiteBufferService();
const fileWatcher = new FileWatcherService();

const activeClients = new Set<WebSocket>();

function broadcast(message: Record<string, unknown>): void {
  const payload = JSON.stringify(message);
  for (const client of activeClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

const AGY_SILENCE_TIMEOUT_MS = Number(process.env.AGY_SILENCE_TIMEOUT_MS) || 15_000;
const AGY_HARD_TIMEOUT_MS = Number(process.env.AGY_HARD_TIMEOUT_MS) || 150_000;
const AGY_LIVENESS_POLL_MS = 1_000;

let silenceTimer: NodeJS.Timeout | undefined;
let hardTimer: NodeJS.Timeout | undefined;
let livenessTimer: NodeJS.Timeout | undefined;
let shipDelivered = false;

function clearAgyTimers(): void {
  if (silenceTimer) clearTimeout(silenceTimer);
  if (hardTimer) clearTimeout(hardTimer);
  if (livenessTimer) clearInterval(livenessTimer);
  silenceTimer = hardTimer = livenessTimer = undefined;
}

function armSilenceTimer(sliders: EnergySliders, reasonPrefix: string): void {
  if (silenceTimer) clearTimeout(silenceTimer);
  silenceTimer = setTimeout(() => triggerFallback(sliders, `${reasonPrefix}: silêncio de ${AGY_SILENCE_TIMEOUT_MS}ms`), AGY_SILENCE_TIMEOUT_MS);
}

function killAgyProcessGroup(): void {
  const pidFile = path.join(sessionDir, '.agy_pid');
  if (!fs.existsSync(pidFile)) return;

  let pgid = 0;
  try {
    pgid = Number(fs.readFileSync(pidFile, 'utf8').trim());
  } catch {
    return;
  }
  if (!pgid || Number.isNaN(pgid) || pgid <= 1) return;

  // Negativo = grupo inteiro. Os 3 MCPs stdio são filhos do agy e morrem junto.
  const signalGroup = (sig: NodeJS.Signals): boolean => {
    try {
      process.kill(-pgid, sig);
      return true;
    } catch (err: any) {
      // Grupo não existe (ex.: agy iniciado sem job control). Cai para o PID isolado.
      try { process.kill(pgid, sig); } catch {}
      return false;
    }
  };

  console.log(`[Daemon Reset] Encerrando process group ${pgid}...`);
  signalGroup('SIGINT');
  setTimeout(() => { signalGroup('SIGKILL'); }, 600);

  try { fs.unlinkSync(pidFile); } catch {}
}

function triggerFallback(sliders: EnergySliders, reason: string): void {
  if (shipDelivered) return;
  shipDelivered = true;
  clearAgyTimers();

  const { name, spec } = selectFallbackPreset(sliders);
  spec.pilot = { ...spec.pilot, ...currentSessionMetadata?.pilot };
  spec.build_metadata.fallback_used = true;
  console.warn(`[Daemon] Fallback automático acionado (${reason}). Preset: ${name}`);

  killAgyProcessGroup();
  broadcast({ type: 'EVENT_SHIP_READY', spec, fallback: true, fallback_preset: name, fallback_reason: reason });
}

const sessionDir = process.env.BOOTH_SESSION_DIR || '/tmp/booth_session';

let currentSessionMetadata: any = null;

// --- REST Endpoints ---

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.get('/api/companies', (req, res) => {
  const query = String(req.query.q || '');
  const companies = sqliteBuffer.searchCompanies(query);
  res.json({ companies });
});

app.get('/api/leaderboard', (req, res) => {
  const data = sqliteBuffer.getLeaderboardData();
  res.json(data);
});

app.get('/api/session/status', (req, res) => {
  const activeFile = path.join(sessionDir, '.session_active');
  const isActive = fs.existsSync(activeFile);
  res.json({
    active: isActive,
    metadata: currentSessionMetadata,
    sessionDir
  });
});

app.get('/api/session/spec', (req, res) => {
  const spec = fileWatcher.getCurrentSpec();
  if (spec) {
    return res.json({ ready: true, spec });
  }

  const specPath = path.join(sessionDir, 'ship_spec.json');
  if (fs.existsSync(specPath)) {
    try {
      const raw = fs.readFileSync(specPath, 'utf8');
      const parsed = JSON.parse(raw);
      return res.json({ ready: true, spec: parsed });
    } catch {
      // Ignored
    }
  }

  res.json({ ready: false });
});

app.get('/api/session/activity', (req, res) => {
  const activity = fileWatcher.getActivityHistory();
  res.json({ activity });
});

app.post('/api/session/start', (req, res) => {
  try {
    const { pilot, energy_sliders, selected_mcps, selected_subagents } = req.body;

    const validation = validateCallsign(pilot?.callsign || '');
    const canonicalCompany = sqliteBuffer.resolveCompany(pilot?.company_raw);
    const fullPilot = {
      ...pilot,
      callsign: validation.sanitized,
      company_canonical: canonicalCompany
    };

    // 1. Generate clean workspace in /tmp/booth_session with .agents configs & GEMINI.md
    WorkspaceGeneratorService.generateWorkspace({
      sessionDir,
      pilot: fullPilot,
      energy_sliders,
      selected_mcps: selected_mcps || ['weapons-arsenal', 'hull-propulsion', 'cybernetics-shields'],
      selected_subagents: selected_subagents || ['aesthetic-designer', 'combat-strategist'],
      mcpsDistDir
    });

    currentSessionMetadata = {
      pilot: fullPilot,
      energy_sliders,
      selected_mcps,
      selected_subagents,
      started_at: new Date().toISOString()
    };

    // Write .session_active flag for the booth-terminal supervisor script
    fs.writeFileSync(
      path.join(sessionDir, '.session_active'),
      JSON.stringify(currentSessionMetadata, null, 2),
      'utf8'
    );

    // 2. Start File Watcher on /tmp/booth_session/ship_spec.json and mcp_audit.log
    const requiredMcps: string[] = Array.isArray(selected_mcps) && selected_mcps.length > 0
      ? selected_mcps
      : ['weapons-arsenal', 'hull-propulsion', 'cybernetics-shields'];

    fileWatcher.startWatching(sessionDir, {
      requiredMcps,
      onShipReady: (shipSpec) => {
        shipDelivered = true;
        clearAgyTimers();
        console.log(`[Daemon] Broadcasting EVENT_SHIP_READY to ${activeClients.size} connected client(s)...`);
        broadcast({ type: 'EVENT_SHIP_READY', spec: shipSpec });
      },
      onMcpActivity: (activity) => {
        armSilenceTimer(energy_sliders, 'após atividade MCP');
        broadcast({ type: 'EVENT_MCP_ACTIVITY', data: activity });
      },
      onSpecRejected: (rejection) => {
        armSilenceTimer(energy_sliders, 'após rejeição de spec');
        console.error('[Daemon] Spec rejeitada:', rejection.reason, rejection.details.join('; '));
        broadcast({ type: 'EVENT_SPEC_REJECTED', data: rejection });
      }
    });

    shipDelivered = false;
    clearAgyTimers();
    hardTimer = setTimeout(
      () => triggerFallback(energy_sliders, `teto rígido de ${AGY_HARD_TIMEOUT_MS}ms`),
      AGY_HARD_TIMEOUT_MS
    );
    livenessTimer = setInterval(() => {
      const pidFile = path.join(sessionDir, '.agy_pid');
      if (!fs.existsSync(pidFile)) return;
      const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
      if (!pid || Number.isNaN(pid)) return;
      try {
        process.kill(pid, 0); // sinal 0: só testa existência
      } catch {
        triggerFallback(energy_sliders, 'processo do agy encerrou sem entregar a nave');
      }
    }, AGY_LIVENESS_POLL_MS);

    console.log(`[Daemon API] Session workspace initialized at: ${sessionDir} for pilot ${fullPilot.callsign}`);

    res.json({
      status: 'WORKSPACE_INITIALIZED',
      sessionDir,
      pilot: fullPilot
    });
  } catch (err) {
    console.error('[Daemon API] Error starting session:', err);
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/matches', (req, res) => {
  const matchRecord = req.body;

  try {
    sqliteBuffer.saveMatch(matchRecord);
  } catch (err) {
    // Registro incompleto (telemetry/ship_spec_snapshot/pilot_id ausentes) — erro do cliente, não do servidor.
    return res.status(400).json({ error: String(err) });
  }

  try {
    const updatedLeaderboard = sqliteBuffer.getLeaderboardData();

    // Broadcast real-time leaderboard update to TV display clients
    broadcast({
      type: 'EVENT_LEADERBOARD_UPDATE',
      data: updatedLeaderboard,
      newMatch: matchRecord
    });

    res.json({ status: 'SAVED_LOCALLY', match_id: matchRecord.match_id, leaderboard: updatedLeaderboard });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/session/reset', (req, res) => {
  try {
    clearAgyTimers();
    shipDelivered = false;
    fileWatcher.stopWatching();
    currentSessionMetadata = null;

    // 1. Remove active session indicator
    const activeFile = path.join(sessionDir, '.session_active');
    if (fs.existsSync(activeFile)) {
      try { fs.unlinkSync(activeFile); } catch {}
    }

    // 2. [D4] Encerra o grupo de processos do agy, incluindo os MCPs stdio.
    killAgyProcessGroup();

    // 3. [Spec 06 §2.1] Higiene: o GEMINI.md do visitante anterior contém nome e empresa.
    //    Apaga todo o conteúdo preservando o inode do diretório (evita uv_cwd ENOENT no terminal aberto).
    try {
      for (const entry of fs.readdirSync(sessionDir)) {
        fs.rmSync(path.join(sessionDir, entry), { recursive: true, force: true });
      }
    } catch (err) {
      console.warn('[Daemon Reset] Falha ao limpar o diretório de sessão:', err);
    }

    console.log('[Daemon Reset] Session cleared successfully.');
    res.json({ status: 'RESET_COMPLETE' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// --- WebSocket Event Broadcast ---

wss.on('connection', (ws) => {
  activeClients.add(ws);
  console.log(`[Daemon WS] Client connected (Total: ${activeClients.size})`);

  // Send current leaderboard snapshot immediately on connect
  const initialLeaderboard = sqliteBuffer.getLeaderboardData();
  ws.send(JSON.stringify({ type: 'EVENT_LEADERBOARD_UPDATE', data: initialLeaderboard }));

  // If a spec already exists when connecting, send it
  const existingSpec = fileWatcher.getCurrentSpec();
  if (existingSpec) {
    ws.send(JSON.stringify({ type: 'EVENT_SHIP_READY', spec: existingSpec }));
  }

  // Send activity history
  const history = fileWatcher.getActivityHistory();
  if (history.length > 0) {
    for (const item of history) {
      ws.send(JSON.stringify({ type: 'EVENT_MCP_ACTIVITY', data: item }));
    }
  }

  ws.on('close', () => {
    activeClients.delete(ws);
    console.log(`[Daemon WS] Client disconnected (Total: ${activeClients.size})`);
  });
});

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => {
  console.log(`[Local Bridge Daemon] Running at http://localhost:${PORT}`);
  console.log(`[Local Bridge Daemon] Workspace session path: ${sessionDir}`);
});
