import React, { useState } from 'react';
import { EnergySliders, McpServerName, SubagentName, PilotInfo } from '@jogo/shared';
import { Zap, Shield, Sparkles, Crosshair, ChevronRight, CheckCircle2, Cpu, Flame, Gauge, Layers, Award, ArrowLeft } from 'lucide-react';

interface EnergySlidersBuilderProps {
  pilot: PilotInfo;
  onProceedToTerminal: (config: {
    energy_sliders: EnergySliders;
    selected_mcps: McpServerName[];
    selected_subagents: SubagentName[];
  }) => void;
  onBack: () => void;
}

export function EnergySlidersBuilder({ pilot, onProceedToTerminal, onBack }: EnergySlidersBuilderProps) {
  const [sliders, setSliders] = useState<EnergySliders>({
    offense: 35,
    speed: 35,
    defense: 15,
    tech: 15
  });

  const [selectedMcps, setSelectedMcps] = useState<McpServerName[]>([
    'weapons-arsenal',
    'hull-propulsion',
    'cybernetics-shields'
  ]);

  const [selectedTacticalAgent, setSelectedTacticalAgent] = useState<'combat-strategist' | 'systems-engineer'>('combat-strategist');

  const mcpCount = selectedMcps.length;
  const overclockMultiplier = mcpCount === 1 ? 1.2 : mcpCount === 2 ? 1.1 : 1.0;
  const scoreMultiplier = mcpCount === 1 ? 1.25 : mcpCount === 2 ? 1.1 : 1.0;

  // Live Projected Stats
  const rawDps = Math.round(sliders.offense * 35);
  const projectedDps = selectedMcps.includes('weapons-arsenal') ? Math.round(rawDps * overclockMultiplier) : rawDps;

  const rawSpeed = Math.round(180 + sliders.speed * 5.2);
  const projectedSpeed = selectedMcps.includes('hull-propulsion') ? Math.round(rawSpeed * (mcpCount === 1 ? 1.15 : 1.0)) : rawSpeed;

  const projectedHp = Math.max(2, Math.min(8, Math.round(sliders.defense / 6)));
  const projectedShields = Math.max(1, Math.min(3, Math.round(sliders.tech / 13))) + (mcpCount === 1 && selectedMcps.includes('cybernetics-shields') ? 1 : 0);

  // Detect active synergy
  let detectedSynergy = 'Custom Build';
  if (sliders.offense >= 40) detectedSynergy = '⚡ Glass Cannon (+30% DPS)';
  else if (sliders.speed >= 40) detectedSynergy = '💨 Ghost Interceptor (+20% Esquiva)';
  else if (sliders.defense >= 40) detectedSynergy = '🛡️ Titan Fortress (+25% Blindagem)';
  else if (
    sliders.offense >= 20 && sliders.offense <= 30 &&
    sliders.speed >= 20 && sliders.speed <= 30 &&
    sliders.defense >= 20 && sliders.defense <= 30
  ) {
    detectedSynergy = '🎯 Balanced Ace (+15% Geral)';
  }

  const applyPreset = (preset: { offense: number; speed: number; defense: number; tech: number }) => {
    setSliders(preset);
  };

  const handleSliderChange = (key: keyof EnergySliders, value: number) => {
    const diff = value - sliders[key];
    const otherKeys = (Object.keys(sliders) as (keyof EnergySliders)[]).filter((k) => k !== key);

    const remainder = diff / otherKeys.length;
    const newSliders = { ...sliders, [key]: value };

    for (const k of otherKeys) {
      newSliders[k] = Math.max(10, Math.min(50, Math.round(sliders[k] - remainder)));
    }

    const currentSum = Object.values(newSliders).reduce((a, b) => a + b, 0);
    const correction = 100 - currentSum;
    newSliders[otherKeys[0]] = Math.max(10, Math.min(50, newSliders[otherKeys[0]] + correction));

    setSliders(newSliders);
  };

  const toggleMcp = (mcp: McpServerName) => {
    if (selectedMcps.includes(mcp)) {
      if (selectedMcps.length > 1) {
        setSelectedMcps(selectedMcps.filter((m) => m !== mcp));
      }
    } else {
      setSelectedMcps([...selectedMcps, mcp]);
    }
  };

  const handleStartForge = () => {
    onProceedToTerminal({
      energy_sliders: sliders,
      selected_mcps: selectedMcps,
      selected_subagents: ['aesthetic-designer', selectedTacticalAgent]
    });
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 select-none overflow-y-auto font-sans">
      <div className="w-full max-w-4xl flight-panel p-7 rounded-3xl border border-slate-700/60 shadow-2xl space-y-6 my-4">
        {/* Header */}
        <div className="flex justify-between items-center pb-4 border-b border-slate-700/60">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-md bg-[#38bdf8]/10 text-[#38bdf8] border border-[#38bdf8]/30 uppercase tracking-widest font-mono">
                Etapa 3 de 4 // Matriz de Potência
              </span>
              <span className="text-xs text-slate-400 font-mono">Google Cloud Summit 2026</span>
            </div>
            <h2 className="text-2xl font-black text-white tracking-wider uppercase">
              FORJA DE ENERGIA & SERVIDORES MCP
            </h2>
          </div>

          <div className="px-3.5 py-1.5 rounded-xl bg-[#ff9e0b]/10 border border-[#ff9e0b]/30 text-[#ff9e0b] text-xs font-bold flex items-center gap-1.5 font-mono">
            <Sparkles className="w-4 h-4 text-[#ff9e0b]" />
            <span>{detectedSynergy}</span>
          </div>
        </div>

        {/* Quick Presets */}
        <div className="space-y-2">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block font-mono">
            Arquétipos Rápidos (100 PU de Energia Total):
          </span>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <button
              type="button"
              onClick={() => applyPreset({ offense: 45, speed: 35, defense: 10, tech: 10 })}
              className={`p-2.5 rounded-xl border text-left transition-all ${
                sliders.offense >= 40
                  ? 'bg-[#ff9e0b]/20 border-[#ff9e0b] text-white font-bold'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="text-xs font-bold text-[#ff9e0b]">⚡ Glass Cannon</div>
              <div className="text-[10px] text-slate-400 font-mono">45 ATK / 35 SPD</div>
            </button>

            <button
              type="button"
              onClick={() => applyPreset({ offense: 15, speed: 20, defense: 45, tech: 20 })}
              className={`p-2.5 rounded-xl border text-left transition-all ${
                sliders.defense >= 40
                  ? 'bg-[#10b981]/20 border-[#10b981] text-white font-bold'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="text-xs font-bold text-[#10b981]">🛡️ Titan Fortress</div>
              <div className="text-[10px] text-slate-400 font-mono">45 DEF / 20 TEC</div>
            </button>

            <button
              type="button"
              onClick={() => applyPreset({ offense: 25, speed: 45, defense: 15, tech: 15 })}
              className={`p-2.5 rounded-xl border text-left transition-all ${
                sliders.speed >= 40
                  ? 'bg-[#38bdf8]/20 border-[#38bdf8] text-white font-bold'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="text-xs font-bold text-[#38bdf8]">💨 Ghost Interceptor</div>
              <div className="text-[10px] text-slate-400 font-mono">45 SPD / 25 ATK</div>
            </button>

            <button
              type="button"
              onClick={() => applyPreset({ offense: 25, speed: 25, defense: 25, tech: 25 })}
              className={`p-2.5 rounded-xl border text-left transition-all ${
                sliders.offense === 25 && sliders.defense === 25
                  ? 'bg-slate-700/50 border-slate-500 text-white font-bold'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="text-xs font-bold text-slate-200">🎯 Balanced Ace</div>
              <div className="text-[10px] text-slate-400 font-mono">25 em Tudo</div>
            </button>
          </div>
        </div>

        {/* 4 Energy Sliders + Live Stats Breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
          {/* Sliders (7 cols) */}
          <div className="md:col-span-7 space-y-3.5 bg-slate-900/60 p-5 rounded-2xl border border-slate-800">
            <div className="flex justify-between items-center mb-1 font-mono">
              <span className="text-xs font-bold text-slate-300 uppercase">Matriz de Energia</span>
              <span className="text-xs text-[#10b981] font-bold">100 / 100 PU</span>
            </div>

            {/* Offense */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-slate-300">
                <span className="flex items-center gap-1.5 text-[#ff9e0b] font-bold font-mono">
                  <Crosshair className="w-3.5 h-3.5" /> ATAQUE / CANHÕES
                </span>
                <span className="font-mono font-bold text-[#ff9e0b]">{sliders.offense} PU</span>
              </div>
              <input
                type="range"
                min={10}
                max={50}
                value={sliders.offense}
                onChange={(e) => handleSliderChange('offense', Number(e.target.value))}
                className="w-full accent-[#ff9e0b] cursor-pointer"
              />
            </div>

            {/* Speed */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-slate-300">
                <span className="flex items-center gap-1.5 text-[#38bdf8] font-bold font-mono">
                  <Zap className="w-3.5 h-3.5" /> VELOCIDADE / PROPULSÃO
                </span>
                <span className="font-mono font-bold text-[#38bdf8]">{sliders.speed} PU</span>
              </div>
              <input
                type="range"
                min={10}
                max={50}
                value={sliders.speed}
                onChange={(e) => handleSliderChange('speed', Number(e.target.value))}
                className="w-full accent-[#38bdf8] cursor-pointer"
              />
            </div>

            {/* Defense */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-slate-300">
                <span className="flex items-center gap-1.5 text-[#10b981] font-bold font-mono">
                  <Shield className="w-3.5 h-3.5" /> DEFESA / BLINDAGEM (HP)
                </span>
                <span className="font-mono font-bold text-[#10b981]">{sliders.defense} PU</span>
              </div>
              <input
                type="range"
                min={10}
                max={50}
                value={sliders.defense}
                onChange={(e) => handleSliderChange('defense', Number(e.target.value))}
                className="w-full accent-[#10b981] cursor-pointer"
              />
            </div>

            {/* Tech */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-slate-300">
                <span className="flex items-center gap-1.5 text-[#60a5fa] font-bold font-mono">
                  <Cpu className="w-3.5 h-3.5" /> TECNOLOGIA / ESCUDOS
                </span>
                <span className="font-mono font-bold text-[#60a5fa]">{sliders.tech} PU</span>
              </div>
              <input
                type="range"
                min={10}
                max={50}
                value={sliders.tech}
                onChange={(e) => handleSliderChange('tech', Number(e.target.value))}
                className="w-full accent-[#60a5fa] cursor-pointer"
              />
            </div>
          </div>

          {/* Live Projected Stats Gauge (5 cols) */}
          <div className="md:col-span-5 flex flex-col justify-between bg-slate-900/60 p-5 rounded-2xl border border-slate-800">
            <div className="flex justify-between items-center mb-2 font-mono">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Telemetria Projetada
              </span>
              {mcpCount === 1 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#ff9e0b]/20 text-[#ff9e0b] border border-[#ff9e0b]/40 animate-pulse">
                  ⚡ +20% OVERCLOCK
                </span>
              )}
            </div>

            <div className="space-y-2.5 font-mono text-xs">
              <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Flame className="w-3.5 h-3.5 text-[#ff9e0b]" /> Dano Base
                </span>
                <span className="font-bold text-[#ff9e0b]">~{projectedDps} DPS</span>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Gauge className="w-3.5 h-3.5 text-[#38bdf8]" /> Velocidade
                </span>
                <span className="font-bold text-[#38bdf8]">{projectedSpeed} px/s</span>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-[#10b981]" /> Casco
                </span>
                <span className="font-bold text-[#10b981]">{projectedHp} HP</span>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-[#60a5fa]" /> Escudos
                </span>
                <span className="font-bold text-[#60a5fa]">{projectedShields} Camada(s)</span>
              </div>
            </div>

            <div className="mt-3 p-2.5 rounded-xl bg-slate-800/40 border border-slate-700/60 flex items-center justify-between text-xs font-mono">
              <span className="text-slate-300 font-bold flex items-center gap-1.5">
                <Award className="w-4 h-4 text-[#ff9e0b]" /> Multiplicador Placar:
              </span>
              <span className="font-black text-[#ff9e0b] text-sm">
                {scoreMultiplier.toFixed(2)}x
              </span>
            </div>
          </div>
        </div>

        {/* MCP Selection & Tradeoffs */}
        <div className="space-y-3">
          <div className="flex items-center justify-between font-mono">
            <span className="text-xs font-bold text-[#ff9e0b] uppercase tracking-wider flex items-center gap-2">
              <Cpu className="w-4 h-4" />
              Servidores MCP & Bônus de Especialização:
            </span>
            <span className="text-[10px] text-slate-400">
              {mcpCount === 1 ? '🔥 Ultra-Especialista (+20% Overclock & 1.25x Placar)' : mcpCount === 2 ? '⚡ Foco Tático (+10% Overclock & 1.10x Placar)' : '🌐 Generalista (Versatilidade Total)'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* weapons-arsenal */}
            <button
              type="button"
              onClick={() => toggleMcp('weapons-arsenal')}
              className={`p-3.5 rounded-2xl border text-left transition-all flex flex-col justify-between gap-2 ${
                selectedMcps.includes('weapons-arsenal')
                  ? 'border-[#ff9e0b] bg-[#ff9e0b]/10 text-white shadow-lg'
                  : 'border-slate-800 bg-slate-900/40 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-xs text-[#ff9e0b]">weapons-arsenal</span>
                {selectedMcps.includes('weapons-arsenal') && <CheckCircle2 className="w-4 h-4 text-[#ff9e0b]" />}
              </div>
              <p className="text-[11px] text-slate-300 leading-snug">
                Canhões primários (Laser, Vulcan, Plasma) e mísseis secundários.
              </p>
              {mcpCount === 1 && selectedMcps.includes('weapons-arsenal') && (
                <span className="text-[10px] font-bold text-[#ff9e0b] font-mono">⚡ Overclock: +20% DPS Ativo!</span>
              )}
            </button>

            {/* hull-propulsion */}
            <button
              type="button"
              onClick={() => toggleMcp('hull-propulsion')}
              className={`p-3.5 rounded-2xl border text-left transition-all flex flex-col justify-between gap-2 ${
                selectedMcps.includes('hull-propulsion')
                  ? 'border-[#38bdf8] bg-[#38bdf8]/10 text-white shadow-lg'
                  : 'border-slate-800 bg-slate-900/40 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-xs text-[#38bdf8]">hull-propulsion</span>
                {selectedMcps.includes('hull-propulsion') && <CheckCircle2 className="w-4 h-4 text-[#38bdf8]" />}
              </div>
              <p className="text-[11px] text-slate-300 leading-snug">
                Propulsores de esquiva rápida, aceleração turbo e peso do casco.
              </p>
              {mcpCount === 1 && selectedMcps.includes('hull-propulsion') && (
                <span className="text-[10px] font-bold text-[#38bdf8] font-mono">⚡ Overclock: +20% Velocidade Ativo!</span>
              )}
            </button>

            {/* cybernetics-shields */}
            <button
              type="button"
              onClick={() => toggleMcp('cybernetics-shields')}
              className={`p-3.5 rounded-2xl border text-left transition-all flex flex-col justify-between gap-2 ${
                selectedMcps.includes('cybernetics-shields')
                  ? 'border-[#10b981] bg-[#10b981]/10 text-white shadow-lg'
                  : 'border-slate-800 bg-slate-900/40 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-xs text-[#10b981]">cybernetics-shields</span>
                {selectedMcps.includes('cybernetics-shields') && <CheckCircle2 className="w-4 h-4 text-[#10b981]" />}
              </div>
              <p className="text-[11px] text-slate-300 leading-snug">
                Camadas de escudos energéticos e módulos de sinergia matricial.
              </p>
              {mcpCount === 1 && selectedMcps.includes('cybernetics-shields') && (
                <span className="text-[10px] font-bold text-[#10b981] font-mono">⚡ Overclock: +1 Escudo Extra Ativo!</span>
              )}
            </button>
          </div>
        </div>

        {/* Subagent Selection */}
        <div className="space-y-2 bg-slate-900/60 p-4 rounded-2xl border border-slate-800">
          <span className="text-xs font-bold text-[#38bdf8] uppercase block font-mono">
            Sub-Agente Tático para o Terminal AGY
          </span>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setSelectedTacticalAgent('combat-strategist')}
              className={`p-3 rounded-xl border text-left text-xs flex justify-between items-center transition-all ${
                selectedTacticalAgent === 'combat-strategist'
                  ? 'border-[#ff9e0b] bg-[#ff9e0b]/10 text-white font-bold'
                  : 'border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div>
                <div className="text-xs font-bold text-white font-mono">combat-strategist</div>
                <div className="text-[10px] text-slate-400">Especialista em canhões, cadência e mísseis</div>
              </div>
              {selectedTacticalAgent === 'combat-strategist' && <CheckCircle2 className="w-4 h-4 text-[#ff9e0b]" />}
            </button>

            <button
              type="button"
              onClick={() => setSelectedTacticalAgent('systems-engineer')}
              className={`p-3 rounded-xl border text-left text-xs flex justify-between items-center transition-all ${
                selectedTacticalAgent === 'systems-engineer'
                  ? 'border-[#10b981] bg-[#10b981]/10 text-white font-bold'
                  : 'border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div>
                <div className="text-xs font-bold text-white font-mono">systems-engineer</div>
                <div className="text-[10px] text-slate-400">Especialista em blindagem, velocidade e escudos</div>
              </div>
              {selectedTacticalAgent === 'systems-engineer' && <CheckCircle2 className="w-4 h-4 text-[#10b981]" />}
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onBack}
            className="w-1/3 p-3.5 rounded-xl border border-slate-700 text-slate-300 text-xs font-bold uppercase hover:bg-slate-800 transition-all flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Voltar às Instruções</span>
          </button>
          <button
            type="button"
            onClick={handleStartForge}
            className="w-2/3 p-3.5 rounded-xl bg-gradient-to-r from-[#ff9e0b] to-[#f59e0b] text-black text-xs font-black uppercase tracking-wider hover:scale-[1.02] transition-all shadow-[0_0_25px_rgba(255,158,11,0.5)] flex items-center justify-center gap-2"
          >
            <span>Iniciar Forja no Antigravity CLI</span>
            <ChevronRight className="w-4 h-4 stroke-[3]" />
          </button>
        </div>
      </div>
    </div>
  );
}
