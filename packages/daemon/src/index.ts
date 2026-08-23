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
import { moderateRemotely } from './services/remote-moderation.js';
import { CloudSyncService } from './services/cloud-sync.js';
import { validateCallsign, selectFallbackPreset, EnergySliders } from '@jogo/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mcpsDistDir = path.resolve(__dirname, '../../mcps/dist');

const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/events' });

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

// 2026-08-16: armar este relógio desde o início da sessão (não só depois da primeira atividade
// de MCP) expôs que ele mede a coisa errada na largada. O Fast-Grill-Me faz DUAS perguntas
// conversacionais (foco de arma, estilo estético) ANTES de qualquer ferramenta MCP ser chamada,
// e o daemon não enxerga nada dessa troca -- só `mcp_audit.log` e `ship_spec.json` contam como
// sinal de vida. Um teste manual real (visitante lendo e respondendo as duas perguntas, sem
// pressa nenhuma) já bastou pra estourar os 30s antigos e matar o `agy` no meio da conversa. 30s
// nunca foi pouco tempo pra "o agente travou"; era pouco tempo pra "um humano leu duas perguntas
// e digitou duas respostas". Ver AGY_SILENCE_TIMEOUT_MS abaixo para a fase que continua rápida
// por natureza (chamadas de ferramenta são automáticas, não esperam humano).
const AGY_PRE_MCP_SILENCE_TIMEOUT_MS = Number(process.env.AGY_PRE_MCP_SILENCE_TIMEOUT_MS) || 60_000;
// Vale só DEPOIS da primeira ferramenta MCP já ter sido chamada: daqui pra frente é o `agy`
// encadeando chamadas de tool sozinho, sem esperar resposta de humano, então o ritmo é de
// máquina -- 30s de silêncio nessa fase é sinal real de travamento, não de gente pensando.
const AGY_SILENCE_TIMEOUT_MS = Number(process.env.AGY_SILENCE_TIMEOUT_MS) || 30_000;
const AGY_HARD_TIMEOUT_MS = Number(process.env.AGY_HARD_TIMEOUT_MS) || 150_000;
const AGY_POST_AUDIT_TIMEOUT_MS = Number(process.env.AGY_POST_AUDIT_TIMEOUT_MS) || 90_000;
const AGY_LIVENESS_POLL_MS = 1_000;

let silenceTimer: NodeJS.Timeout | undefined;
let hardTimer: NodeJS.Timeout | undefined;
let livenessTimer: NodeJS.Timeout | undefined;
let shipDelivered = false;
let auditGateSatisfied = false;
let firstMcpActivitySeen = false;
let lastKnownAgyPid: number | null = null;

function clearAgyTimers(): void {
  if (silenceTimer) clearTimeout(silenceTimer);
  if (hardTimer) clearTimeout(hardTimer);
  if (livenessTimer) clearInterval(livenessTimer);
  silenceTimer = hardTimer = livenessTimer = undefined;
}

function armSilenceTimer(sliders: EnergySliders, reasonPrefix: string): void {
  if (silenceTimer) clearTimeout(silenceTimer);
  const timeoutMs = auditGateSatisfied
    ? AGY_POST_AUDIT_TIMEOUT_MS
    : firstMcpActivitySeen
      ? AGY_SILENCE_TIMEOUT_MS
      : AGY_PRE_MCP_SILENCE_TIMEOUT_MS;
  silenceTimer = setTimeout(() => triggerFallback(sliders, `${reasonPrefix}: silêncio de ${timeoutMs}ms`), timeoutMs);
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
  // Última checagem antes de desistir: uma spec válida pode ter sido escrita
  // bem perto do estouro do temporizador, mas ainda não processada pelo
  // watcher — sem isso, encerrar a sessão custaria a nave real por uma
  // corrida de poucos milissegundos contra o polling. Se essa checagem
  // encontrar e liberar uma spec real, o onShipReady já configurado abaixo
  // marca shipDelivered, e o guard logo em seguida cancela o fallback.
  fileWatcher.forceCheckNow();
  if (shipDelivered) return;
  shipDelivered = true;
  clearAgyTimers();

  const { name, spec } = selectFallbackPreset(sliders);
  spec.pilot = { ...spec.pilot, ...currentSessionMetadata?.pilot };
  spec.build_metadata.fallback_used = true;
  console.warn(`[Daemon] Fallback automático acionado (${reason}). Preset: ${name}`);

  killAgyProcessGroup();
  // [Fase A / revisão final — Importante 4] Sem isto, o watcher continua de pé
  // durante a janela SIGINT→SIGKILL de killAgyProcessGroup(); se o agy ainda
  // conseguir escrever um ship_spec.json válido nesse intervalo, onShipReady
  // dispararia um SEGUNDO EVENT_SHIP_READY com uma nave diferente da que o
  // fallback já entregou. Encerrar o watcher aqui fecha essa corrida.
  fileWatcher.stopWatching();
  broadcast({ type: 'EVENT_SHIP_READY', spec, fallback: true, fallback_preset: name, fallback_reason: reason });
}

const sessionDir = process.env.BOOTH_SESSION_DIR || '/tmp/booth_session';

// Tarefa C4 (Spec 05 §3.2, Spec 08 §6.2) — camada 2 de moderação, remota. `BOOTH_CLOUD_API_BASE`
// é o mesmo nome de variável que a Tarefa C5 (worker de sincronização) vai reutilizar; `null`
// aqui é "nenhuma nuvem configurada", o modo em que todo desenvolvimento local roda hoje.
const CLOUD_API_BASE = process.env.BOOTH_CLOUD_API_BASE || null;
// Mesmo token de escopo único que a cloud-api espera em `Authorization: Bearer` (ver
// packages/cloud-api/src/auth.ts) — o daemon é o único cliente autorizado a chamá-la.
// Revisão final Fase C (Minor 10): função, não uma constante capturada uma vez — relê
// `process.env` a cada chamada de moderação, o mesmo padrão que `cloudSync` já usa (ver
// comentário logo abaixo) para sobreviver a uma rotação de `BOOTH_INGEST_TOKEN` no Secret
// Manager sem exigir reiniciar o daemon. Antes desta correção, o site de moderação era o
// único lugar do arquivo que ainda capturava o token uma vez no carregamento do módulo.
const getCloudApiToken = (): string | null => process.env.BOOTH_INGEST_TOKEN || null;
const MODERATION_L2_TIMEOUT_MS = Number(process.env.BOOTH_MODERATION_L2_TIMEOUT_MS) || 1500;

// Tarefa C5 — worker de sincronização do buffer local com POST /v1/matches (Tarefa C3). `token`
// relê `process.env` a cada tentativa em vez de capturar `CLOUD_API_TOKEN` uma vez: se o staff
// trocar BOOTH_INGEST_TOKEN no Secret Manager depois de um `auth_failed`, o worker precisa
// enxergar o valor novo sem reiniciar o daemon (ver comentário em cloud-sync.ts).
const cloudSync = new CloudSyncService(sqliteBuffer, {
  base: CLOUD_API_BASE,
  token: getCloudApiToken
});
cloudSync.start(30_000);

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
  // [Fase A / revisão final — Crítico 2] NUNCA ler ship_spec.json direto do
  // disco aqui. fileWatcher.getCurrentSpec() só retorna algo depois que a
  // spec passou na validação estrita do schema E no gate de auditoria MCP
  // (Tarefa A2 / D1+D3). Um fallback lendo o arquivo cru reabria exatamente
  // o buraco que A2 fechou: uma spec alucinada ou reprovada no schema ainda
  // chegaria ao jogador via este endpoint, que o HandoffTerminalScreen
  // consulta a cada 600ms como canal duplo de detecção.
  const spec = fileWatcher.getCurrentSpec();
  if (spec) {
    return res.json({ ready: true, spec });
  }
  res.json({ ready: false });
});

app.get('/api/session/activity', (req, res) => {
  const activity = fileWatcher.getActivityHistory();
  res.json({ activity });
});

app.post('/api/session/start', async (req, res) => {
  try {
    const { pilot, energy_sliders, selected_mcps, selected_subagents } = req.body;

    const validation = validateCallsign(pilot?.callsign || '');

    // Tarefa C4 — camada 2, só consultada quando a camada 1 local já aprovou. Se a camada 1
    // já achou problema (curto demais, profanidade, etc.), ela já saneou o callsign para um
    // placeholder seguro por construção (ex.: "PILOTO_042") — perguntar ao modelo de novo não
    // muda nada e só custaria uma chamada de rede. É só no caminho "aprovado localmente" que
    // o insulto velado que a camada 1 não pega tem chance de passar, e é aí que a camada 2 entra.
    if (validation.isValid) {
      const remote = await moderateRemotely(
        CLOUD_API_BASE, getCloudApiToken(), validation.sanitized, MODERATION_L2_TIMEOUT_MS
      );

      if (remote.verdict === 'block') {
        // Falha FECHADA do modelo (Spec 05 §3.2): o registro é recusado com o motivo, e não
        // silenciosamente trocado por um placeholder — o visitante escolhe outro codinome.
        res.status(422).json({
          error: 'callsign_rejected',
          reason: remote.reason || 'Codinome recusado pela moderação.'
        });
        return;
      }

      if (remote.verdict === 'unavailable') {
        // Falha ABERTA do transporte (Spec 08 §6.2): o Vertex está inalcançável, não em dúvida.
        // A camada 1 local já aprovou; o estande não pode parar de receber visitantes por causa
        // disso, mas o staff precisa saber se isso vira o dia inteiro sem moderação semântica.
        console.warn(
          `[Daemon] Moderação semântica (camada 2) indisponível para "${validation.sanitized}" — ` +
          'seguindo só com a aprovação local (camada 1). Se isso persistir, o Vertex está inalcançável.'
        );
      }
    }

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
        // [Fase A / revisão final — Importante 4] Espelha o guard de
        // triggerFallback(): se o fallback já entregou uma nave (ex.: agy
        // morreu ou estourou o teto/silêncio), uma liberação tardia do
        // watcher não pode mais substituir a nave que o visitante já viu.
        if (shipDelivered) return;
        shipDelivered = true;
        clearAgyTimers();
        console.log(`[Daemon] Broadcasting EVENT_SHIP_READY to ${activeClients.size} connected client(s)...`);
        broadcast({ type: 'EVENT_SHIP_READY', spec: shipSpec });
      },
      onMcpActivity: (activity) => {
        // A partir da primeira chamada de ferramenta, o resto da sessão é o `agy` encadeando
        // tool calls sozinho -- sem humano no meio, sem motivo pra manter a janela generosa da
        // conversa. Setado ANTES de rearmar para que este e todo silêncio seguinte já cobrem
        // pelo relógio apertado (AGY_SILENCE_TIMEOUT_MS), não o de pré-conversa.
        firstMcpActivitySeen = true;
        armSilenceTimer(energy_sliders, 'após atividade MCP');
        broadcast({ type: 'EVENT_MCP_ACTIVITY', data: activity });
      },
      onSpecRejected: (rejection) => {
        armSilenceTimer(energy_sliders, 'após rejeição de spec');
        console.error('[Daemon] Spec rejeitada:', rejection.reason, rejection.details.join('; '));
        broadcast({ type: 'EVENT_SPEC_REJECTED', data: rejection });

        // [D14] Motivo da rejeição em disco, para o agente ler e corrigir --
        // ver PASSO 5 do protocolo em GEMINI.md (workspace-generator.ts).
        const errorFile = path.join(sessionDir, 'spec_errors.txt');
        fs.writeFileSync(errorFile,
          `A ship_spec.json foi RECUSADA pelo validador.\n\n` +
          rejection.details.map((e) => `- ${e}`).join('\n') +
          `\n\nCorrija os campos citados e reescreva o arquivo. Apague este spec_errors.txt depois.\n`,
          'utf8'
        );
      },
      onAuditGateSatisfied: () => {
        auditGateSatisfied = true;
        console.log('[Daemon] Gate de auditoria MCP satisfeito — ampliando a janela de silêncio para a fase de sub-agentes narrativos/visuais.');
        armSilenceTimer(energy_sliders, 'após gate de auditoria MCP satisfeito');
      }
    });

    shipDelivered = false;
    auditGateSatisfied = false;
    firstMcpActivitySeen = false;
    lastKnownAgyPid = null;
    clearAgyTimers();
    hardTimer = setTimeout(
      () => triggerFallback(energy_sliders, `teto rígido de ${AGY_HARD_TIMEOUT_MS}ms`),
      AGY_HARD_TIMEOUT_MS
    );
    // Sem isto, `silenceTimer` só nasce dentro de onMcpActivity/onSpecRejected/
    // onAuditGateSatisfied -- se o agy nunca chegar a chamar uma ferramenta (sessão inerte desde
    // o início, ship_spec.json corrompido antes de qualquer atividade), nenhum desses três dispara
    // e a única rede de segurança que sobra é o teto rígido de 150s, dez vezes mais que os 15s
    // prometidos ao visitante. Achado no Bloco 6.1 (2026-08-16): sessão sem interação nenhuma
    // ficou presa na tela de forja bem além de 15s, sem nenhuma atividade de MCP nos logs.
    armSilenceTimer(energy_sliders, 'sessão iniciada sem atividade');
    livenessTimer = setInterval(() => {
      const pidFile = path.join(sessionDir, '.agy_pid');
      if (!fs.existsSync(pidFile)) {
        // booth-terminal.sh apaga o arquivo de PID assim que o processo exec'd
        // termina -- seja por sucesso, crash ou kill externo -- normalmente
        // bem mais rápido que este poll de 1s consegue perceber via
        // process.kill(pid, 0) abaixo. Se já vimos um PID nesta sessão e ele
        // sumiu, o agy encerrou; triggerFallback() já faz um forceCheckNow()
        // antes de desistir, então uma sessão que terminou COM SUCESSO ainda
        // entrega a nave real normalmente, sem corrida.
        if (lastKnownAgyPid !== null) {
          triggerFallback(energy_sliders, 'processo do agy encerrou sem entregar a nave');
        }
        return;
      }
      const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
      if (!pid || Number.isNaN(pid)) return;
      lastKnownAgyPid = pid;
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

    // Sem `await`, de propósito (Tarefa C5): o jogador já viu a resposta acima. A nuvem pode
    // estar inalcançável (Wi-Fi do estande) sem que isso acrescente um milissegundo à resposta
    // local — a fila drena no próximo tick do worker se esta tentativa falhar.
    void cloudSync.syncNow();
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/sync/status', (_req, res) => {
  res.json(cloudSync.status());
});

app.post('/api/session/reset', (req, res) => {
  try {
    clearAgyTimers();
    shipDelivered = false;
    auditGateSatisfied = false;
    firstMcpActivitySeen = false;
    lastKnownAgyPid = null;
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

// --- Estáticos do player-app (Spec 08 §5) ---
// Servir o app pelo próprio bridge torna a origem local e elimina a exposição
// às regras de Private Network Access do Chrome em modo kiosk.
const playerAppDist =
  process.env.BOOTH_PLAYER_APP_DIST || path.resolve(__dirname, '../../player-app/dist');

if (fs.existsSync(path.join(playerAppDist, 'index.html'))) {
  app.use(express.static(playerAppDist));
  app.get(/^\/(?!api\/|events).*/, (_req, res) => {
    res.sendFile(path.join(playerAppDist, 'index.html'));
  });
  console.log(`[Local Bridge Daemon] Serving player-app from ${playerAppDist}`);
} else {
  console.warn(`[Local Bridge Daemon] player-app build not found at ${playerAppDist}. ` +
    `Run "npm run build --workspace=packages/player-app" before the event.`);
}

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
