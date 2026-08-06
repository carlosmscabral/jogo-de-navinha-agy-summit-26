import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SQLiteBufferService } from './services/sqlite-buffer.js';
import { WorkspaceGeneratorService } from './services/workspace-generator.js';
import { PtyManagerService } from './services/pty-manager.js';
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
const ptyManager = new PtyManagerService();
const fileWatcher = new FileWatcherService();

let activeWsClient: WebSocket | null = null;
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

    // 1. Generate clean workspace with selected agents and MCPs
    WorkspaceGeneratorService.generateWorkspace({
      sessionDir,
      pilot: fullPilot,
      energy_sliders,
      selected_mcps: selected_mcps || ['weapons-arsenal', 'hull-propulsion'],
      selected_subagents: selected_subagents || ['aesthetic-designer', 'combat-strategist'],
      mcpsDistDir
    });

    // 2. Start File Watcher
    fileWatcher.startWatching(sessionDir, (shipSpec) => {
      if (activeWsClient && activeWsClient.readyState === WebSocket.OPEN) {
        activeWsClient.send(JSON.stringify({ type: 'EVENT_SHIP_READY', spec: shipSpec }));
      }
    });

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
    ptyManager.killSession();
    fileWatcher.stopWatching();
    res.json({ status: 'RESET_COMPLETE' });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// --- WebSocket /pty ---

wss.on('connection', (ws) => {
  activeWsClient = ws;
  console.log('[Daemon WS] Client connected to /pty');

  ws.on('message', (message: string) => {
    try {
      const parsed = JSON.parse(message);
      if (parsed.type === 'start_pty') {
        ptyManager.startSession(sessionDir, ws, parsed.initialPrompt || 'agy');
      } else if (parsed.type === 'pty_input') {
        ptyManager.writeInput(parsed.data);
      } else if (parsed.type === 'pty_resize') {
        ptyManager.resize(parsed.cols, parsed.rows);
      }
    } catch {
      // Raw string input
      ptyManager.writeInput(message.toString());
    }
  });

  ws.on('close', () => {
    activeWsClient = null;
    console.log('[Daemon WS] Client disconnected');
  });
});

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => {
  console.log(`[Local Bridge Daemon] Running at http://localhost:${PORT}`);
});
