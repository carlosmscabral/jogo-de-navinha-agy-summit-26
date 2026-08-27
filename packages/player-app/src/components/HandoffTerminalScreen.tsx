import React, { useState, useEffect } from 'react';
import { Terminal, Rocket, AlertCircle, RefreshCw, Flame, Shield, Gauge, Play, CheckCircle2, Activity, Circle, LifeBuoy } from 'lucide-react';
import {
  PilotInfo,
  EnergySliders,
  McpServerName,
  SubagentName,
  ShipSpecification,
  MCP_CATALOG,
  lookupMcpServer,
  lookupMcpTool
} from '@jogo/shared';
import { ENDPOINTS } from '../config.js';

interface HandoffTerminalScreenProps {
  pilot: PilotInfo;
  energySliders: EnergySliders;
  selectedMcps: McpServerName[];
  selectedSubagents: SubagentName[];
  /** Instante absoluto do teto rígido da sessão, devolvido por `POST /api/session/start`. */
  deadlineAt: string | null;
  onShipReady: (spec: ShipSpecification) => void;
}

/** O gate de auditoria como o daemon o publica (`GET /api/session/activity`). */
interface AuditStatus {
  required: string[];
  seen: string[];
  missing: string[];
}

interface SpecRejection {
  reason: 'SCHEMA_INVALID' | 'AUDIT_GATE_FAILED';
  details: string[];
}

/** Os campos que `EVENT_SHIP_READY` carrega quando a nave veio de um preset de emergência. */
interface FallbackInfo {
  preset?: string;
  reason?: string;
}

const SERVER_ICONS: Record<McpServerName, typeof Flame> = {
  'weapons-arsenal': Flame,
  'hull-propulsion': Gauge,
  'cybernetics-shields': Shield
};

/**
 * Um campo que não veio precisa PARECER que não veio.
 *
 * Esta tela costumava preencher toda ausência com um número plausível -- `|| 35` de dano,
 * `|| 320` px/s, `?? 100` de dano secundário, `|| '+20%'` de modificador de sinergia. O visitante
 * lia telemetria inventada como se fosse a calibração da IA, e um bug de payload ficava
 * indistinguível de uma forja bem-sucedida. Travessão em vez de invenção.
 */
const DASH = '—';
function shown(value: unknown): string | number {
  if (value === undefined || value === null || value === '') return DASH;
  if (typeof value === 'number') return Number.isFinite(value) ? value : DASH;
  return String(value);
}

export interface McpActivityItem {
  timestamp: string;
  server?: string;
  server_name?: string;
  tool?: string;
  tool_name?: string;
  args?: any;
  result?: any;
}

export function HandoffTerminalScreen({
  pilot,
  energySliders,
  selectedMcps,
  selectedSubagents,
  deadlineAt,
  onShipReady
}: HandoffTerminalScreenProps) {
  const [detectedSpec, setDetectedSpec] = useState<ShipSpecification | null>(null);
  const [mcpActivities, setMcpActivities] = useState<McpActivityItem[]>([]);
  const [audit, setAudit] = useState<AuditStatus>({
    // Enquanto o daemon não responde, o que o visitante acabou de escolher é a melhor verdade
    // disponível: todos pendentes.
    required: selectedMcps,
    seen: [],
    missing: selectedMcps
  });
  const [rejection, setRejection] = useState<SpecRejection | null>(null);
  const [fallback, setFallback] = useState<FallbackInfo | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Dual-channel detection: WebSocket + HTTP Polling
  useEffect(() => {
    let ws: WebSocket | null = null;
    let pollInterval: any = null;

    try {
      ws = new WebSocket(ENDPOINTS.bridgeWsUrl);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'EVENT_SHIP_READY' && msg.spec) {
            setDetectedSpec(msg.spec);
            // A nave pode ter vindo de um preset de emergência (agy morreu, estourou o teto). O
            // daemon sempre disse isso no payload e a tela nunca contou ao visitante.
            setFallback(
              msg.fallback ? { preset: msg.fallback_preset, reason: msg.fallback_reason } : null
            );
          } else if (msg.type === 'EVENT_MCP_ACTIVITY' && msg.data) {
            setMcpActivities((prev) => {
              // Avoid duplicate logs if identical timestamp and tool
              const exists = prev.some((p) => p.timestamp === msg.data.timestamp && (p.tool === msg.data.tool || p.tool_name === msg.data.tool));
              if (exists) return prev;
              return [msg.data, ...prev.slice(0, 7)];
            });
          } else if (msg.type === 'EVENT_AUDIT_STATUS' && msg.data) {
            setAudit(msg.data);
          } else if (msg.type === 'EVENT_SPEC_REJECTED' && msg.data) {
            // Transmitido desde sempre e ignorado por todos os clientes: sem isto, uma spec
            // recusada deixa a tela parada, indistinguível de um agente que não fez nada.
            setRejection(msg.data);
          }
        } catch {
          // Ignored
        }
      };
    } catch {
      // Ignored
    }

    // Polling fallback every 600ms
    pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`${ENDPOINTS.bridgeBase}/api/session/spec`);
        if (res.ok) {
          const data = await res.json();
          if (data.ready && data.spec) {
            setDetectedSpec(data.spec);
          }
        }

        const actRes = await fetch(`${ENDPOINTS.bridgeBase}/api/session/activity`);
        if (actRes.ok) {
          const actData = await actRes.json();
          if (actData.activity && Array.isArray(actData.activity) && actData.activity.length > 0) {
            setMcpActivities(actData.activity.slice(-8).reverse());
          }
          if (Array.isArray(actData.required)) {
            setAudit({
              required: actData.required,
              seen: actData.seen ?? [],
              missing: actData.missing ?? []
            });
          }
        }
      } catch {
        // Ignored
      }
    }, 600);

    return () => {
      if (ws) ws.close();
      if (pollInterval) clearInterval(pollInterval);
    };
  }, []);

  // Relógio da barra de tempo. 1s basta: o prazo é de minutos e o estande roda em hardware fraco.
  useEffect(() => {
    if (!deadlineAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [deadlineAt]);

  // Spacebar / Enter hotkey to launch game once ship is detected
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.code === 'Space' || e.code === 'Enter') && detectedSpec) {
        onShipReady(detectedSpec);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [detectedSpec, onShipReady]);

  /**
   * Identidade visual de um servidor, por chave exata do catálogo.
   *
   * A versão anterior classificava por `includes()` e tinha um catch-all: qualquer servidor que
   * não casasse com "weapon" nem com "hull" era rotulado "CYBERNETICS & SHIELDS", inclusive um
   * nome desconhecido. Agora um servidor fora do catálogo aparece com o próprio slug, que é
   * honesto — melhor que dizer que ele é um servidor que não é.
   */
  const getServerBadge = (serverName: string) => {
    const entry = lookupMcpServer(serverName);
    const color = entry?.color ?? '#94a3b8';
    return {
      name: entry?.label ?? serverName,
      color,
      icon: SERVER_ICONS[serverName as McpServerName] ?? Activity
    };
  };

  const getToolSummary = (act: McpActivityItem): string => {
    const tool = act.tool || act.tool_name || '';
    const result = act.result;
    const args = act.args;

    if (tool === 'configure_primary_cannon') {
      return `Tipo: ${shown(result?.type ?? args?.type)} • Dano: ${shown(result?.damage)} • Cadência: ${shown(result?.fire_rate)}/s • DPS: ${shown(result?.dps_estimate)}`;
    }
    if (tool === 'attach_secondary_ordnance') {
      return `Secundária: ${shown(result?.type ?? args?.type)} • Dano: ${shown(result?.damage)} • Recarga: ${shown(result?.cooldown_seconds)}s`;
    }
    if (tool === 'tune_thrusters') {
      return `Velocidade: ${shown(result?.speed_px_s)} px/s • Hitbox: ${shown(result?.hitbox_radius)}px • Aceleração: ${shown(result?.acceleration)}`;
    }
    if (tool === 'reinforce_plating') {
      return `Blindagem: ${shown(result?.armor_type)} • HP Máximo: ${shown(result?.max_hp)} • Resistência: ${shown(result?.collision_resistance)}`;
    }
    if (tool === 'calibrate_energy_barrier') {
      return `Escudo: ${shown(result?.shield_type)} • Capacidade: ${shown(result?.shield_capacity)} Escudo(s)`;
    }
    if (tool === 'install_overclock_module') {
      return `Sinergia: ${shown(result?.synergy_name ?? args?.synergy_candidate)} (${shown(result?.status)}) • Modificador: ${shown(result?.modifier_applied)} • Bônus: ${shown(result?.bonus_score_pts)} PTS`;
    }

    if (result && typeof result === 'object') {
      return Object.entries(result).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(' • ');
    }
    return 'Calibração e telemetria sincronizadas com sucesso.';
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 select-none overflow-y-auto font-sans">
      <div className="w-full max-w-4xl flight-panel p-8 rounded-3xl border border-slate-700/60 shadow-2xl space-y-6 my-4">
        {/* Header */}
        <div className="flex justify-between items-center pb-4 border-b border-slate-700/60">
          <div>
            <div className="flex items-center gap-2 mb-1 font-mono">
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-md bg-[#38bdf8]/10 text-[#38bdf8] border border-[#38bdf8]/30 uppercase tracking-widest">
                Etapa 4 de 4 // Terminal AGY
              </span>
              <span className="text-xs text-slate-400">Google Cloud Summit 2026</span>
            </div>
            <h2 className="text-2xl font-black text-white tracking-wider uppercase">
              FORJA NO ANTIGRAVITY CLI
            </h2>
          </div>

          <div className="text-right font-mono">
            <div className="text-xs text-slate-400 uppercase">Piloto</div>
            <div className="text-sm font-bold text-[#ff9e0b]">
              {pilot.callsign} <span className="text-slate-400 font-normal">({pilot.company_canonical})</span>
            </div>
          </div>
        </div>

        {/* SHIP READY INSPECTION OVERLAY */}
        {detectedSpec ? (
          <div className="p-6 rounded-2xl bg-slate-900/90 border-2 border-[#10b981] shadow-[0_0_40px_rgba(16,185,129,0.3)] space-y-5 animate-fadeIn">
            <div className="flex items-center justify-between pb-3 border-b border-slate-700/60">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-[#10b981]/20 border border-[#10b981]/40 text-[#10b981]">
                  <Rocket className="w-5 h-5 animate-bounce" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white uppercase tracking-wider font-mono">
                    NAVE HOMOLOGADA COM SUCESSO!
                  </h3>
                  <p className="text-xs text-slate-400 font-mono">
                    Classe: <b className="text-[#38bdf8]">{shown(detectedSpec.visuals?.style_name)}</b>
                  </p>
                </div>
              </div>

              <span className="text-xs font-mono font-bold px-3 py-1 rounded-full bg-[#10b981]/20 text-[#10b981] border border-[#10b981]/40">
                ✓ PRONTA PARA O COMBATE
              </span>
            </div>

            {/* Preset de emergência: o daemon sempre mandou `fallback`/`fallback_preset`/
                `fallback_reason` no EVENT_SHIP_READY, e a tela nunca contou. Uma nave de preset
                parecia exatamente uma nave forjada. */}
            {fallback && (
              <div className="p-4 rounded-xl bg-[#ff9e0b]/10 border border-[#ff9e0b]/40 flex items-start gap-3">
                <LifeBuoy className="w-5 h-5 text-[#ff9e0b] shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-bold text-[#ff9e0b]">
                    Esta nave veio de um preset de emergência
                    {fallback.preset ? `: ${fallback.preset}` : ''}.
                  </div>
                  <div className="text-xs text-slate-400 font-mono">
                    {fallback.reason ?? 'A forja não concluiu a tempo — você voa com a nave padrão.'}
                  </div>
                </div>
              </div>
            )}

            {/* Ship Visual & Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
              {/* SVG Fuselage Preview (4 cols) */}
              <div className="md:col-span-4 flex flex-col items-center justify-center p-4 rounded-2xl bg-slate-950/80 border border-slate-800 h-48 relative overflow-hidden">
                <div className="absolute inset-0 bg-radial from-[#38bdf8]/10 via-transparent to-transparent pointer-events-none" />
                <svg viewBox="0 0 100 100" className="w-28 h-28 drop-shadow-[0_0_20px_rgba(56,189,248,0.6)]">
                  {/* Outer Wings */}
                  <polygon
                    points="50,15 15,75 35,68 50,85 65,68 85,75"
                    fill={detectedSpec.visuals?.primary_color || '#ff9e0b'}
                    stroke="#ffffff"
                    strokeWidth="1.5"
                  />
                  {/* Cockpit Canopy */}
                  <polygon
                    points="50,30 40,62 50,56 60,62"
                    fill={detectedSpec.visuals?.secondary_color || '#38bdf8'}
                    stroke="#ffffff"
                    strokeWidth="1"
                  />
                  {/* Engine Thrusters */}
                  <ellipse cx="50" cy="85" rx="6" ry="3" fill="#ff9e0b" className="animate-pulse" />
                </svg>
                <span className="text-[10px] font-mono text-slate-400 mt-2 uppercase">
                  Fuselagem Vetorial SVG
                </span>
              </div>

              {/* Stats & Weapons (8 cols) */}
              <div className="md:col-span-8 grid grid-cols-2 gap-2.5 font-mono text-xs">
                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                  <span className="text-slate-400 flex items-center gap-1.5 mb-1">
                    <Flame className="w-3.5 h-3.5 text-[#ff9e0b]" /> Arma Primária
                  </span>
                  <div className="font-bold text-white uppercase truncate">
                    {shown(detectedSpec.weapons?.primary?.type)}
                  </div>
                  <div className="text-[10px] text-[#ff9e0b]">
                    {shown(detectedSpec.weapons?.primary?.damage)} DMG / {shown(detectedSpec.weapons?.primary?.fire_rate)} RPS
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                  <span className="text-slate-400 flex items-center gap-1.5 mb-1">
                    <Rocket className="w-3.5 h-3.5 text-[#38bdf8]" /> Arma Secundária
                  </span>
                  <div className="font-bold text-white uppercase truncate">
                    {shown(detectedSpec.weapons?.secondary?.type)}
                  </div>
                  <div className="text-[10px] text-[#38bdf8]">
                    Dano: {shown(detectedSpec.weapons?.secondary?.damage)} | Recarga: {shown(detectedSpec.weapons?.secondary?.cooldown_seconds)}s
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                  <span className="text-slate-400 flex items-center gap-1.5 mb-1">
                    <Gauge className="w-3.5 h-3.5 text-[#38bdf8]" /> Propulsão & Esquiva
                  </span>
                  <div className="font-bold text-white">
                    {shown(detectedSpec.attributes?.speed_px_s)} px/s
                  </div>
                  <div className="text-[10px] text-slate-400">
                    Velocidade Linear Calibrada
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                  <span className="text-slate-400 flex items-center gap-1.5 mb-1">
                    <Shield className="w-3.5 h-3.5 text-[#10b981]" /> Blindagem & Escudo
                  </span>
                  <div className="font-bold text-white">
                    {shown(detectedSpec.attributes?.max_hp)} HP / {shown(detectedSpec.attributes?.shield_capacity)} Escudo(s)
                  </div>
                  <div className="text-[10px] text-[#10b981]">
                    Hitbox: {shown(detectedSpec.attributes?.hitbox_radius)}px
                  </div>
                </div>
              </div>
            </div>

            {/* Big Launch Button */}
            <button
              onClick={() => onShipReady(detectedSpec)}
              className="w-full p-4 rounded-2xl bg-gradient-to-r from-[#10b981] to-[#38bdf8] text-black font-black text-sm uppercase tracking-widest hover:scale-[1.02] transition-all shadow-[0_0_35px_rgba(16,185,129,0.6)] flex items-center justify-center gap-3 font-mono"
            >
              <Play className="w-5 h-5 fill-black" />
              <span>PRESSIONE [ ESPAÇO ] OU CLIQUE PARA DECOLAR AGORA!</span>
            </button>
          </div>
        ) : (
          /* WAITING FOR TERMINAL INSTRUCTIONS */
          <div className="space-y-4">
            {/* Onde olhar. A sessão já está aberta — o booth-terminal.sh a abre sozinho. */}
            <div className="p-4 rounded-xl bg-slate-950/90 border border-[#ff9e0b]/40 flex items-center gap-3">
              <Terminal className="w-6 h-6 text-[#ff9e0b] shrink-0" />
              <div>
                <div className="text-base font-bold text-[#ff9e0b]">
                  Converse com o <code className="font-mono">agy</code> no terminal ao lado.
                </div>
                <div className="text-sm text-slate-400">
                  A sessão já abriu com o seu piloto e a sua distribuição de energia carregados.
                </div>
              </div>
            </div>

            {/* Prazo real da sessão, vindo do daemon. */}
            <SessionTimeBar deadlineAt={deadlineAt} now={now} />

            {/* Recusa na auditoria: o daemon transmite, e até agora ninguém escutava. */}
            {rejection && (
              <div className="p-4 rounded-xl bg-[#ef4444]/10 border border-[#ef4444]/40 space-y-1">
                <div className="flex items-center gap-2 text-base font-bold text-[#ef4444]">
                  <AlertCircle className="w-5 h-5" />
                  <span>A nave foi recusada na auditoria; o agente está corrigindo.</span>
                </div>
                <ul className="text-xs text-slate-400 font-mono list-disc list-inside">
                  {rejection.details.slice(0, 4).map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Checklist do gate: é o mesmo critério que libera a nave. */}
            <McpChecklist audit={audit} activities={mcpActivities} />

            {/* LIVE MCP ACTIVITY TELEMETRY FEED */}
            <div className="space-y-3 bg-slate-950/90 p-5 rounded-2xl border border-slate-800 shadow-inner">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800 font-mono">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#10b981] opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-[#10b981]" />
                  </span>
                  <span className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                    <Activity className="w-4 h-4 text-[#ff9e0b]" /> Telemetria de Uso dos Servidores MCP
                  </span>
                </div>

                <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono">
                  <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300">
                    {mcpActivities.length} {mcpActivities.length === 1 ? 'execução' : 'execuções'}
                  </span>
                  <span className="flex items-center gap-1 text-[#38bdf8]">
                    <RefreshCw className="w-3 h-3 animate-spin" /> mcp_audit.log
                  </span>
                </div>
              </div>

              {mcpActivities.length === 0 ? (
                <div className="text-center py-6 text-xs text-slate-500 italic font-mono space-y-1">
                  {/* Sub-agente não chama ferramenta: o protocolo do GEMINI.md proíbe, quem chama
                      é o agente principal. A copy anterior descrevia um fluxo que não existe. */}
                  <div>Aguardando o agente principal chamar as ferramentas MCP...</div>
                  <div className="text-[10px] text-slate-600">As calibrações de canhões, propulsão e escudos aparecerão aqui em tempo real.</div>
                </div>
              ) : (
                <div className="space-y-2.5 font-mono max-h-48 overflow-y-auto pr-1">
                  {mcpActivities.map((act, index) => {
                    const serverName = act.server || act.server_name || 'mcp';
                    const rawTool = act.tool || act.tool_name || '';
                    const toolName = lookupMcpTool(rawTool)?.label ?? rawTool ?? 'ferramenta';
                    const badge = getServerBadge(serverName);
                    const Icon = badge.icon;
                    const summary = getToolSummary(act);
                    const timeStr = act.timestamp ? new Date(act.timestamp).toLocaleTimeString() : '';

                    return (
                      <div
                        key={`${act.timestamp}-${index}`}
                        className="p-3 rounded-xl border transition-all animate-fadeIn"
                        style={{ borderColor: `${badge.color}4d`, backgroundColor: `${badge.color}0d` }}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <span
                              className="text-[10px] font-black px-2 py-0.5 rounded-md border uppercase flex items-center gap-1"
                              style={{ color: badge.color, borderColor: `${badge.color}66`, backgroundColor: `${badge.color}26` }}
                            >
                              <Icon className="w-3 h-3" /> {badge.name}
                            </span>
                            <span className="text-xs font-bold text-white tracking-wide">
                              {toolName}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-[#10b981] bg-[#10b981]/15 px-2 py-0.5 rounded border border-[#10b981]/30 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> EXECUTADO
                            </span>
                            {timeStr && <span className="text-[10px] text-slate-500">{timeStr}</span>}
                          </div>
                        </div>

                        {/* Parameter Summary */}
                        <div className="text-[11px] text-slate-300 bg-slate-950/80 p-2 rounded-lg border border-slate-800/80">
                          {summary}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Escala da barra de tempo: o teto rígido padrão do daemon (`AGY_HARD_TIMEOUT_MS`, 165s). Um
 * override por env muda o prazo real, e por isso a contagem em si vem do `deadline_at` absoluto —
 * a barra pode começar cheia demais ou curta demais, o número ao lado nunca mente.
 */
const TIME_BAR_SCALE_MS = 165_000;

/**
 * Barra do prazo da sessão, ancorada no `deadline_at` que o daemon devolveu.
 *
 * Não existe barra de "progresso da forja": o agente pode chamar de 3 a 6 ferramentas e o gate
 * precisa de uma por servidor, então não há total contra o qual medir. Tempo, sim, tem total.
 */
function SessionTimeBar({ deadlineAt, now }: { deadlineAt: string | null; now: number }) {
  if (!deadlineAt) return null;
  const end = new Date(deadlineAt).getTime();
  if (!Number.isFinite(end)) return null;

  const remainingMs = Math.max(0, end - now);
  const seconds = Math.ceil(remainingMs / 1000);
  // A janela total não é conhecida pelo cliente; usa-se o maior restante já visto como escala.
  const pct = Math.max(0, Math.min(100, (remainingMs / TIME_BAR_SCALE_MS) * 100));
  const critical = seconds <= 30;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm font-mono">
        <span className="text-slate-400 uppercase tracking-wider">Tempo da sessão</span>
        <span className={critical ? 'text-[#ef4444] font-bold' : 'text-slate-300'}>
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
        </span>
      </div>
      <div className="h-2 rounded-full bg-slate-900 border border-slate-800 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-1000 ease-linear"
          style={{ width: `${pct}%`, backgroundColor: critical ? '#ef4444' : '#38bdf8' }}
        />
      </div>
    </div>
  );
}

/**
 * O gate de auditoria, linha a linha: cada servidor que o visitante escolheu, com o resumo real
 * da ferramenta assim que ela reporta. É literalmente o que o daemon exige para liberar a nave.
 */
function McpChecklist({ audit, activities }: { audit: AuditStatus; activities: McpActivityItem[] }) {
  const all = Object.keys(MCP_CATALOG) as McpServerName[];

  return (
    <div className="space-y-2">
      <span className="text-sm font-bold text-slate-300 uppercase tracking-wider font-mono">
        Servidores exigidos por esta sessão
      </span>
      {all.map((name) => {
        const entry = MCP_CATALOG[name];
        const required = audit.required.includes(name);
        const done = audit.seen.includes(name);
        const Icon = SERVER_ICONS[name];
        const last = activities.find((a) => (a.server || a.server_name) === name);

        return (
          <div
            key={name}
            className="p-3 rounded-xl border flex items-center gap-3"
            style={{
              borderColor: required ? `${entry.color}4d` : '#1e293b',
              backgroundColor: required ? `${entry.color}0d` : 'transparent',
              opacity: required ? 1 : 0.45
            }}
          >
            <Icon className="w-5 h-5 shrink-0" style={{ color: entry.color }} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-white">{entry.label}</div>
              <div className="text-xs text-slate-400 truncate font-mono">
                {!required
                  ? 'Não selecionado nesta sessão'
                  : done
                    ? last
                      ? `${lookupMcpTool(last.tool || last.tool_name || '')?.label ?? last.tool ?? ''} reportou`
                      : 'Reportou'
                    : 'Aguardando'}
              </div>
            </div>
            {required &&
              (done ? (
                <CheckCircle2 className="w-5 h-5 text-[#10b981] shrink-0" />
              ) : (
                <Circle className="w-5 h-5 text-slate-600 animate-pulse shrink-0" />
              ))}
          </div>
        );
      })}
    </div>
  );
}
