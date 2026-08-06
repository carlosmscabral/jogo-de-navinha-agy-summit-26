import React, { useState } from 'react';
import { EnergySliders, McpServerName, SubagentName, PilotInfo } from '@jogo/shared';
import { Zap, Shield, Sparkles, Crosshair, ChevronRight, CheckCircle2, Cpu, Flame, Gauge, Layers, Award, ArrowLeft, Info } from 'lucide-react';

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

  // Gamification Tradeoff Calculations:
  // 1 MCP = +20% Overclock + 1.25x Score Multiplier
  // 2 MCPs = +10% Overclock + 1.10x Score Multiplier
  // 3 MCPs = Full Versatility + 1.00x Score Multiplier
  const mcpCount = selectedMcps.length;
  const overclockMultiplier = mcpCount === 1 ? 1.2 : mcpCount === 2 ? 1.1 : 1.0;
  const scoreMultiplier = mcpCount === 1 ? 1.25 : mcpCount === 2 ? 1.1 : 1.0;

  // Live Projected Stats calculations based on 100 PU sliders + Overclock
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
    <div className="flex-1 flex flex-col items-center justify-center p-6 bg-radial from-[#15082e] via-[#080214] to-[#020108] select-none overflow-y-auto font-sans">
      <div className="w-full max-w-4xl glass-panel p-7 rounded-3xl border border-[#00f3ff]/30 shadow-2xl space-y-6 my-4">
        {/* Header */}
        <div className="flex justify-between items-center pb-4 border-b border-white/10">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-[#00f3ff]/20 text-[#00f3ff] border border-[#00f3ff]/30 uppercase tracking-widest">
                Etapa 3 de 4 // Configuração da Nave
              </span>
              <span className="text-xs text-gray-400">Google Cloud Summit 2026</span>
            </div>
            <h2 className="text-2xl font-black text-white tracking-wider uppercase">
              FORJA DE ENERGIA & SERVIDORES MCP
            </h2>
          </div>

          <div className="px-3.5 py-1.5 rounded-xl bg-[#00f3ff]/10 border border-[#00f3ff]/40 text-[#00f3ff] text-xs font-bold flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-[#ffd700]" />
            <span>{detectedSynergy}</span>
          </div>
        </div>

        {/* Quick Presets */}
        <div className="space-y-2">
          <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider block">
            Arquétipos Rápidos (100 PU de Energia Total):
          </span>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <button
              type="button"
              onClick={() => applyPreset({ offense: 45, speed: 35, defense: 10, tech: 10 })}
              className={`p-2.5 rounded-xl border text-left transition-all ${
                sliders.offense >= 40
                  ? 'bg-[#ff0055]/20 border-[#ff0055] text-white font-bold'
                  : 'bg-white/[0.02] border-white/10 text-gray-400 hover:border-white/20'
              }`}
            >
              <div className="text-xs font-bold text-[#ff0055]">⚡ Glass Cannon</div>
              <div className="text-[10px] text-gray-400">45 ATK / 35 SPD</div>
            </button>

            <button
              type="button"
              onClick={() => applyPreset({ offense: 15, speed: 20, defense: 45, tech: 20 })}
              className={`p-2.5 rounded-xl border text-left transition-all ${
                sliders.defense >= 40
                  ? 'bg-[#00ff88]/20 border-[#00ff88] text-white font-bold'
                  : 'bg-white/[0.02] border-white/10 text-gray-400 hover:border-white/20'
              }`}
            >
              <div className="text-xs font-bold text-[#00ff88]">🛡️ Titan Fortress</div>
              <div className="text-[10px] text-gray-400">45 DEF / 20 TEC</div>
            </button>

            <button
              type="button"
              onClick={() => applyPreset({ offense: 25, speed: 45, defense: 15, tech: 15 })}
              className={`p-2.5 rounded-xl border text-left transition-all ${
                sliders.speed >= 40
                  ? 'bg-[#ffd700]/20 border-[#ffd700] text-white font-bold'
                  : 'bg-white/[0.02] border-white/10 text-gray-400 hover:border-white/20'
              }`}
            >
              <div className="text-xs font-bold text-[#ffd700]">💨 Ghost Interceptor</div>
              <div className="text-[10px] text-gray-400">45 SPD / 25 ATK</div>
            </button>

            <button
              type="button"
              onClick={() => applyPreset({ offense: 25, speed: 25, defense: 25, tech: 25 })}
              className={`p-2.5 rounded-xl border text-left transition-all ${
                sliders.offense === 25 && sliders.defense === 25
                  ? 'bg-[#00f3ff]/20 border-[#00f3ff] text-white font-bold'
                  : 'bg-white/[0.02] border-white/10 text-gray-400 hover:border-white/20'
              }`}
            >
              <div className="text-xs font-bold text-[#00f3ff]">🎯 Balanced Ace</div>
              <div className="text-[10px] text-gray-400">25 em Tudo</div>
            </button>
          </div>
        </div>

        {/* 4 Energy Sliders + Live Stats Breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
          {/* Sliders (7 cols) */}
          <div className="md:col-span-7 space-y-3.5 bg-black/40 p-5 rounded-2xl border border-white/10">
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs font-bold text-gray-200 uppercase">Matriz de Energia (100 PU Total)</span>
              <span className="text-xs text-[#00ff88] font-bold font-mono">100 / 100 PU</span>
            </div>

            {/* Offense */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-300">
                <span className="flex items-center gap-1.5 text-[#ff0055] font-bold">
                  <Crosshair className="w-3.5 h-3.5" /> ATAQUE / CANHÕES
                </span>
                <span className="font-mono font-bold text-[#ff0055]">{sliders.offense} PU</span>
              </div>
              <input
                type="range"
                min={10}
                max={50}
                value={sliders.offense}
                onChange={(e) => handleSliderChange('offense', Number(e.target.value))}
                className="w-full accent-[#ff0055] cursor-pointer"
              />
            </div>

            {/* Speed */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-300">
                <span className="flex items-center gap-1.5 text-[#ffd700] font-bold">
                  <Zap className="w-3.5 h-3.5" /> VELOCIDADE / PROPULSÃO
                </span>
                <span className="font-mono font-bold text-[#ffd700]">{sliders.speed} PU</span>
              </div>
              <input
                type="range"
                min={10}
                max={50}
                value={sliders.speed}
                onChange={(e) => handleSliderChange('speed', Number(e.target.value))}
                className="w-full accent-[#ffd700] cursor-pointer"
              />
            </div>

            {/* Defense */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-300">
                <span className="flex items-center gap-1.5 text-[#00ff88] font-bold">
                  <Shield className="w-3.5 h-3.5" /> DEFESA / BLINDAGEM (HP)
                </span>
                <span className="font-mono font-bold text-[#00ff88]">{sliders.defense} PU</span>
              </div>
              <input
                type="range"
                min={10}
                max={50}
                value={sliders.defense}
                onChange={(e) => handleSliderChange('defense', Number(e.target.value))}
                className="w-full accent-[#00ff88] cursor-pointer"
              />
            </div>

            {/* Tech */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-300">
                <span className="flex items-center gap-1.5 text-[#00f3ff] font-bold">
                  <Cpu className="w-3.5 h-3.5" /> TECNOLOGIA / ESCUDOS
                </span>
                <span className="font-mono font-bold text-[#00f3ff]">{sliders.tech} PU</span>
              </div>
              <input
                type="range"
                min={10}
                max={50}
                value={sliders.tech}
                onChange={(e) => handleSliderChange('tech', Number(e.target.value))}
                className="w-full accent-[#00f3ff] cursor-pointer"
              />
            </div>
          </div>

          {/* Live Projected Stats Gauge (5 cols) */}
          <div className="md:col-span-5 flex flex-col justify-between bg-black/40 p-5 rounded-2xl border border-white/10">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">
                Telemetria Projetada
              </span>
              {mcpCount === 1 && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#ffd700]/20 text-[#ffd700] border border-[#ffd700]/40 animate-pulse">
                  ⚡ +20% OVERCLOCK
                </span>
              )}
            </div>

            <div className="space-y-2.5 font-mono text-xs">
              <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 flex items-center justify-between">
                <span className="text-gray-400 flex items-center gap-1.5">
                  <Flame className="w-3.5 h-3.5 text-[#ff0055]" /> Dano Base
                </span>
                <span className="font-bold text-[#ff0055]">~{projectedDps} DPS</span>
              </div>

              <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 flex items-center justify-between">
                <span className="text-gray-400 flex items-center gap-1.5">
                  <Gauge className="w-3.5 h-3.5 text-[#ffd700]" /> Velocidade
                </span>
                <span className="font-bold text-[#ffd700]">{projectedSpeed} px/s</span>
              </div>

              <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 flex items-center justify-between">
                <span className="text-gray-400 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-[#00ff88]" /> Casco
                </span>
                <span className="font-bold text-[#00ff88]">{projectedHp} HP</span>
              </div>

              <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 flex items-center justify-between">
                <span className="text-gray-400 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-[#00f3ff]" /> Escudos
                </span>
                <span className="font-bold text-[#00f3ff]">{projectedShields} Camada(s)</span>
              </div>
            </div>

            <div className="mt-3 p-2.5 rounded-xl bg-[#00f3ff]/5 border border-[#00f3ff]/20 flex items-center justify-between text-xs">
              <span className="text-gray-300 font-bold flex items-center gap-1.5">
                <Award className="w-4 h-4 text-[#ffd700]" /> Multiplicador Placar:
              </span>
              <span className="font-mono font-black text-[#ffd700] text-sm">
                {scoreMultiplier.toFixed(2)}x
              </span>
            </div>
          </div>
        </div>

        {/* MCP Selection & GAMIFICATION TRADEOFF EXPLAINER */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#ffd700] uppercase tracking-wider flex items-center gap-2">
              <Cpu className="w-4 h-4" />
              Servidores MCP & Tradeoffs de Especialização (Clique para Ativar/Desativar):
            </span>
            <span className="text-[10px] text-gray-400">
              {mcpCount === 1 ? '🔥 Modo Ultra-Especialista (+20% Overclock & 1.25x Placar)' : mcpCount === 2 ? '⚡ Modo Foco Tático (+10% Overclock & 1.10x Placar)' : '🌐 Modo Generalista Completo (Versatilidade Total & 1.00x Placar)'}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* weapons-arsenal */}
            <button
              type="button"
              onClick={() => toggleMcp('weapons-arsenal')}
              className={`p-3.5 rounded-2xl border text-left transition-all flex flex-col justify-between gap-2 ${
                selectedMcps.includes('weapons-arsenal')
                  ? 'border-[#ff0055] bg-[#ff0055]/15 text-white shadow-lg shadow-[#ff0055]/10'
                  : 'border-white/10 bg-white/[0.02] text-gray-400 hover:border-white/20'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-xs text-[#ff0055]">weapons-arsenal</span>
                {selectedMcps.includes('weapons-arsenal') && <CheckCircle2 className="w-4 h-4 text-[#ff0055]" />}
              </div>
              <p className="text-[11px] text-gray-300 leading-snug">
                Canhões primários (Laser, Vulcan, Plasma) e mísseis secundários.
              </p>
              {mcpCount === 1 && selectedMcps.includes('weapons-arsenal') && (
                <span className="text-[10px] font-bold text-[#ffd700]">⚡ Overclock: +20% DPS Ativo!</span>
              )}
            </button>

            {/* hull-propulsion */}
            <button
              type="button"
              onClick={() => toggleMcp('hull-propulsion')}
              className={`p-3.5 rounded-2xl border text-left transition-all flex flex-col justify-between gap-2 ${
                selectedMcps.includes('hull-propulsion')
                  ? 'border-[#ffd700] bg-[#ffd700]/15 text-white shadow-lg shadow-[#ffd700]/10'
                  : 'border-white/10 bg-white/[0.02] text-gray-400 hover:border-white/20'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-xs text-[#ffd700]">hull-propulsion</span>
                {selectedMcps.includes('hull-propulsion') && <CheckCircle2 className="w-4 h-4 text-[#ffd700]" />}
              </div>
              <p className="text-[11px] text-gray-300 leading-snug">
                Propulsores de esquiva rápida, aceleração turbo e peso do casco.
              </p>
              {mcpCount === 1 && selectedMcps.includes('hull-propulsion') && (
                <span className="text-[10px] font-bold text-[#ffd700]">⚡ Overclock: +20% Velocidade Ativo!</span>
              )}
            </button>

            {/* cybernetics-shields */}
            <button
              type="button"
              onClick={() => toggleMcp('cybernetics-shields')}
              className={`p-3.5 rounded-2xl border text-left transition-all flex flex-col justify-between gap-2 ${
                selectedMcps.includes('cybernetics-shields')
                  ? 'border-[#00f3ff] bg-[#00f3ff]/15 text-white shadow-lg shadow-[#00f3ff]/10'
                  : 'border-white/10 bg-white/[0.02] text-gray-400 hover:border-white/20'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-xs text-[#00f3ff]">cybernetics-shields</span>
                {selectedMcps.includes('cybernetics-shields') && <CheckCircle2 className="w-4 h-4 text-[#00f3ff]" />}
              </div>
              <p className="text-[11px] text-gray-300 leading-snug">
                Camadas de escudos energéticos e módulos de sinergia matricial.
              </p>
              {mcpCount === 1 && selectedMcps.includes('cybernetics-shields') && (
                <span className="text-[10px] font-bold text-[#ffd700]">⚡ Overclock: +1 Escudo Extra Ativo!</span>
              )}
            </button>
          </div>
        </div>

        {/* Subagent Selection */}
        <div className="space-y-2 bg-black/40 p-4 rounded-2xl border border-white/10">
          <span className="text-xs font-bold text-[#00f3ff] uppercase block">
            Sub-Agente Tático para Forja no Terminal
          </span>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setSelectedTacticalAgent('combat-strategist')}
              className={`p-3 rounded-xl border text-left text-xs flex justify-between items-center transition-all ${
                selectedTacticalAgent === 'combat-strategist'
                  ? 'border-[#ff0055] bg-[#ff0055]/15 text-white font-bold'
                  : 'border-white/10 text-gray-400 hover:border-white/20'
              }`}
            >
              <div>
                <div className="text-xs font-bold text-white">combat-strategist</div>
                <div className="text-[10px] text-gray-400">Especialista em canhões, cadência e mísseis</div>
              </div>
              {selectedTacticalAgent === 'combat-strategist' && <CheckCircle2 className="w-4 h-4 text-[#ff0055]" />}
            </button>

            <button
              type="button"
              onClick={() => setSelectedTacticalAgent('systems-engineer')}
              className={`p-3 rounded-xl border text-left text-xs flex justify-between items-center transition-all ${
                selectedTacticalAgent === 'systems-engineer'
                  ? 'border-[#00ff88] bg-[#00ff88]/15 text-white font-bold'
                  : 'border-white/10 text-gray-400 hover:border-white/20'
              }`}
            >
              <div>
                <div className="text-xs font-bold text-white">systems-engineer</div>
                <div className="text-[10px] text-gray-400">Especialista em blindagem, velocidade e escudos</div>
              </div>
              {selectedTacticalAgent === 'systems-engineer' && <CheckCircle2 className="w-4 h-4 text-[#00ff88]" />}
            </button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onBack}
            className="w-1/3 p-3.5 rounded-xl border border-white/15 text-gray-300 text-xs font-bold uppercase hover:bg-white/5 transition-all flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Voltar às Instruções</span>
          </button>
          <button
            type="button"
            onClick={handleStartForge}
            className="w-2/3 p-3.5 rounded-xl bg-gradient-to-r from-[#00f3ff] to-[#ff0055] text-black text-xs font-black uppercase tracking-wider hover:scale-[1.02] transition-all shadow-[0_0_25px_rgba(0,243,255,0.6)] flex items-center justify-center gap-2"
          >
            <span>Iniciar Forja no Antigravity CLI</span>
            <ChevronRight className="w-4 h-4 stroke-[3]" />
          </button>
        </div>
      </div>
    </div>
  );
}
