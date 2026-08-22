import React, { useState, useEffect } from 'react';
import { Terminal, Copy, Check, Rocket, Cpu, Sparkles, AlertCircle, RefreshCw, Flame, Shield, Gauge, Layers, Play, CheckCircle2, Activity } from 'lucide-react';
import { PilotInfo, EnergySliders, McpServerName, SubagentName, ShipSpecification, FALLBACK_PRESETS } from '@jogo/shared';
import { ENDPOINTS } from '../config.js';

interface HandoffTerminalScreenProps {
  pilot: PilotInfo;
  energySliders: EnergySliders;
  selectedMcps: McpServerName[];
  selectedSubagents: SubagentName[];
  onShipReady: (spec: ShipSpecification) => void;
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
  onShipReady
}: HandoffTerminalScreenProps) {
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [detectedSpec, setDetectedSpec] = useState<ShipSpecification | null>(null);
  const [mcpActivities, setMcpActivities] = useState<McpActivityItem[]>([]);

  const sessionCmd = 'cd /tmp/booth_session && agy';
  const recommendedPrompt = `Sou o piloto ${pilot.callsign} (${pilot.company_canonical}). Forje uma nave de combate calibrando as armas primárias vulcan espalhadas, mísseis secundários pesados e blindagem reforçada com os servidores MCP disponíveis.`;

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
          } else if (msg.type === 'EVENT_MCP_ACTIVITY' && msg.data) {
            setMcpActivities((prev) => {
              // Avoid duplicate logs if identical timestamp and tool
              const exists = prev.some((p) => p.timestamp === msg.data.timestamp && (p.tool === msg.data.tool || p.tool_name === msg.data.tool));
              if (exists) return prev;
              return [msg.data, ...prev.slice(0, 7)];
            });
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

  const copyToClipboard = (text: string, isPrompt = false) => {
    navigator.clipboard.writeText(text);
    if (isPrompt) {
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2000);
    } else {
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 2000);
    }
  };

  const getServerBadge = (serverName: string) => {
    const s = (serverName || '').toLowerCase();
    if (s.includes('weapon')) {
      return {
        name: 'WEAPONS ARSENAL',
        badgeClass: 'bg-[#ff9e0b]/20 text-[#ff9e0b] border-[#ff9e0b]/40',
        borderClass: 'border-[#ff9e0b]/30 bg-[#ff9e0b]/5',
        icon: Flame
      };
    }
    if (s.includes('hull') || s.includes('propulsion')) {
      return {
        name: 'HULL & PROPULSION',
        badgeClass: 'bg-[#38bdf8]/20 text-[#38bdf8] border-[#38bdf8]/40',
        borderClass: 'border-[#38bdf8]/30 bg-[#38bdf8]/5',
        icon: Gauge
      };
    }
    return {
      name: 'CYBERNETICS & SHIELDS',
      badgeClass: 'bg-[#10b981]/20 text-[#10b981] border-[#10b981]/40',
      borderClass: 'border-[#10b981]/30 bg-[#10b981]/5',
      icon: Shield
    };
  };

  const getToolSummary = (act: McpActivityItem): string => {
    const tool = act.tool || act.tool_name || '';
    const result = act.result;
    const args = act.args;

    if (tool === 'configure_primary_cannon') {
      return `Tipo: ${result?.type || args?.type || 'Canhão'} • Dano: ${result?.damage || 35} • Cadência: ${result?.fire_rate || 8}/s • DPS: ${result?.dps_estimate || 280}`;
    }
    if (tool === 'attach_secondary_ordnance') {
      return `Secundária: ${result?.type || args?.type || 'Mísseis'} • Dano: ${result?.damage ?? 100} • Recarga: ${result?.cooldown_seconds ?? 2}s`;
    }
    if (tool === 'tune_thrusters') {
      return `Velocidade: ${result?.speed_px_s || 320} px/s • Hitbox: ${result?.hitbox_radius || 12}px • Aceleração: ${result?.acceleration || 800}`;
    }
    if (tool === 'reinforce_plating') {
      return `Blindagem: ${result?.armor_type || 'Titânio'} • HP Máximo: ${result?.max_hp || 3} • Resistência: ${result?.collision_resistance || '45%'}`;
    }
    if (tool === 'calibrate_energy_barrier') {
      return `Escudo: ${result?.shield_type || 'Defletor'} • Capacidade: ${result?.shield_capacity ?? 1} Escudo(s) • Absorção: 100%`;
    }
    if (tool === 'install_overclock_module') {
      return `Sinergia: ${result?.synergy_name || args?.synergy_candidate || 'Overclock'} (${result?.status || 'UNLOCKED'}) • Modificador: ${result?.modifier_applied || '+20%'} • Bônus: +${result?.bonus_score_pts || 1500} PTS`;
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
                    Classe: <b className="text-[#38bdf8]">{detectedSpec.visuals?.style_name || 'Personalizada'}</b>
                  </p>
                </div>
              </div>

              <span className="text-xs font-mono font-bold px-3 py-1 rounded-full bg-[#10b981]/20 text-[#10b981] border border-[#10b981]/40">
                ✓ PRONTA PARA O COMBATE
              </span>
            </div>

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
                    {detectedSpec.weapons?.primary?.type || 'Laser Contínuo'}
                  </div>
                  <div className="text-[10px] text-[#ff9e0b]">
                    {detectedSpec.weapons?.primary?.damage || 35} DMG / {detectedSpec.weapons?.primary?.fire_rate || 8} RPS
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                  <span className="text-slate-400 flex items-center gap-1.5 mb-1">
                    <Rocket className="w-3.5 h-3.5 text-[#38bdf8]" /> Arma Secundária
                  </span>
                  <div className="font-bold text-white uppercase truncate">
                    {detectedSpec.weapons?.secondary?.type || 'Mísseis Teleguiados'}
                  </div>
                  <div className="text-[10px] text-[#38bdf8]">
                    Dano: {detectedSpec.weapons?.secondary?.damage ?? 100} | Recarga: {detectedSpec.weapons?.secondary?.cooldown_seconds ?? 2}s
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                  <span className="text-slate-400 flex items-center gap-1.5 mb-1">
                    <Gauge className="w-3.5 h-3.5 text-[#38bdf8]" /> Propulsão & Esquiva
                  </span>
                  <div className="font-bold text-white">
                    {detectedSpec.attributes?.speed_px_s || 320} px/s
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
                    {detectedSpec.attributes?.max_hp || 3} HP / {detectedSpec.attributes?.shield_capacity ?? 1} Escudo(s)
                  </div>
                  <div className="text-[10px] text-[#10b981]">
                    Hitbox: {detectedSpec.attributes?.hitbox_radius || 12}px
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
            {/* Step 1: Terminal Station Callout */}
            <div className="space-y-1.5">
              <span className="text-xs font-bold text-[#ff9e0b] uppercase tracking-wider block font-mono flex items-center gap-1.5">
                <Terminal className="w-4 h-4 text-[#ff9e0b]" /> 1. Olhe para a Tela 2 (Estação de Terminal ao lado):
              </span>
              <div className="p-3.5 rounded-xl bg-slate-950/90 border border-[#ff9e0b]/40 text-slate-200 font-mono text-xs flex items-center justify-between">
                <div>
                  <div className="font-bold text-[#ff9e0b]">SESSÃO AUTORIZADA NO ANTIGRAVITY CLI!</div>
                  <div className="text-[11px] text-slate-400">O terminal na Tela 2 já carregou seu piloto e sliders automaticamente.</div>
                </div>
                <button
                  onClick={() => copyToClipboard(sessionCmd)}
                  title="Copiar comando caso queira abrir manualmente"
                  className="p-1.5 px-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition-all flex items-center gap-1 text-[11px] font-mono"
                >
                  {copiedCmd ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedCmd ? 'Copiado!' : 'Copiar cd'}</span>
                </button>
              </div>
            </div>

            {/* Step 2: Natural Language Prompt */}
            <div className="space-y-1.5">
              <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider block font-mono">
                2. Na Tela 2, dê as ordens para a Forja (ou use o prompt sugerido):
              </span>
              <div className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 text-slate-300 font-mono text-xs relative space-y-2">
                <p className="italic text-slate-200 leading-relaxed">
                  "{recommendedPrompt}"
                </p>
                <div className="flex justify-end pt-1">
                  <button
                    onClick={() => copyToClipboard(recommendedPrompt, true)}
                    className="p-1.5 px-3 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition-all flex items-center gap-1.5 text-xs font-mono"
                  >
                    {copiedPrompt ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedPrompt ? 'Copiado!' : 'Copiar Prompt'}</span>
                  </button>
                </div>
              </div>
            </div>

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
                  <div>Aguardando sub-agentes executarem ferramentas MCP no terminal...</div>
                  <div className="text-[10px] text-slate-600">As calibrações de canhões, propulsão e escudos aparecerão aqui em tempo real.</div>
                </div>
              ) : (
                <div className="space-y-2.5 font-mono max-h-48 overflow-y-auto pr-1">
                  {mcpActivities.map((act, index) => {
                    const serverName = act.server || act.server_name || 'mcp';
                    const toolName = act.tool || act.tool_name || 'ferramenta';
                    const badge = getServerBadge(serverName);
                    const Icon = badge.icon;
                    const summary = getToolSummary(act);
                    const timeStr = act.timestamp ? new Date(act.timestamp).toLocaleTimeString() : '';

                    return (
                      <div
                        key={`${act.timestamp}-${index}`}
                        className={`p-3 rounded-xl border transition-all animate-fadeIn ${badge.borderClass}`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-md border uppercase flex items-center gap-1 ${badge.badgeClass}`}>
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
