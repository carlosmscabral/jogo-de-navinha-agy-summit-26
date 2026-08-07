import React, { useEffect } from 'react';
import { Rocket, Trophy, Sparkles, Zap, Shield, Play, Terminal, ChevronRight, Wrench } from 'lucide-react';
import { audioManager } from '../game/audio/AudioManager.js';

interface AttractScreenProps {
  onStart: () => void;
  onOpenDevWorkbench?: () => void;
}

export function AttractScreen({ onStart, onOpenDevWorkbench }: AttractScreenProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        audioManager.unlockAudio();
        onStart();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onStart]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 relative overflow-hidden select-none font-sans">
      {/* Dev Workbench Button */}
      {onOpenDevWorkbench && (
        <div className="absolute top-4 left-4 z-20">
          <button
            onClick={onOpenDevWorkbench}
            className="px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20 text-xs font-mono font-bold flex items-center gap-1.5 transition shadow-lg backdrop-blur-md"
            title="Abrir Laboratório de Testes da Game Engine (Shift+D)"
          >
            <Wrench className="w-3.5 h-3.5" />
            <span>ENGINE LAB [DEV]</span>
          </button>
        </div>
      )}

      {/* Flight Deck Header Tag */}
      <div className="text-center space-y-4 z-10 max-w-2xl">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#38bdf8]/10 border border-[#38bdf8]/30 text-[#38bdf8] text-xs font-bold tracking-widest uppercase mb-2 font-mono">
          <Terminal className="w-4 h-4 text-[#ff9e0b]" /> Google Cloud Summit 2026 // Avionics Forge
        </div>

        <h1 className="text-5xl md:text-6xl font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-b from-[#ffffff] via-[#f1f5f9] to-[#94a3b8] drop-shadow-[0_0_30px_rgba(56,189,248,0.3)]">
          STARFIGHTER
        </h1>

        <p className="text-base text-[#ff9e0b] font-black tracking-widest uppercase text-glow-amber">
          FORJA AEROESPACIAL COM AGENTES DE IA & MCP
        </p>

        <p className="text-xs text-slate-400 max-w-lg mx-auto leading-relaxed">
          Calibre a matriz de energia da fuselagem, configure canhões e escudos no <b>Antigravity CLI</b> e dispute o topo do ranking corporativo!
        </p>
      </div>

      {/* Hall of Fame Preview Card */}
      <div className="my-7 z-10 w-full max-w-md flight-panel p-5 rounded-3xl border border-slate-700/60 shadow-2xl space-y-3">
        <div className="flex items-center justify-between pb-3 border-b border-slate-700/60">
          <span className="text-xs font-bold text-[#ff9e0b] flex items-center gap-2 font-mono">
            <Trophy className="w-4 h-4 text-[#ff9e0b]" /> RECORDE DO ESTANDE
          </span>
          <span className="text-[10px] text-slate-400 font-mono">TOP PILOTOS</span>
        </div>

        <div className="space-y-2 text-xs font-mono">
          <div className="flex justify-between items-center p-2.5 rounded-xl bg-[#ff9e0b]/10 border border-[#ff9e0b]/30 text-[#ff9e0b]">
            <span className="font-bold">🥇 1. CYBER_ACE (Google)</span>
            <span className="font-black">48.500 PTS</span>
          </div>
          <div className="flex justify-between items-center p-2.5 rounded-xl bg-slate-800/40 border border-slate-700/40 text-slate-200">
            <span>🥈 2. NEO_PILOT (Nubank)</span>
            <span className="font-bold">44.200 PTS</span>
          </div>
          <div className="flex justify-between items-center p-2.5 rounded-xl bg-slate-800/40 border border-slate-700/40 text-slate-300">
            <span>🥉 3. QUANTUM_VIPER (Itaú)</span>
            <span className="font-bold">39.800 PTS</span>
          </div>
        </div>
      </div>

      {/* Solar Amber Action Button */}
      <div className="z-10 text-center space-y-3">
        <button
          onClick={() => {
            audioManager.unlockAudio();
            onStart();
          }}
          className="px-9 py-4 rounded-2xl bg-gradient-to-r from-[#ff9e0b] to-[#f59e0b] text-black font-black text-xs tracking-widest uppercase hover:scale-105 transition-all shadow-[0_0_30px_rgba(255,158,11,0.5)] flex items-center gap-3 mx-auto"
        >
          <Play className="w-4 h-4 fill-black" />
          <span>PRESSIONE ESPAÇO PARA INICIAR</span>
          <ChevronRight className="w-4 h-4 stroke-[3]" />
        </button>
        <p className="text-[11px] text-slate-500 font-mono">Duração estimada da missão: ~2 minutos e 30 segundos</p>
      </div>
    </div>
  );
}
