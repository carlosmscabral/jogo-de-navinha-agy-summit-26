import React, { useState, useEffect } from 'react';
import { Terminal, Copy, Check, Rocket, Cpu, Sparkles, AlertCircle, RefreshCw, Flame, Shield, Gauge, Layers, Play } from 'lucide-react';
import { PilotInfo, EnergySliders, McpServerName, SubagentName, ShipSpecification, FALLBACK_PRESETS } from '@jogo/shared';

interface HandoffTerminalScreenProps {
  pilot: PilotInfo;
  energySliders: EnergySliders;
  selectedMcps: McpServerName[];
  selectedSubagents: SubagentName[];
  onShipReady: (spec: ShipSpecification) => void;
  onEmergencyFallback: () => void;
}

export function HandoffTerminalScreen({
  pilot,
  energySliders,
  selectedMcps,
  selectedSubagents,
  onShipReady,
  onEmergencyFallback
}: HandoffTerminalScreenProps) {
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [detectedSpec, setDetectedSpec] = useState<ShipSpecification | null>(null);
  const [mcpActivities, setMcpActivities] = useState<{ id: string; tool_name: string; timestamp: string; server_name?: string }[]>([]);

  const sessionCmd = 'cd /tmp/booth_session && agy';
  const recommendedPrompt = `Sou o piloto ${pilot.callsign} (${pilot.company_canonical}). Forje uma nave de combate calibrando as armas primárias vulcan espalhadas, mísseis secundários pesados e blindagem reforçada com os servidores MCP disponíveis.`;

  // Dual-channel detection: WebSocket + HTTP Polling
  useEffect(() => {
    let ws: WebSocket | null = null;
    let pollInterval: any = null;

    try {
      ws = new WebSocket('ws://localhost:3000/pty');
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'EVENT_SHIP_READY' && msg.spec) {
            setDetectedSpec(msg.spec);
          } else if (msg.type === 'EVENT_MCP_ACTIVITY' && msg.data) {
            setMcpActivities((prev) => [msg.data, ...prev.slice(0, 7)]);
          }
        } catch {
          // Ignored
        }
      };
    } catch {
      // Ignored
    }

    // Polling fallback every 800ms
    pollInterval = setInterval(async () => {
      try {
        const res = await fetch('http://localhost:3000/api/session/spec');
        if (res.ok) {
          const data = await res.json();
          if (data.ready && data.spec) {
            setDetectedSpec(data.spec);
          }
        }

        const actRes = await fetch('http://localhost:3000/api/session/activity');
        if (actRes.ok) {
          const actData = await actRes.json();
          if (actData.activity && actData.activity.length > 0) {
            setMcpActivities(actData.activity.slice(0, 8));
          }
        }
      } catch {
        // Ignored
      }
    }, 800);

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
                    {detectedSpec.weapons?.primary?.damage || 35} DMG / {detectedSpec.weapons?.primary?.fire_rate || 60} RPM
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
                    Dano: {detectedSpec.weapons?.secondary?.damage || 120} | Cooldown: {detectedSpec.weapons?.secondary?.cooldown_seconds || 2}s
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
                    {detectedSpec.attributes?.max_hp || 3} HP / {detectedSpec.attributes?.shield_capacity || 1} Escudo(s)
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
              className="w-full p-4 rounded-2xl bg-gradient-to-r from-[#10b981] to-[#38bdf8] text-black font-black text-sm uppercase tracking-widest hover:scale-[1.02] transition-all shadow-[0_0_35px_rgba(16,185,129,0.6)] flex items-center justify-center gap-3"
            >
              <Play className="w-5 h-5 fill-black" />
              <span>PRESSIONE [ ESPAÇO ] OU CLIQUE PARA DECOLAR AGORA!</span>
            </button>
          </div>
        ) : (
          /* WAITING FOR TERMINAL INSTRUCTIONS */
          <div className="space-y-4">
            {/* Step 1: Terminal Command */}
            <div className="space-y-1.5">
              <span className="text-xs font-bold text-[#ff9e0b] uppercase tracking-wider block font-mono">
                1. No seu terminal aberto, acesse o workspace e digite:
              </span>
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 text-white font-mono text-sm">
                <code className="text-[#38bdf8]">{sessionCmd}</code>
                <button
                  onClick={() => copyToClipboard(sessionCmd)}
                  className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white transition-all flex items-center gap-1.5 text-xs font-mono"
                >
                  {copiedCmd ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedCmd ? 'Copiado!' : 'Copiar'}</span>
                </button>
              </div>
            </div>

            {/* Step 2: Natural Language Prompt */}
            <div className="space-y-1.5">
              <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider block font-mono">
                2. Converse com os sub-agentes no AGY:
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

            {/* Live MCP Activity Telemetry */}
            <div className="space-y-2 bg-slate-900/60 p-4 rounded-2xl border border-slate-800">
              <div className="flex items-center justify-between font-mono">
                <span className="text-xs font-bold text-[#ff9e0b] uppercase flex items-center gap-1.5">
                  <Cpu className="w-4 h-4" /> Telemetria de Calibração MCP ao Vivo:
                </span>
                <span className="text-[10px] text-slate-400 flex items-center gap-1">
                  <RefreshCw className="w-3 h-3 animate-spin text-[#38bdf8]" /> Monitorando mcp_audit.log
                </span>
              </div>

              {mcpActivities.length === 0 ? (
                <div className="text-center py-4 text-xs text-slate-500 italic font-mono">
                  Aguardando execução de ferramentas no terminal AGY...
                </div>
              ) : (
                <div className="space-y-1.5 font-mono text-xs max-h-32 overflow-y-auto">
                  {mcpActivities.map((act) => (
                    <div key={act.id} className="flex items-center justify-between p-2 rounded-lg bg-slate-950/80 border border-slate-800">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-[#10b981] animate-ping" />
                        <span className="font-bold text-[#38bdf8]">{act.tool_name}</span>
                        <span className="text-[10px] text-slate-400">({act.server_name || 'mcp'})</span>
                      </div>
                      <span className="text-[10px] text-slate-500">
                        {new Date(act.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Fallback Option */}
            <div className="pt-2 flex justify-between items-center text-xs text-slate-400 font-mono">
              <span>Demorando ou sem conexão no terminal?</span>
              <button
                onClick={onEmergencyFallback}
                className="text-[#ff9e0b] hover:underline font-bold"
              >
                Decolar com Nave Balanceada Padrão ➔
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
