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
      color: '#38bdf8',
      tag: 'Especialista em Ataque'
    },
    {
      title: '🚀 Heavy Missile Bomber',
      archetype: 'Chuva de Mísseis & Blindagem Titânio',
      prompt: 'Forje um bombardeiro pesado com blindagem reforçada e chuva de mísseis teleguiados.',
      color: '#ff9e0b',
      tag: 'Especialista em Defesa'
    },
    {
      title: '💥 Vulcan Spread Striker',
      archetype: 'Canhões Triplos em Leque & Glass Cannon',
      prompt: 'Estilo Solar Gold com canhões vulcan espalhados e sinergia Glass Cannon.',
      color: '#f59e0b',
      tag: 'Tiro em Área'
    },
    {
      title: '🛡️ Obsidian Stealth EMP',
      archetype: 'Furtividade & Pulso Eletromagnético',
      prompt: 'Caça furtivo Obsidian com propulsores ágeis e pulso EMP de choque eletromagnético.',
      color: '#60a5fa',
      tag: 'Controle de Campo'
    },
    {
      title: '🛸 Tactical Vanguard Ace',
      archetype: 'Nave Equilibrada & Drones Autônomos',
      prompt: 'Nave balanceada com drones de escolta e canhão de plasma penetrante.',
      color: '#10b981',
      tag: 'Tático Balanceado'
    }
  ];

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 select-none overflow-y-auto font-sans">
      <div className="w-full max-w-4xl flight-panel p-7 rounded-3xl border border-slate-700/60 shadow-2xl space-y-6 my-4">
        {/* Header */}
        <div className="flex justify-between items-center pb-4 border-b border-slate-700/60">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-md bg-[#38bdf8]/10 text-[#38bdf8] border border-[#38bdf8]/30 uppercase tracking-widest font-mono">
                Etapa 2 de 4 // Briefing de Voo
              </span>
              <span className="text-xs text-slate-400 font-mono">Google Cloud Summit 2026</span>
            </div>
            <h2 className="text-2xl font-black text-white tracking-wider uppercase">
              INSTRUÇÕES DA FORJA & INSPIRAÇÃO
            </h2>
          </div>

          <div className="text-right font-mono">
            <div className="text-xs text-slate-400 uppercase">Piloto</div>
            <div className="text-sm font-bold text-[#ff9e0b]">
              {pilot.callsign} <span className="text-slate-400 font-normal">({pilot.company_canonical})</span>
            </div>
          </div>
        </div>

        {/* 3 Step Flow Guide */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-1.5">
            <div className="w-7 h-7 rounded-lg bg-[#38bdf8]/10 text-[#38bdf8] font-bold text-xs flex items-center justify-center border border-[#38bdf8]/30 font-mono">
              1
            </div>
            <h3 className="text-sm font-bold text-white">Alocação de Energia</h3>
            <p className="text-xs text-slate-400 leading-snug">
              Distribua 100 PU de energia entre Ataque, Velocidade, Defesa e Escudos na próxima tela.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-1.5">
            <div className="w-7 h-7 rounded-lg bg-[#ff9e0b]/10 text-[#ff9e0b] font-bold text-xs flex items-center justify-center border border-[#ff9e0b]/30 font-mono">
              2
            </div>
            <h3 className="text-sm font-bold text-white">Forja no Antigravity CLI</h3>
            <p className="text-xs text-slate-400 leading-snug">
              No terminal (<code className="text-[#ff9e0b]">agy</code>), converse em linguagem natural para calibrar suas armas e geometria visual SVG.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-1.5">
            <div className="w-7 h-7 rounded-lg bg-[#10b981]/10 text-[#10b981] font-bold text-xs flex items-center justify-center border border-[#10b981]/30 font-mono">
              3
            </div>
            <h3 className="text-sm font-bold text-white">Combate & Placar</h3>
            <p className="text-xs text-slate-400 leading-snug">
              Decole em um combate de 90 segundos, derrote esquadrões de drones e enfrente o <b>Cyber Overlord</b>!
            </p>
          </div>
        </div>

        {/* Synergy Explanation Box */}
        <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-700/60 space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-[#ff9e0b] uppercase tracking-wider font-mono">
            <HelpCircle className="w-4 h-4 text-[#ff9e0b]" />
            <span>Como os Sliders de Energia e o seu Prompt se conectam:</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-slate-300">
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
              <span className="font-bold text-[#38bdf8] flex items-center gap-1.5 font-mono">
                <Zap className="w-3.5 h-3.5" /> 1. Sliders (100 PU) = Orçamento Físico
              </span>
              <p className="text-[11px] text-slate-400">
                Determinam os <b>limites estruturais</b>: o teto máximo de DPS, velocidade linear e barras de vida do casco.
              </p>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1">
              <span className="font-bold text-[#ff9e0b] flex items-center gap-1.5 font-mono">
                <Terminal className="w-3.5 h-3.5" /> 2. Prompt no AGY = Especialização & Estilo
              </span>
              <p className="text-[11px] text-slate-400">
                Define <b>como</b> essa energia é usada: tipo de canhões (Laser vs Vulcan), mísseis teleguiados e a paleta aeroespacial da fuselagem.
              </p>
            </div>
          </div>
        </div>

        {/* Inspirational Prompt Cards */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-[#ff9e0b] uppercase tracking-wider flex items-center gap-2 font-mono">
              <Sparkles className="w-4 h-4 text-[#ff9e0b]" />
              Exemplos de Prompts Inspiradores (Clique para Copiar)
            </h3>
            <span className="text-[10px] text-slate-400 font-mono">Você poderá digitar ou colar no terminal</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            {PROMPT_SUGGESTIONS.map((item, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleCopy(item.prompt, idx)}
                className="p-3.5 rounded-2xl bg-slate-900/60 hover:bg-slate-800/80 border border-slate-800 hover:border-slate-600 text-left transition-all flex flex-col justify-between gap-2.5 group"
              >
                <div>
                  <span
                    className="text-[9px] font-bold px-2 py-0.5 rounded uppercase block w-fit mb-1.5 font-mono"
                    style={{ backgroundColor: `${item.color}15`, color: item.color, border: `1px solid ${item.color}30` }}
                  >
                    {item.tag}
                  </span>
                  <h4 className="text-xs font-bold text-white group-hover:text-[#ff9e0b] transition-colors">
                    {item.title}
                  </h4>
                  <p className="text-[10px] text-slate-400 mt-1 italic leading-snug line-clamp-3">
                    "{item.prompt}"
                  </p>
                </div>

                <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-[10px] font-bold text-slate-500 group-hover:text-white font-mono">
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
            className="w-1/3 p-3.5 rounded-xl border border-slate-700 text-slate-300 text-xs font-bold uppercase hover:bg-slate-800 transition-all flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Voltar ao Registro</span>
          </button>
          <button
            type="button"
            onClick={onProceed}
            className="w-2/3 p-3.5 rounded-xl bg-gradient-to-r from-[#ff9e0b] to-[#f59e0b] text-black text-xs font-black uppercase tracking-wider hover:scale-[1.02] transition-all shadow-[0_0_25px_rgba(255,158,11,0.5)] flex items-center justify-center gap-2"
          >
            <span>Configurar Energia & MCPs</span>
            <ChevronRight className="w-4 h-4 stroke-[3]" />
          </button>
        </div>
      </div>
    </div>
  );
}
