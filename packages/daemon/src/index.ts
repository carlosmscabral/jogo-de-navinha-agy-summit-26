import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SQLiteBufferService } from './services/sqlite-buffer.js';
import { WorkspaceGeneratorService } from './services/workspace-generator.js';
import { FileWatcherService } from './services/file-watcher.js';

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
const sessionDir = process.env.BOOTH_SESSION_DIR || '/tmp/booth_session';

// --- REST Endpoints ---

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.get('/api/companies', (req, res) => {
  const query = String(req.query.q || '');
  const companies = sqliteBuffer.searchCompanies(query);
  res.json({ companies });
});

app.post('/api/session/start', (req, res) => {
  try {
    const { pilot, energy_sliders, selected_mcps, selected_subagents } = req.body;

    const canonicalCompany = sqliteBuffer.resolveCompany(pilot.company_raw);
    const fullPilot = {
      ...pilot,
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

    // 2. Start File Watcher on /tmp/booth_session/ship_spec.json
    fileWatcher.startWatching(sessionDir, (shipSpec) => {
      console.log(`[Daemon] Broadcasting EVENT_SHIP_READY to ${activeClients.size} connected client(s)...`);
      const payload = JSON.stringify({ type: 'EVENT_SHIP_READY', spec: shipSpec });
      for (const client of activeClients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      }
    });

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
  try {
    const matchRecord = req.body;
    sqliteBuffer.saveMatch(matchRecord);
    res.json({ status: 'SAVED_LOCALLY', match_id: matchRecord.match_id });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/session/reset', (req, res) => {
  try {
    fileWatcher.stopWatching();
    res.json({ status: 'RESET_COMPLETE' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// --- WebSocket Event Broadcast ---

wss.on('connection', (ws) => {
  activeClients.add(ws);
  console.log(`[Daemon WS] Client connected (Total: ${activeClients.size})`);

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
