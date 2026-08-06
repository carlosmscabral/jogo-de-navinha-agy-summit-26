import React, { useState } from 'react';
import { PilotInfo } from '@jogo/shared';
import { Sparkles, Terminal, ChevronRight, Zap, Flame, Shield, Crosshair, HelpCircle, Copy, Check, ArrowLeft } from 'lucide-react';

interface InstructionsPromptScreenProps {
  pilot: PilotInfo;
  onProceed: () => void;
  onBack: () => void;
}

export function InstructionsPromptScreen({ pilot, onProceed, onBack }: InstructionsPromptScreenProps) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const PROMPT_SUGGESTIONS = [
    {
      title: '⚡ Laser Piercer Ultra',
      archetype: 'DPS Crítico & Alta Velocidade',
      prompt: 'Quero um caça ultrarrápido com lasers azuis contínuos, velocidade máxima e escudo duplo.',
      color: '#00f3ff',
      tag: 'Especialista em Ataque'
    },
    {
      title: '🚀 Heavy Missile Bomber',
      archetype: 'Chuva de Mísseis & Blindagem Titânio',
      prompt: 'Forje um bombardeiro pesado com blindagem reforçada e chuva de mísseis teleguiados.',
      color: '#ffd700',
      tag: 'Especialista em Defesa'
    },
    {
      title: '💥 Cyberpunk Vulcan Spread',
      archetype: 'Canhões Triplos em Leque & Glass Cannon',
      prompt: 'Estilo Cyberpunk Gold com canhões vulcan espalhados e sinergia Glass Cannon.',
      color: '#ff0055',
      tag: 'Tiro em Área'
    },
    {
      title: '🛡️ Dark Void Stealth EMP',
      archetype: 'Furtividade & Pulso Eletromagnético',
      prompt: 'Caça furtivo Dark Void com propulsores ágeis e pulso EMP de choque eletromagnético.',
      color: '#8b00ff',
      tag: 'Controle de Campo'
    },
    {
      title: '🛸 Synthwave Drone Escort',
      archetype: 'Nave Equilibrada & Drones Autônomos',
      prompt: 'Nave Synthwave 80s balanceada com drones de escolta e canhão de plasma penetrante.',
      color: '#00ff88',
      tag: 'Tático Balanceado'
    }
  ];

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 bg-radial from-[#15082e] via-[#080214] to-[#020108] select-none overflow-y-auto font-sans">
      <div className="w-full max-w-4xl glass-panel p-7 rounded-3xl border border-[#00f3ff]/30 shadow-2xl space-y-6 my-4">
        {/* Header */}
        <div className="flex justify-between items-center pb-4 border-b border-white/10">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-[#00f3ff]/20 text-[#00f3ff] border border-[#00f3ff]/30 uppercase tracking-widest">
                Etapa 2 de 4 // Briefing da Missão
              </span>
              <span className="text-xs text-gray-400">Google Cloud Summit 2026</span>
            </div>
            <h2 className="text-2xl font-black text-white tracking-wider uppercase">
              INSTRUÇÕES DA FORJA & INSPIRAÇÃO
            </h2>
          </div>

          <div className="text-right">
            <div className="text-xs text-gray-400 uppercase">Piloto</div>
            <div className="text-sm font-bold text-[#00f3ff]">
              {pilot.callsign} <span className="text-gray-400 font-normal">({pilot.company_canonical})</span>
            </div>
          </div>
        </div>

        {/* 3 Step Flow Guide */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="p-4 rounded-2xl bg-black/40 border border-white/10 space-y-1.5">
            <div className="w-7 h-7 rounded-lg bg-[#00f3ff]/20 text-[#00f3ff] font-bold text-xs flex items-center justify-center border border-[#00f3ff]/40">
              1
            </div>
            <h3 className="text-sm font-bold text-white">Alocação de Energia</h3>
            <p className="text-xs text-gray-400 leading-snug">
              Na próxima tela, você distribui 100 PU de energia entre Ataque, Velocidade, Defesa e Escudos.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-black/40 border border-white/10 space-y-1.5">
            <div className="w-7 h-7 rounded-lg bg-[#ffd700]/20 text-[#ffd700] font-bold text-xs flex items-center justify-center border border-[#ffd700]/40">
              2
            </div>
            <h3 className="text-sm font-bold text-white">Forja no Antigravity CLI</h3>
            <p className="text-xs text-gray-400 leading-snug">
              No terminal (<code className="text-[#ffd700]">agy</code>), converse em linguagem natural com os sub-agentes para calibrar suas armas e estética.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-black/40 border border-white/10 space-y-1.5">
            <div className="w-7 h-7 rounded-lg bg-[#00ff88]/20 text-[#00ff88] font-bold text-xs flex items-center justify-center border border-[#00ff88]/40">
              3
            </div>
            <h3 className="text-sm font-bold text-white">Combate & Placar</h3>
            <p className="text-xs text-gray-400 leading-snug">
              Decole em um combate de 90 segundos, derrote ondas de drones e enfrente o <b>Cyber Overlord</b>!
            </p>
          </div>
        </div>

        {/* Synergy Explanation Box */}
        <div className="p-4 rounded-2xl bg-gradient-to-r from-purple-950/40 via-black/60 to-cyan-950/40 border border-[#00f3ff]/20 space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-[#ffd700] uppercase tracking-wider">
            <HelpCircle className="w-4 h-4" />
            <span>Como os Sliders de Energia e o seu Prompt se conectam:</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-gray-300">
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 space-y-1">
              <span className="font-bold text-[#00f3ff] flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5" /> 1. Sliders (100 PU) = Orçamento Energético
              </span>
              <p className="text-[11px] text-gray-400">
                Determinam os <b>limites físicos</b> da nave: o teto máximo de DPS, velocidade linear de esquiva e a quantidade de barras de vida.
              </p>
            </div>
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5 space-y-1">
              <span className="font-bold text-[#ff0055] flex items-center gap-1.5">
                <Terminal className="w-3.5 h-3.5" /> 2. Prompt no AGY = Especialização & Estilo
              </span>
              <p className="text-[11px] text-gray-400">
                Define <b>como</b> essa energia é usada: o tipo de canhão (Laser contínuo vs Vulcan em leque), mísseis teleguiados e as cores da fuselagem SVG.
              </p>
            </div>
          </div>
        </div>

        {/* Inspirational Prompt Cards */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-[#ffd700] uppercase tracking-wider flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              Exemplos de Prompts Inspiradores (Clique para Copiar)
            </h3>
            <span className="text-[10px] text-gray-400">Você poderá digitar ou colar no terminal</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            {PROMPT_SUGGESTIONS.map((item, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleCopy(item.prompt, idx)}
                className="p-3.5 rounded-2xl bg-black/40 hover:bg-white/[0.06] border border-white/10 hover:border-[#00f3ff]/60 text-left transition-all flex flex-col justify-between gap-2.5 group"
              >
                <div>
                  <span
                    className="text-[9px] font-bold px-2 py-0.5 rounded uppercase block w-fit mb-1.5"
                    style={{ backgroundColor: `${item.color}20`, color: item.color, border: `1px solid ${item.color}40` }}
                  >
                    {item.tag}
                  </span>
                  <h4 className="text-xs font-bold text-white group-hover:text-[#00f3ff] transition-colors">
                    {item.title}
                  </h4>
                  <p className="text-[10px] text-gray-400 mt-1 italic leading-snug line-clamp-3">
                    "{item.prompt}"
                  </p>
                </div>

                <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[10px] font-bold text-gray-500 group-hover:text-white">
                  <span>{copiedIndex === idx ? '✓ COPIADO!' : 'Copiar'}</span>
                  {copiedIndex === idx ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </div>
              </button>
            ))}
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
            <span>Voltar ao Cadastro</span>
          </button>
          <button
            type="button"
            onClick={onProceed}
            className="w-2/3 p-3.5 rounded-xl bg-gradient-to-r from-[#00f3ff] to-[#ff0055] text-black text-xs font-black uppercase tracking-wider hover:scale-[1.02] transition-all shadow-[0_0_25px_rgba(0,243,255,0.6)] flex items-center justify-center gap-2"
          >
            <span>Configurar Energia & MCPs</span>
            <ChevronRight className="w-4 h-4 stroke-[3]" />
          </button>
        </div>
      </div>
    </div>
  );
}
