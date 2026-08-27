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
import { startModeration, type PendingModeration } from './services/pending-moderation.js';
import { CloudSyncService } from './services/cloud-sync.js';
import { parseEnvFile, findShadowedKeys, buildShadowWarning } from './services/env-precedence.js';
import { validateCallsign, placeholderCallsign, selectFallbackPreset, EnergySliders } from '@jogo/shared';

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
//
// 60s -> 75s em 2026-08-24. Este número NÃO mede silêncio: como o daemon é cego à conversa, o
// relógio é armado uma única vez no início da sessão e nunca é rearmado antes da primeira chamada
// de MCP. Ele é, na prática, o orçamento total de "sessão iniciada até a primeira ferramenta" — e
// esse orçamento cobre duas coisas somadas: o visitante lendo/respondendo E o modelo pensando. Um
// modelo lento ou momentaneamente travado consome o mesmo relógio que o humano, e era esse o caso
// que os 60s não cobriam.
const AGY_PRE_MCP_SILENCE_TIMEOUT_MS = Number(process.env.AGY_PRE_MCP_SILENCE_TIMEOUT_MS) || 75_000;
// Vale só DEPOIS da primeira ferramenta MCP já ter sido chamada: daqui pra frente é o `agy`
// encadeando chamadas de tool sozinho, sem esperar resposta de humano, então o ritmo é de
// máquina -- 30s de silêncio nessa fase é sinal real de travamento, não de gente pensando.
const AGY_SILENCE_TIMEOUT_MS = Number(process.env.AGY_SILENCE_TIMEOUT_MS) || 30_000;
// INVARIANTE: este teto tem que ser >= AGY_PRE_MCP_SILENCE_TIMEOUT_MS + AGY_POST_AUDIT_TIMEOUT_MS.
// Ele é absoluto (armado no início da sessão, nunca rearmado — ver `hardTimer` mais abaixo),
// enquanto os outros dois são orçamentos de fases que acontecem em SEQUÊNCIA. Se a soma passar
// deste teto, existe uma sessão que está progredindo normalmente, dentro de cada janela de fase,
// e mesmo assim morre aqui no meio da geração — o visitante recebe fallback sem que nada tenha
// travado. Até 2026-08-24 os números fechavam exatos (60 + 90 = 150); subir o pré-MCP para 75s
// quebraria a soma, então o teto subiu junto, para 165s.
//
// O SLA do ciclo do visitante (Spec 01 §1: meta 2m30s, teto 3m00s) cobre a jornada INTEIRA, não
// só a forja. Com 165s aqui, uma sessão que vai até o teto já estoura a meta sozinha. Isso não é
// novo — 150s já estourava — mas é o número que o cronômetro do Gate M4 tem que confrontar.
const AGY_HARD_TIMEOUT_MS = Number(process.env.AGY_HARD_TIMEOUT_MS) || 165_000;
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
// Este teto tem que ser ESTRITAMENTE MAIOR que o do servidor (MODERATION_L2_TIMEOUT_MS em
// packages/cloud-api, hoje 20000), e a ordem não é estética. O cronômetro daqui começa ANTES do
// hop até o Cloud Run; o de lá só começa quando a requisição chega. Com os dois em 1500 (como
// estavam até o Gate M3, 2026-08-24) o abort local sempre vencia, e o `block` por timeout que o
// moderation-l2.ts existe para emitir NUNCA chegava aqui: virava um abort, que vira
// `unavailable`, que é fail-open. Os dois lados falhando na mesma janela transformavam a política
// de fail-closed do servidor no seu oposto exato, em silêncio. A folga cobre o round trip mais um
// cold start eventual do Cloud Run.
//
// 25s (era 10s) desde que a moderação saiu do caminho crítico, no mesmo dia — ver
// services/pending-moderation.ts. Enquanto o visitante esperava por este número, ele era um
// orçamento de PACIÊNCIA e tinha que ser curto. Agora ele é só o limite de quanto tempo a
// resposta pode demorar antes de a partida acabar, e isso são minutos. O log de resposta tardia
// mostrou vereditos legítimos chegando em 11,5s, 14,8s e 16,2s que o teto de 8s descartava sem
// ninguém ganhar nada; com 25s eles passam a valer, e ninguém espera um milissegundo a mais.
const MODERATION_L2_TIMEOUT_MS = Number(process.env.BOOTH_MODERATION_L2_TIMEOUT_MS) || 25_000;

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

// O veredito da camada 2 em voo, colhido no POST /api/matches. Vive fora do handler porque ele
// atravessa duas requisições: nasce no /api/session/start e é consumido minutos depois, quando a
// partida termina. Ver services/pending-moderation.ts para o motivo de não ser aguardado na hora.
let pendingModeration: PendingModeration | null = null;

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
  // `required`/`seen`/`missing` são o gate de auditoria, o mesmo que decide quando a nave é
  // liberada. A tela do AGY passa a mostrar o que falta em vez de só o que já aconteceu.
  res.json({ activity, ...fileWatcher.getAuditStatus() });
});

app.post('/api/session/start', async (req, res) => {
  try {
    const { pilot, energy_sliders, selected_mcps, selected_subagents } = req.body;

    const validation = validateCallsign(pilot?.callsign || '');
    const callsign = validation.sanitized;

    // Tarefa C4 — camada 2, disparada aqui mas NÃO aguardada aqui (mudança de 2026-08-24, Gate
    // M3). O visitante segue para a tela de instruções imediatamente; o veredito é colhido lá na
    // frente, no POST /api/matches, que é o primeiro ponto onde o codinome realmente precisa
    // estar correto. O porquê, com os números medidos, está em services/pending-moderation.ts.
    //
    // A troca por placeholder num `block` contraria a letra da Spec 05 §3.2 ("o registro é
    // recusado com o motivo […] o visitante escolhe outro codinome") e a contraria de propósito,
    // por decisão do operador em 2026-08-24, depois que o Gate M3 mostrou o que aquele desenho
    // custa no estande: o 422 chegava ao `App.tsx` como um `!res.ok` qualquer, virava "Não foi
    // possível conectar ao servidor da Forja. Verifique a conexão", e deixava o visitante numa
    // tela de onde o codinome nem é editável (ele fica duas telas atrás). Ou seja, a promessa de
    // "escolhe outro codinome" nunca existiu na UI — o que existia era um visitante travado
    // achando que era rede.
    //
    // O OBJETIVO da §3.2 continua cumprido, que é o que importa: o nome ofensivo não chega ao
    // telão. O que muda é quem paga pelo veredito. Sanitizar também fecha um canal de sondagem
    // que o 422 abria — com ele, dava para descobrir por tentativa e erro exatamente onde fica a
    // fronteira do modelo; agora toda recusa é silenciosa e o atacante não recebe sinal nenhum.
    pendingModeration = startModeration(callsign, validation.isValid, {
      moderate: (name) => moderateRemotely(
        CLOUD_API_BASE, getCloudApiToken(), name, MODERATION_L2_TIMEOUT_MS
      ),
      placeholder: placeholderCallsign
    });

    // Quando o veredito chega, o nome definitivo entra na metadata da sessão. Isso importa
    // porque `currentSessionMetadata.pilot` é espelhado na ship spec (ver o merge lá em cima) —
    // sem isto, um nome reprovado sobreviveria dentro do snapshot da nave mesmo depois de o
    // placeholder ter substituído o callsign em todo o resto.
    void pendingModeration.final.then((finalCallsign) => {
      if (currentSessionMetadata?.pilot && finalCallsign !== currentSessionMetadata.pilot.callsign) {
        currentSessionMetadata.pilot.callsign = finalCallsign;
      }
    });

    const { canonical: canonicalCompany, confidence: companyConfidence } = sqliteBuffer.resolveCompany(pilot?.company_raw);
    const fullPilot = {
      ...pilot,
      callsign,
      company_canonical: canonicalCompany,
      company_confidence: companyConfidence
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
        // O gate mudou junto com a atividade; sem isto o checklist da tela do AGY só se
        // atualizaria no polling seguinte.
        broadcast({ type: 'EVENT_AUDIT_STATUS', data: fileWatcher.getAuditStatus() });
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
    // e a única rede de segurança que sobra é o teto rígido (AGY_HARD_TIMEOUT_MS), muitas vezes
    // maior que a janela prometida ao visitante. Achado no Bloco 6.1 (2026-08-16): sessão sem interação nenhuma
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
      pilot: fullPilot,
      // Instante absoluto em que esta sessão deixa de esperar pelo agy de qualquer maneira: é o
      // teto rígido armado logo acima, o único prazo que nenhum rearme de silêncio empurra para a
      // frente. A tela do AGY desenha a barra de tempo a partir daqui — uma contagem regressiva
      // calculada no cliente dessincronizaria em silêncio de qualquer override por env.
      deadline_at: new Date(Date.now() + AGY_HARD_TIMEOUT_MS).toISOString()
    });
  } catch (err) {
    console.error('[Daemon API] Error starting session:', err);
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/matches', async (req, res) => {
  const matchRecord = req.body;

  // O ponto onde o codinome finalmente precisa estar certo: daqui ele vai para o SQLite, para o
  // telão e para a nuvem. A camada 2 foi disparada lá no /api/session/start e teve todo o tempo
  // da forja e da partida para responder — na prática este await custa zero. Nos casos
  // patológicos ele é limitado pelo timeout interno de `moderateRemotely`
  // (BOOTH_MODERATION_L2_TIMEOUT_MS), então não pode pendurar a requisição.
  //
  // Sobrescrever em vez de confiar no que o cliente mandou também fecha um buraco que existia
  // antes desta mudança: um POST direto a este endpoint com qualquer callsign no corpo pulava a
  // moderação inteira. Agora o daemon é a autoridade, não o que chegou na requisição.
  if (pendingModeration) {
    matchRecord.callsign = await pendingModeration.final;
  }

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
    // Sem isto, o veredito do visitante ANTERIOR sobreviveria ao reset e seria aplicado ao
    // callsign do próximo — que é o jeito exato de um visitante inocente herdar o placeholder
    // de quem passou antes dele pela cabine.
    pendingModeration = null;

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

  // O estado do gate vai junto no replay: um cliente que reconecta no meio da forja precisa saber
  // o que ainda falta, e reconstruir isso a partir do histórico de atividades exigiria que ele
  // conhecesse a lista de servidores exigidos, que é do daemon.
  ws.send(JSON.stringify({ type: 'EVENT_AUDIT_STATUS', data: fileWatcher.getAuditStatus() }));

  ws.on('close', () => {
    activeClients.delete(ws);
    console.log(`[Daemon WS] Client disconnected (Total: ${activeClients.size})`);
  });
});

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => {
  console.log(`[Local Bridge Daemon] Running at http://localhost:${PORT}`);
  console.log(`[Local Bridge Daemon] Workspace session path: ${sessionDir}`);

  // `npm start` passa `--env-file-if-exists=.env`, resolvido a partir do CWD -- o mesmo caminho
  // que se lê aqui. Ver `services/env-precedence.ts` para por que este aviso existe.
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const warning = buildShadowWarning(
      findShadowedKeys(parseEnvFile(fs.readFileSync(envPath, 'utf-8')), process.env),
      envPath
    );
    if (warning) console.warn(warning);
  }
});
