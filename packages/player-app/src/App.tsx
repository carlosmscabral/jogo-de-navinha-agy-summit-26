import React, { useState, useEffect, useRef } from 'react';
import { FALLBACK_PRESETS, ShipSpecification } from '@jogo/shared';
import { createGameInstance } from './game/index.js';
import { Rocket, Shield, Zap, Crosshair } from 'lucide-react';

export function App() {
  const [selectedPreset, setSelectedPreset] = useState<'interceptor' | 'vanguard' | 'striker'>('interceptor');
  const gameContainerRef = useRef<HTMLDivElement>(null);
  const gameInstanceRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (gameContainerRef.current) {
      if (gameInstanceRef.current) {
        gameInstanceRef.current.destroy(true);
      }
      const spec = FALLBACK_PRESETS[selectedPreset];
      gameInstanceRef.current = createGameInstance(gameContainerRef.current.id, spec);
    }

    return () => {
      if (gameInstanceRef.current) {
        gameInstanceRef.current.destroy(true);
        gameInstanceRef.current = null;
      }
    };
  }, [selectedPreset]);

  const currentSpec = FALLBACK_PRESETS[selectedPreset];

  return (
    <div className="flex h-screen w-screen bg-[#050510] text-white crt-scanlines overflow-hidden">
      {/* Lateral Control & Preset Selector Panel */}
      <div className="w-96 border-r border-[#00f3ff]/30 p-6 flex flex-col justify-between bg-[#0a0a1a]/90 backdrop-blur-md">
        <div>
          <div className="flex items-center space-x-3 mb-6">
            <Rocket className="text-[#00f3ff] w-8 h-8 animate-pulse" />
            <div>
              <h1 className="text-xl font-bold neon-text-cyan tracking-wider">SPACE SHOOTER</h1>
              <p className="text-xs text-[#00f3ff]/60">Google Cloud Summit // AGY 2026</p>
            </div>
          </div>

          <div className="border border-[#00f3ff]/20 bg-[#001020]/60 p-4 rounded-lg mb-6">
            <h2 className="text-sm font-semibold text-[#ffd700] mb-2 flex items-center gap-2">
              <Crosshair className="w-4 h-4" /> CHECKPOINT 1: ARENA DE TESTE
            </h2>
            <p className="text-xs text-gray-300 leading-relaxed">
              Teste a resposta da nave e dos canhões no teclado físico antes da integração do terminal.
            </p>
          </div>

          {/* Preset Selector */}
          <div className="space-y-3 mb-6">
            <label className="text-xs text-[#00f3ff] uppercase font-bold tracking-wider">
              Arquétipos de Nave
            </label>
            {(['interceptor', 'vanguard', 'striker'] as const).map((preset) => (
              <button
                key={preset}
                onClick={() => setSelectedPreset(preset)}
                className={`w-full p-3 rounded border text-left text-xs transition-all ${
                  selectedPreset === preset
                    ? 'border-[#00f3ff] bg-[#00f3ff]/20 neon-glow-cyan text-white font-bold'
                    : 'border-white/10 bg-black/40 text-gray-400 hover:border-white/30'
                }`}
              >
                <div className="flex justify-between items-center mb-1">
                  <span className="uppercase">{FALLBACK_PRESETS[preset].visuals.style_name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#00f3ff]/30 text-[#00f3ff]">
                    {FALLBACK_PRESETS[preset].weapons.primary.type}
                  </span>
                </div>
                <div className="text-[11px] text-gray-300 flex gap-3">
                  <span>SPD: {FALLBACK_PRESETS[preset].attributes.speed_px_s}</span>
                  <span>HP: {FALLBACK_PRESETS[preset].attributes.max_hp}</span>
                  <span>SHD: {FALLBACK_PRESETS[preset].attributes.shield_capacity}</span>
                </div>
              </button>
            ))}
          </div>

          {/* Controls Help */}
          <div className="border border-white/10 rounded-lg p-4 bg-black/40 text-xs space-y-2">
            <div className="text-[#ffd700] font-bold">CONTROLES DO TECLADO:</div>
            <div className="flex justify-between text-gray-300">
              <span>Mover Nave:</span>
              <span className="text-[#00f3ff]">WASD ou Setas</span>
            </div>
            <div className="flex justify-between text-gray-300">
              <span>Disparo Primário:</span>
              <span className="text-[#00f3ff]">Barra de Espaço</span>
            </div>
            <div className="flex justify-between text-gray-300">
              <span>Arma Secundária:</span>
              <span className="text-[#ff0055]">Tecla Shift</span>
            </div>
          </div>
        </div>

        <div className="text-[11px] text-center text-gray-500 border-t border-white/10 pt-4">
          Antigravity Engine // 60 FPS Arcade Mode
        </div>
      </div>

      {/* Center Game Arena */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 bg-[#030308]">
        <div className="relative border-2 border-[#00f3ff]/50 rounded-xl overflow-hidden neon-glow-cyan">
          <div id="game-container" ref={gameContainerRef} className="w-[600px] h-[800px]" />
        </div>
      </div>
    </div>
  );
}
