import React, { useEffect } from 'react';
import { Rocket, Trophy, Sparkles, Zap, Shield, Play } from 'lucide-react';
import { audioManager } from '../game/audio/AudioManager.js';

interface AttractScreenProps {
  onStart: () => void;
}

export function AttractScreen({ onStart }: AttractScreenProps) {
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
    <div className="flex-1 flex flex-col items-center justify-center p-8 relative overflow-hidden bg-radial from-[#180838] via-[#080214] to-[#020108] select-none">
      {/* Decorative Star/Grid Lines */}
      <div className="absolute inset-0 bg-[radial-gradient(#00f3ff_1px,transparent_1px)] [background-size:32px_32px] opacity-15 pointer-events-none" />

      {/* Main Title Badge */}
      <div className="text-center space-y-4 z-10 max-w-2xl">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#00f3ff]/10 border border-[#00f3ff]/40 text-[#00f3ff] text-xs font-bold tracking-widest uppercase mb-2">
          <Sparkles className="w-4 h-4 animate-spin" /> Google Cloud Summit 2026
        </div>

        <h1 className="text-5xl md:text-6xl font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-b from-[#ffffff] via-[#00f3ff] to-[#ff0055] drop-shadow-[0_0_35px_rgba(0,243,255,0.6)]">
          SPACE SHOOTER
        </h1>

        <p className="text-lg text-[#ffd700] font-bold tracking-wider">
          FORJA DE NAVES COM AGENTES DE IA & MCP
        </p>

        <p className="text-xs text-gray-300 max-w-lg mx-auto leading-relaxed">
          Configure a matriz de energia da sua nave, customize canhões e propulsão com o <b>Antigravity CLI</b> e dispute o topo do placar no estande!
        </p>
      </div>

      {/* Hall of Fame / Top Record Preview */}
      <div className="my-8 z-10 w-full max-w-md glass-panel p-5 rounded-2xl border border-white/15 shadow-2xl">
        <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3">
          <span className="text-xs font-bold text-[#ffd700] flex items-center gap-2">
            <Trophy className="w-4 h-4 text-[#ffd700]" /> HALL DA FAMA (ESTANDE)
          </span>
          <span className="text-[10px] text-gray-400">TOP RECORDISTAS</span>
        </div>

        <div className="space-y-2 text-xs">
          <div className="flex justify-between items-center p-2 rounded-lg bg-[#ffd700]/10 border border-[#ffd700]/30 text-[#ffd700]">
            <span>🥇 1. CYBER_ACE (Google)</span>
            <span className="font-bold">42.500 PTS</span>
          </div>
          <div className="flex justify-between items-center p-2 rounded-lg bg-white/5 text-gray-200">
            <span>🥈 2. NOVA_PILOT (Itaú)</span>
            <span className="font-bold">38.200 PTS</span>
          </div>
          <div className="flex justify-between items-center p-2 rounded-lg bg-white/5 text-gray-300">
            <span>🥉 3. VOID_HUNTER (Nubank)</span>
            <span className="font-bold">34.900 PTS</span>
          </div>
        </div>
      </div>

      {/* Pulsing Start Prompt */}
      <div className="z-10 text-center space-y-3">
        <button
          onClick={() => {
            audioManager.unlockAudio();
            onStart();
          }}
          className="px-8 py-4 rounded-2xl bg-gradient-to-r from-[#00f3ff] to-[#ff0055] text-black font-black text-sm tracking-widest uppercase hover:scale-105 transition-all shadow-[0_0_30px_rgba(0,243,255,0.6)] flex items-center gap-3 mx-auto"
        >
          <Play className="w-5 h-5 fill-black" /> PRESSIONE ESPAÇO PARA INICIAR
        </button>
        <p className="text-[11px] text-gray-400">Tempo estimado da experiência: ~2 minutos e 30 segundos</p>
      </div>
    </div>
  );
}
