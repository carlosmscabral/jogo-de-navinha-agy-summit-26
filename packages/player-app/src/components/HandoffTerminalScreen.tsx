import React, { useEffect, useState, useRef } from 'react';
import { ShipSpecification, PilotInfo, EnergySliders, McpServerName, SubagentName, FALLBACK_PRESETS } from '@jogo/shared';
import { Terminal, Shield, Zap, Rocket, Cpu, CheckCircle2, Loader2, Play, Sparkles, ArrowRight } from 'lucide-react';
import { audioManager } from '../game/audio/AudioManager.js';

interface HandoffTerminalScreenProps {
  pilot: PilotInfo;
  energySliders?: EnergySliders;
  selectedMcps?: McpServerName[];
  selectedSubagents?: SubagentName[];
  onShipReady: (spec: ShipSpecification) => void;
  onEmergencyFallback: () => void;
}

export function HandoffTerminalScreen({
  pilot,
  energySliders = { offense: 35, speed: 35, defense: 15, tech: 15 },
  selectedMcps = ['weapons-arsenal', 'hull-propulsion', 'cybernetics-shields'],
  selectedSubagents = ['aesthetic-designer', 'combat-strategist'],
  onShipReady,
  onEmergencyFallback
}: HandoffTerminalScreenProps) {
  const [sessionPath, setSessionPath] = useState('/tmp/booth_session');
  const [activeTools, setActiveTools] = useState<string[]>([]);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const isTransitioningRef = useRef(false);

  const triggerShipReady = (spec: ShipSpecification) => {
    if (isTransitioningRef.current) return;
    isTransitioningRef.current = true;

    console.log('[HandoffScreen] Ship spec triggered for launch:', spec);
    setIsSuccess(true);
    audioManager.playLaser();

    setTimeout(() => {
      onShipReady(spec);
    }, 1000);
  };

  useEffect(() => {
    isTransitioningRef.current = false;

    // 1. WebSocket Listener for instant Push Events
    const ws = new WebSocket('ws://localhost:3000/pty');

    ws.onopen = () => {
      console.log('[HandoffScreen] Connected to daemon WebSocket listener');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.type === 'EVENT_SHIP_READY' && msg.spec) {
          triggerShipReady(msg.spec);
        } else if (msg.type === 'EVENT_MCP_ACTIVITY') {
          setActiveTools((prev) => Array.from(new Set([...prev, msg.tool])));
        }
      } catch {
        // Ignored
      }
    };

    // 2. HTTP Polling Backup (checks GET /api/session/spec every 800ms)
    const pollTimer = setInterval(async () => {
      if (isTransitioningRef.current) return;

      try {
        const res = await fetch('http://localhost:3000/api/session/spec');
        if (res.ok) {
          const data = await res.json();
          if (data.ready && data.spec) {
            console.log('[HandoffScreen] HTTP polling detected ship_spec.json!');
            triggerShipReady(data.spec);
          }
        }
      } catch {
        // Daemon might be restarting
      }
    }, 800);

    return () => {
      ws.close();
      clearInterval(pollTimer);
    };
  }, [onShipReady]);

  const handleSimulateForge = () => {
    setIsSynthesizing(true);
    setTimeout(() => {
      const customSpec: ShipSpecification = JSON.parse(JSON.stringify(FALLBACK_PRESETS.interceptor));
      customSpec.pilot.callsign = pilot.callsign;
      customSpec.pilot.company_canonical = pilot.company_canonical;
      triggerShipReady(customSpec);
    }, 1000);
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 relative bg-radial from-[#100826] via-[#050310] to-[#020108] overflow-y-auto">
      {/* Background Animated Glows */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#00f3ff]/10 rounded-full blur-3xl pointer-events-none animate-pulse" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-[#ff0055]/10 rounded-full blur-3xl pointer-events-none animate-pulse" />

      <div className="w-full max-w-4xl flex flex-col gap-6 z-10">
        {/* Top Header Card */}
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

          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-xs text-gray-400 uppercase">Piloto Autenticado</div>
              <div className="text-sm font-bold text-[#00f3ff]">
                {pilot.callsign} <span className="text-gray-400 font-normal">({pilot.company_canonical})</span>
              </div>
            </div>
          </div>
        </div>

        {/* Center Instructions Grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          {/* Main Action Box (7 cols) */}
          <div className="md:col-span-7 flex flex-col gap-4 p-6 rounded-2xl bg-black/70 border border-[#00f3ff]/30 backdrop-blur-xl shadow-2xl shadow-[#00f3ff]/10">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#ffd700]" />
                Instruções do Estande
              </h2>
              <div className="flex items-center gap-1.5 text-xs text-[#00f3ff] animate-pulse font-bold">
                <span className="w-2 h-2 rounded-full bg-[#00f3ff]" />
                AGUARDANDO AGY NO TERMINAL
              </div>
            </div>

            <div className="space-y-3.5 text-sm">
              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-white/[0.03] border border-white/10">
                <div className="w-6 h-6 rounded-full bg-[#00f3ff]/20 border border-[#00f3ff]/40 text-[#00f3ff] flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                  1
                </div>
                <div>
                  <div className="font-bold text-white">Alterne para a janela do Terminal Nativo</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    Abra a janela do seu terminal (iTerm / Terminal do sistema).
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-white/[0.03] border border-white/10">
                <div className="w-6 h-6 rounded-full bg-[#00f3ff]/20 border border-[#00f3ff]/40 text-[#00f3ff] flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                  2
                </div>
                <div className="flex-1">
                  <div className="font-bold text-white">Acesse o workspace da sessão:</div>
                  <div className="mt-1 p-2 rounded-lg bg-black/80 border border-white/15 font-mono text-xs text-[#00f3ff] flex items-center justify-between">
                    <span>cd {sessionPath}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3.5 rounded-xl bg-white/[0.03] border border-white/10">
                <div className="w-6 h-6 rounded-full bg-[#00f3ff]/20 border border-[#00f3ff]/40 text-[#00f3ff] flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                  3
                </div>
                <div className="flex-1">
                  <div className="font-bold text-white">Execute o Antigravity CLI e forje sua nave:</div>
                  <div className="mt-1 p-2 rounded-lg bg-black/80 border border-white/15 font-mono text-xs text-[#ffd700] flex items-center justify-between">
                    <span>agy</span>
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    Digite prompts livres como: <span className="text-gray-300 italic">"forje uma nave ultra-rápida com lasers azuis"</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Success / Synthesis Status Banner */}
            {isSuccess ? (
              <div className="p-4 rounded-xl bg-emerald-950/60 border border-emerald-500/50 text-emerald-300 flex items-center gap-3 animate-bounce">
                <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
                <div>
                  <div className="font-bold text-sm">NAVE SINTETIZADA COM SUCESSO!</div>
                  <div className="text-xs text-emerald-400/80">Carregando telemetria na Game Engine...</div>
                </div>
              </div>
            ) : (
              <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Loader2 className="w-4 h-4 text-[#00f3ff] animate-spin" />
                  <span className="text-xs text-gray-300">
                    Ouvindo <code className="text-[#00f3ff]">ship_spec.json</code> via Chokidar & Polling...
                  </span>
                </div>
                <span className="text-[10px] text-gray-500 font-mono">PORT 3000</span>
              </div>
            )}
          </div>

          {/* Right Status Panel (5 cols) */}
          <div className="md:col-span-5 flex flex-col gap-4">
            {/* Active Sub-agents & MCP Status */}
            <div className="p-5 rounded-2xl bg-black/60 border border-white/15 backdrop-blur-xl flex flex-col gap-3">
              <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center gap-2">
                <Cpu className="w-4 h-4 text-[#00f3ff]" />
                Servidores MCP & Sub-agentes
              </h3>

              <div className="space-y-2">
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.03] border border-white/10 text-xs">
                  <div className="flex items-center gap-2">
                    <Rocket className="w-3.5 h-3.5 text-[#ff0055]" />
                    <span className="text-gray-200">weapons-arsenal</span>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    CONECTADO
                  </span>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.03] border border-white/10 text-xs">
                  <div className="flex items-center gap-2">
                    <Zap className="w-3.5 h-3.5 text-[#00f3ff]" />
                    <span className="text-gray-200">hull-propulsion</span>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    CONECTADO
                  </span>
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.03] border border-white/10 text-xs">
                  <div className="flex items-center gap-2">
                    <Shield className="w-3.5 h-3.5 text-[#ffd700]" />
                    <span className="text-gray-200">cybernetics-shields</span>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    CONECTADO
                  </span>
                </div>
              </div>

              {/* Energy Matrix Preview */}
              <div className="mt-2 pt-3 border-t border-white/10">
                <div className="text-[11px] text-gray-400 uppercase mb-2">Matriz de Energia Alocada</div>
                <div className="grid grid-cols-4 gap-1.5 text-center text-[10px] font-bold">
                  <div className="p-1.5 rounded-lg bg-[#ff0055]/15 border border-[#ff0055]/30 text-[#ff0055]">
                    ATK {energySliders.offense}
                  </div>
                  <div className="p-1.5 rounded-lg bg-[#00f3ff]/15 border border-[#00f3ff]/30 text-[#00f3ff]">
                    SPD {energySliders.speed}
                  </div>
                  <div className="p-1.5 rounded-lg bg-[#ffd700]/15 border border-[#ffd700]/30 text-[#ffd700]">
                    DEF {energySliders.defense}
                  </div>
                  <div className="p-1.5 rounded-lg bg-[#00ff88]/15 border border-[#00ff88]/30 text-[#00ff88]">
                    TEC {energySliders.tech}
                  </div>
                </div>
              </div>
            </div>

            {/* Quick Launch & Fallback Controls */}
            <div className="p-5 rounded-2xl bg-black/60 border border-white/15 backdrop-blur-xl flex flex-col gap-3">
              <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider">
                Atalhos Rápidos
              </h3>

              <button
                onClick={handleSimulateForge}
                disabled={isSynthesizing}
                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-[#00f3ff] to-[#00a8ff] text-black font-black text-xs uppercase tracking-wider hover:opacity-90 transition-all flex items-center justify-center gap-2 shadow-lg shadow-[#00f3ff]/20 disabled:opacity-50"
              >
                {isSynthesizing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Sintetizando...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    <span>Simular Forja Concluída</span>
                  </>
                )}
              </button>

              <button
                onClick={onEmergencyFallback}
                className="w-full py-2 px-3 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/15 text-gray-300 hover:text-white font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-1.5"
              >
                <span>Pular Direto para o Jogo</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
