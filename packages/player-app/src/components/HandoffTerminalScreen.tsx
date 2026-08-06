import React, { useEffect, useState, useRef } from 'react';
import { ShipSpecification, PilotInfo, EnergySliders, McpServerName, SubagentName, FALLBACK_PRESETS } from '@jogo/shared';
import { Terminal, Shield, Zap, Rocket, Cpu, CheckCircle2, Loader2, Play, Sparkles, ArrowRight, Activity, Flame, Crosshair, Award } from 'lucide-react';
import { audioManager } from '../game/audio/AudioManager.js';

interface HandoffTerminalScreenProps {
  pilot: PilotInfo;
  energySliders?: EnergySliders;
  selectedMcps?: McpServerName[];
  selectedSubagents?: SubagentName[];
  onShipReady: (spec: ShipSpecification) => void;
  onEmergencyFallback: () => void;
}

interface McpLogItem {
  timestamp: string;
  server: string;
  tool: string;
  args?: any;
  result?: any;
}

export function HandoffTerminalScreen({
  pilot,
  energySliders = { offense: 35, speed: 35, defense: 15, tech: 15 },
  selectedMcps = ['weapons-arsenal', 'hull-propulsion', 'cybernetics-shields'],
  selectedSubagents = ['aesthetic-designer', 'combat-strategist'],
  onShipReady,
  onEmergencyFallback
}: HandoffTerminalScreenProps) {
  const [sessionPath] = useState('/tmp/booth_session');
  const [mcpLogs, setMcpLogs] = useState<McpLogItem[]>([]);
  const [readySpec, setReadySpec] = useState<ShipSpecification | null>(null);
  const [copiedPromptIndex, setCopiedPromptIndex] = useState<number | null>(null);

  const PROMPT_SUGGESTIONS = [
    {
      title: 'Laser Piercer Ultra',
      tag: 'DPS & Velocidade',
      text: 'Quero um caça ultrarrápido com lasers azuis contínuos, velocidade máxima e escudo duplo.'
    },
    {
      title: 'Heavy Missile Bomber',
      tag: 'Blindagem & Mísseis',
      text: 'Forje um bombardeiro pesado com blindagem reforçada e chuva de mísseis teleguiados.'
    },
    {
      title: 'Cyberpunk Vulcan Spread',
      tag: 'Tiro Triplo em Leque',
      text: 'Estilo Cyberpunk Gold com canhões vulcan espalhados e sinergia Glass Cannon.'
    },
    {
      title: 'Dark Void Stealth EMP',
      tag: 'Furtividade & EMP',
      text: 'Caça furtivo Dark Void com propulsores ágeis e pulso EMP de choque eletromagnético.'
    },
    {
      title: 'Synthwave Drone Escort',
      tag: 'Equilíbrio & Drones',
      text: 'Nave Synthwave 80s balanceada com drones de escolta e canhão de plasma penetrante.'
    }
  ];

  const handleShipReadyEvent = (spec: ShipSpecification) => {
    if (!readySpec) {
      console.log('[HandoffScreen] Ship spec loaded for inspection:', spec);
      setReadySpec(spec);
      audioManager.playLaser();
    }
  };

  // Keyboard shortcut listener for Space or Enter when ship is ready
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (readySpec && (e.code === 'Space' || e.code === 'Enter')) {
        e.preventDefault();
        onShipReady(readySpec);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [readySpec, onShipReady]);

  useEffect(() => {
    // 1. WebSocket Listener for live MCP activity & ship completion
    const ws = new WebSocket('ws://localhost:3000/pty');

    ws.onopen = () => {
      console.log('[HandoffScreen] Connected to daemon event stream');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'EVENT_SHIP_READY' && msg.spec) {
          handleShipReadyEvent(msg.spec);
        } else if (msg.type === 'EVENT_MCP_ACTIVITY' && msg.data) {
          setMcpLogs((prev) => [msg.data, ...prev.slice(0, 15)]);
        }
      } catch {
        // Ignored
      }
    };

    // 2. HTTP Polling Backup (checks GET /api/session/spec every 800ms)
    const pollTimer = setInterval(async () => {
      if (readySpec) return;

      try {
        const res = await fetch('http://localhost:3000/api/session/spec');
        if (res.ok) {
          const data = await res.json();
          if (data.ready && data.spec) {
            handleShipReadyEvent(data.spec);
          }
        }
      } catch {
        // Daemon restarting
      }
    }, 800);

    return () => {
      ws.close();
      clearInterval(pollTimer);
    };
  }, [readySpec]);

  const handleCopyPrompt = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedPromptIndex(index);
    setTimeout(() => setCopiedPromptIndex(null), 2000);
  };

  const handleSimulateForge = () => {
    const customSpec: ShipSpecification = JSON.parse(JSON.stringify(FALLBACK_PRESETS.interceptor));
    customSpec.pilot.callsign = pilot.callsign;
    customSpec.pilot.company_canonical = pilot.company_canonical;
    customSpec.visuals.style_name = `${pilot.callsign}-01 Custom Interceptor`;
    handleShipReadyEvent(customSpec);
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 relative bg-radial from-[#100826] via-[#050310] to-[#020108] overflow-y-auto select-none font-mono">
      {/* Background Animated Glows */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#00f3ff]/10 rounded-full blur-3xl pointer-events-none animate-pulse" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-[#ff0055]/10 rounded-full blur-3xl pointer-events-none animate-pulse" />

      <div className="w-full max-w-5xl flex flex-col gap-6 z-10">
        {/* Header Bar */}
        <div className="flex items-center justify-between p-5 rounded-2xl bg-black/60 border border-white/15 backdrop-blur-xl shadow-2xl">
          <div className="flex items-center gap-4">
            <div className="p-3.5 rounded-xl bg-[#00f3ff]/15 border border-[#00f3ff]/40 text-[#00f3ff]">
              <Terminal className="w-7 h-7" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-[#00f3ff]/20 text-[#00f3ff] border border-[#00f3ff]/30 uppercase tracking-widest">
                  Fase 3 // Forja Ativa
                </span>
                <span className="text-xs text-gray-400">Google Cloud Summit 2026</span>
              </div>
              <h1 className="text-xl font-black text-white tracking-wider uppercase mt-0.5">
                ANTIGRAVITY CLI // TERMINAL HANDOFF
              </h1>
            </div>
          </div>

          <div className="text-right">
            <div className="text-xs text-gray-400 uppercase">Piloto Autenticado</div>
            <div className="text-sm font-bold text-[#00f3ff]">
              {pilot.callsign} <span className="text-gray-400 font-normal">({pilot.company_canonical})</span>
            </div>
          </div>
        </div>

        {/* IF SHIP IS READY: SHOW SHIP INSPECTION & LAUNCH SCREEN */}
        {readySpec ? (
          <div className="p-7 rounded-3xl bg-black/80 border-2 border-emerald-500/60 shadow-2xl shadow-emerald-500/20 backdrop-blur-2xl flex flex-col gap-6 animate-fadeIn">
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-widest">
                    TELEMETRIA SINCRONIZADA
                  </span>
                  <h2 className="text-2xl font-black text-white uppercase tracking-wider">
                    {readySpec.visuals.style_name || 'Nave Customizada'}
                  </h2>
                </div>
              </div>

              <div className="px-3.5 py-1.5 rounded-xl bg-[#ffd700]/15 border border-[#ffd700]/40 text-[#ffd700] font-bold text-xs flex items-center gap-1.5">
                <Award className="w-4 h-4" />
                <span>{readySpec.build_metadata?.synergies_unlocked?.[0] || 'Sinergia Ativada'}</span>
              </div>
            </div>

            {/* Ship Visual & Attributes Grid */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
              {/* SVG Ship Canvas Preview (4 cols) */}
              <div className="md:col-span-4 flex flex-col items-center justify-center p-6 rounded-2xl bg-gradient-to-b from-black/80 to-[#0a0520] border border-[#00f3ff]/30 shadow-inner relative overflow-hidden">
                <div className="w-36 h-36 relative flex items-center justify-center">
                  {/* Engine Thruster Glow */}
                  <div
                    className="absolute -bottom-2 w-12 h-16 rounded-full blur-md animate-pulse opacity-90"
                    style={{ backgroundColor: readySpec.visuals.engine_trail_color || '#00f3ff' }}
                  />
                  <svg viewBox="0 0 128 128" className="w-full h-full drop-shadow-[0_0_15px_rgba(0,243,255,0.7)]">
                    <path
                      d={readySpec.visuals.svg_path_data || 'M 64 10 L 114 110 L 64 85 L 14 110 Z'}
                      fill={readySpec.visuals.primary_color || '#ff0055'}
                      stroke={readySpec.visuals.secondary_color || '#00f3ff'}
                      strokeWidth="3.5"
                    />
                  </svg>
                </div>
                <span className="text-[11px] text-gray-400 uppercase tracking-widest mt-3">
                  Design por aesthetic-designer
                </span>
              </div>

              {/* Attributes Specs (8 cols) */}
              <div className="md:col-span-8 grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="p-3.5 rounded-xl bg-white/[0.04] border border-white/10 flex flex-col">
                  <span className="text-[10px] text-gray-400 uppercase flex items-center gap-1">
                    <Crosshair className="w-3 h-3 text-[#ff0055]" /> Arma Primária
                  </span>
                  <span className="text-sm font-bold text-white uppercase mt-1">
                    {readySpec.weapons.primary.type}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    Cadência: {readySpec.weapons.primary.fire_rate}/s | Dano: {readySpec.weapons.primary.damage}
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-white/[0.04] border border-white/10 flex flex-col">
                  <span className="text-[10px] text-gray-400 uppercase flex items-center gap-1">
                    <Rocket className="w-3 h-3 text-[#ffd700]" /> Arma Secundária
                  </span>
                  <span className="text-sm font-bold text-white uppercase mt-1">
                    {readySpec.weapons.secondary.type}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    Dano: {readySpec.weapons.secondary.damage} | Cooldown: {readySpec.weapons.secondary.cooldown_seconds}s
                  </span>
                </div>

                <div className="p-3.5 rounded-xl bg-white/[0.04] border border-white/10 flex flex-col">
                  <span className="text-[10px] text-gray-400 uppercase flex items-center gap-1">
                    <Zap className="w-3 h-3 text-[#00f3ff]" /> Velocidade Máxima
                  </span>
                  <span className="text-sm font-bold text-white uppercase mt-1">
                    {readySpec.attributes.speed_px_s} px/s
                  </span>
                  <span className="text-[10px] text-gray-400">Agilidade turbo</span>
                </div>

                <div className="p-3.5 rounded-xl bg-white/[0.04] border border-white/10 flex flex-col">
                  <span className="text-[10px] text-gray-400 uppercase flex items-center gap-1">
                    <Shield className="w-3 h-3 text-[#00ff88]" /> Blindagem do Casco
                  </span>
                  <span className="text-sm font-bold text-white uppercase mt-1">
                    {readySpec.attributes.max_hp} HP
                  </span>
                  <span className="text-[10px] text-gray-400">Liga leve de titânio</span>
                </div>

                <div className="p-3.5 rounded-xl bg-white/[0.04] border border-white/10 flex flex-col">
                  <span className="text-[10px] text-gray-400 uppercase flex items-center gap-1">
                    <Cpu className="w-3 h-3 text-[#00f3ff]" /> Escudo Energético
                  </span>
                  <span className="text-sm font-bold text-white uppercase mt-1">
                    {readySpec.attributes.shield_capacity} Barreira(s)
                  </span>
                  <span className="text-[10px] text-gray-400">Recarga cibernética</span>
                </div>

                <div className="p-3.5 rounded-xl bg-white/[0.04] border border-white/10 flex flex-col">
                  <span className="text-[10px] text-gray-400 uppercase flex items-center gap-1">
                    <Flame className="w-3 h-3 text-[#ff0055]" /> DPS Estimado
                  </span>
                  <span className="text-sm font-bold text-[#ff0055] uppercase mt-1">
                    {readySpec.weapons.primary.damage * readySpec.weapons.primary.fire_rate} DPS
                  </span>
                  <span className="text-[10px] text-gray-400">Poder de fogo</span>
                </div>
              </div>
            </div>

            {/* Launch CTA */}
            <div className="pt-2 flex flex-col items-center gap-2">
              <button
                onClick={() => onShipReady(readySpec)}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-[#00ff88] via-[#00f3ff] to-[#ff0055] text-black font-black text-base uppercase tracking-wider hover:scale-[1.01] transition-all shadow-[0_0_30px_rgba(0,255,136,0.6)] flex items-center justify-center gap-3 animate-pulse"
              >
                <span>🚀 PRESSIONE [ESPAÇO] OU CLIQUE AQUI PARA DECOLAR!</span>
                <ArrowRight className="w-5 h-5 stroke-[3]" />
              </button>
              <span className="text-xs text-gray-400">Sua nave está armada e pronta para o combate de 90 segundos!</span>
            </div>
          </div>
        ) : (
          /* WAITING FOR AGY: INSTRUCTIONS + LIVE MCP FEED */
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            {/* Left Column: Instructions (7 cols) */}
            <div className="md:col-span-7 flex flex-col gap-4 p-6 rounded-2xl bg-black/70 border border-[#00f3ff]/30 backdrop-blur-xl shadow-2xl">
              <div className="flex items-center justify-between pb-3 border-b border-white/10">
                <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#ffd700]" />
                  Instruções de Forja no Terminal
                </h2>
                <div className="flex items-center gap-1.5 text-xs text-[#00f3ff] animate-pulse font-bold">
                  <span className="w-2 h-2 rounded-full bg-[#00f3ff]" />
                  AGUARDANDO AGY
                </div>
              </div>

              <div className="space-y-3 text-sm">
                <div className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/10">
                  <div className="w-6 h-6 rounded-full bg-[#00f3ff]/20 border border-[#00f3ff]/40 text-[#00f3ff] flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                    1
                  </div>
                  <div>
                    <div className="font-bold text-white">Abra a janela do seu Terminal Nativo</div>
                    <div className="text-xs text-gray-400">iTerm ou Terminal do sistema</div>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/10">
                  <div className="w-6 h-6 rounded-full bg-[#00f3ff]/20 border border-[#00f3ff]/40 text-[#00f3ff] flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                    2
                  </div>
                  <div className="flex-1">
                    <div className="font-bold text-white">Acesse o workspace e execute:</div>
                    <div className="mt-1 p-2 rounded-lg bg-black/80 border border-white/15 font-mono text-xs text-[#00f3ff]">
                      cd {sessionPath} && agy
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/10">
                  <div className="w-6 h-6 rounded-full bg-[#00f3ff]/20 border border-[#00f3ff]/40 text-[#00f3ff] flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                    3
                  </div>
                  <div className="flex-1">
                    <div className="font-bold text-white">Converse com os sub-agentes & MCPs</div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      Use prompts livres ou os exemplos inspiradores abaixo.
                    </div>
                  </div>
                </div>
              </div>

              {/* Status Listening Bar */}
              <div className="p-3 rounded-xl bg-white/[0.02] border border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Loader2 className="w-4 h-4 text-[#00f3ff] animate-spin" />
                  <span className="text-xs text-gray-300">
                    Aguardando <code className="text-[#00f3ff]">ship_spec.json</code>...
                  </span>
                </div>
                <button
                  onClick={handleSimulateForge}
                  className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/15 text-[10px] text-gray-300 font-bold"
                >
                  ⚡ Simular Conclusão
                </button>
              </div>
            </div>

            {/* Right Column: Live Telemetry & Tool Invocations (5 cols) */}
            <div className="md:col-span-5 flex flex-col gap-4">
              {/* Real-Time Tool Execution Feed */}
              <div className="p-5 rounded-2xl bg-black/60 border border-white/15 backdrop-blur-xl flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center gap-2">
                    <Activity className="w-4 h-4 text-[#00ff88] animate-pulse" />
                    Telemetria ao Vivo dos MCPs
                  </h3>
                  <span className="text-[10px] text-emerald-400 font-bold">TEMPO REAL</span>
                </div>

                <div className="min-h-[140px] max-h-[160px] overflow-y-auto space-y-1.5 pr-1 font-mono text-[11px]">
                  {mcpLogs.length === 0 ? (
                    <div className="h-28 flex flex-col items-center justify-center text-center text-gray-500 text-xs">
                      <Cpu className="w-5 h-5 mb-1 opacity-50" />
                      <span>Aguardando invocações de tools pelo AGY...</span>
                    </div>
                  ) : (
                    mcpLogs.map((log, idx) => (
                      <div key={idx} className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 flex items-center justify-between text-[10px] animate-fadeIn">
                        <span className="font-bold">[{log.server}] {log.tool}</span>
                        <span className="text-emerald-400/70">✓ OK</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Connected Subagents Chips */}
              <div className="p-4 rounded-2xl bg-black/60 border border-white/15 backdrop-blur-xl space-y-2">
                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">
                  Sub-Agentes Prontos
                </span>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 rounded-xl bg-white/[0.03] border border-white/10 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span className="text-gray-200">aesthetic-designer</span>
                  </div>
                  <div className="p-2 rounded-xl bg-white/[0.03] border border-white/10 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span className="text-gray-200">{selectedSubagents[1] || 'combat-strategist'}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Inspiring Prompt Suggestions Carousel/Cards */}
        <div className="p-5 rounded-2xl bg-black/50 border border-white/10 backdrop-blur-xl flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-[#ffd700] uppercase tracking-wider flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              Exemplos de Prompts Inspiradores (Clique para Copiar)
            </h3>
            <span className="text-[10px] text-gray-400">Copie e cole no Antigravity CLI</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            {PROMPT_SUGGESTIONS.map((item, idx) => (
              <button
                key={idx}
                onClick={() => handleCopyPrompt(item.text, idx)}
                className="p-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/10 hover:border-[#00f3ff]/50 text-left transition-all flex flex-col justify-between gap-2 group"
              >
                <div>
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#00f3ff]/15 text-[#00f3ff] uppercase">
                    {item.tag}
                  </span>
                  <h4 className="text-xs font-bold text-white mt-1 group-hover:text-[#00f3ff] transition-colors">
                    {item.title}
                  </h4>
                  <p className="text-[10px] text-gray-400 line-clamp-2 mt-1 italic">
                    "{item.text}"
                  </p>
                </div>
                <div className="text-[10px] font-bold text-gray-500 group-hover:text-white">
                  {copiedPromptIndex === idx ? '✓ COPIADO!' : 'Clique para copiar'}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
