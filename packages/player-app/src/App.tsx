import React, { useState, useEffect, useRef } from 'react';
import { FALLBACK_PRESETS } from '@jogo/shared';
import { createGameInstance } from './game/index.js';
import { Rocket, Crosshair, Shield, Zap, Sparkles, Activity } from 'lucide-react';

export function App() {
  const [selectedPreset, setSelectedPreset] = useState<'interceptor' | 'vanguard' | 'striker'>('interceptor');
  const gameContainerRef = useRef<HTMLDivElement>(null);
  const gameInstanceRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (gameContainerRef.current && !gameInstanceRef.current) {
      const spec = FALLBACK_PRESETS[selectedPreset];
      gameInstanceRef.current = createGameInstance(gameContainerRef.current, spec);
    }

    return () => {
      if (gameInstanceRef.current) {
        gameInstanceRef.current.destroy(true);
        gameInstanceRef.current = null;
      }
    };
  }, []);

  const handleSelectPreset = (presetKey: 'interceptor' | 'vanguard' | 'striker') => {
    setSelectedPreset(presetKey);
    const spec = FALLBACK_PRESETS[presetKey];
    if (gameInstanceRef.current) {
      const scene = gameInstanceRef.current.scene.getScenes(true)[0];
      if (scene) {
        scene.scene.restart({ shipSpec: spec });
      }
    }
  };

  return (
    <div className="flex h-screen w-screen bg-[#03020a] text-white overflow-hidden select-none font-mono">
      {/* Lateral Modern Cyber Glass Panel */}
      <aside className="w-[380px] xl:w-[420px] glass-panel border-r border-[#00f3ff]/20 p-6 flex flex-col justify-between z-10 shrink-0">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center space-x-3 pb-4 border-b border-white/10">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-[#00f3ff]/20 to-[#ff0055]/20 border border-[#00f3ff]/40 shadow-lg shadow-[#00f3ff]/10">
              <Rocket className="text-[#00f3ff] w-7 h-7 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-[#00f3ff] via-[#ffffff] to-[#ff0055]">
                  SPACE SHOOTER
                </h1>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#00f3ff]/20 text-[#00f3ff] font-bold border border-[#00f3ff]/30">
                  AGY '26
                </span>
              </div>
              <p className="text-[11px] text-gray-400">Google Cloud Summit // Showcase</p>
            </div>
          </div>

          {/* Status Box */}
          <div className="rounded-xl p-4 bg-black/40 border border-[#ffd700]/30 shadow-inner">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-bold text-[#ffd700] flex items-center gap-2">
                <Crosshair className="w-4 h-4 text-[#ffd700]" /> ARENA DE PILOTAGEM
              </span>
              <span className="flex items-center gap-1 text-[10px] text-[#00ff88]">
                <Activity className="w-3 h-3 animate-pulse" /> 60 FPS
              </span>
            </div>
            <p className="text-xs text-gray-300 leading-relaxed">
              Teste a resposta de voo, canhões primários e manobras com teclado físico antes da forja no Antigravity CLI.
            </p>
          </div>

          {/* Archetype Selector */}
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <label className="text-xs text-[#00f3ff] font-bold tracking-wider uppercase">
                Arquétipos Disponíveis
              </label>
              <span className="text-[10px] text-gray-400">3 Presets Calibrados</span>
            </div>

            <div className="space-y-2.5">
              {(['interceptor', 'vanguard', 'striker'] as const).map((preset) => {
                const spec = FALLBACK_PRESETS[preset];
                const isSelected = selectedPreset === preset;

                return (
                  <button
                    key={preset}
                    onClick={() => handleSelectPreset(preset)}
                    className={`w-full p-3 rounded-xl border text-left transition-all duration-200 ${
                      isSelected
                        ? 'border-[#00f3ff] bg-gradient-to-r from-[#00f3ff]/20 to-[#00f3ff]/5 neon-glow-cyan text-white scale-[1.02]'
                        : 'border-white/10 bg-white/[0.02] text-gray-400 hover:border-white/25 hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className={`text-xs font-bold uppercase ${isSelected ? 'text-[#00f3ff]' : 'text-gray-200'}`}>
                        {spec.visuals.style_name}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#00f3ff]/20 text-[#00f3ff] font-bold border border-[#00f3ff]/40">
                        {spec.weapons.primary.type}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-[11px] text-gray-300 pt-1 border-t border-white/5">
                      <div className="flex items-center gap-1">
                        <Zap className="w-3 h-3 text-[#ffd700]" />
                        <span>SPD: <b>{spec.attributes.speed_px_s}</b></span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Shield className="w-3 h-3 text-[#00ff88]" />
                        <span>HP: <b>{spec.attributes.max_hp}</b></span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Sparkles className="w-3 h-3 text-[#00f3ff]" />
                        <span>SHD: <b>{spec.attributes.shield_capacity}</b></span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Keyboard Controls */}
          <div className="rounded-xl p-4 bg-black/50 border border-white/10 text-xs space-y-2">
            <div className="text-[#ffd700] font-bold flex items-center gap-1.5">
              <span>🎮 COMANDOS DO TECLADO:</span>
            </div>
            <div className="space-y-1.5 text-gray-300">
              <div className="flex justify-between items-center py-0.5 border-b border-white/5">
                <span>Manobra de Voo:</span>
                <span className="text-[#00f3ff] font-bold bg-[#00f3ff]/10 px-2 py-0.5 rounded">WASD / Setas</span>
              </div>
              <div className="flex justify-between items-center py-0.5 border-b border-white/5">
                <span>Disparo Primário:</span>
                <span className="text-[#00f3ff] font-bold bg-[#00f3ff]/10 px-2 py-0.5 rounded">Espaço (Hold)</span>
              </div>
              <div className="flex justify-between items-center py-0.5 border-b border-white/5">
                <span>Arma Secundária:</span>
                <span className="text-[#ff0055] font-bold bg-[#ff0055]/10 px-2 py-0.5 rounded">Shift</span>
              </div>
              <div className="flex justify-between items-center py-0.5">
                <span>Reiniciar Partida:</span>
                <span className="text-[#ffd700] font-bold bg-[#ffd700]/10 px-2 py-0.5 rounded">Tecla R</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="text-[11px] text-center text-gray-400 pt-3 border-t border-white/10">
          Antigravity Engine // Vertical Mode Ready
        </div>
      </aside>

      {/* Main Game Stage (Responsive Portrait Scale) */}
      <main className="flex-1 flex flex-col items-center justify-center p-4 relative bg-radial from-[#100826] via-[#050310] to-[#020108] overflow-hidden">
        <div className="h-full max-h-[94vh] aspect-[3/4] relative rounded-2xl overflow-hidden border border-[#00f3ff]/40 shadow-2xl shadow-[#00f3ff]/20">
          <div id="game-container" ref={gameContainerRef} className="w-full h-full" />
        </div>
      </main>
    </div>
  );
}
