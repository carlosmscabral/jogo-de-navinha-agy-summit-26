import React from 'react';
import { Rocket, Sparkles, Download, Presentation } from 'lucide-react';
import { ANTIGRAVITY_SECTIONS } from '../antigravity-content.js';

interface AntigravityShowcaseProps {
  /** Índice da seção. Quem decide é o `rotationReducer`; este componente só desenha. */
  section: number;
  /** `> 0` significa retenção manual ativa — vira a contagem regressiva do apresentador. */
  holdMs: number;
}

/** Um ícone por seção, na ordem de `ANTIGRAVITY_SECTIONS`. */
const SECTION_ICON = [Rocket, Sparkles, Download];

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(total / 60);
  const seg = total % 60;
  return `${min}:${String(seg).padStart(2, '0')}`;
}

/**
 * A segunda visão do telão: o que é o Antigravity, por que ele é diferente e como levar para casa.
 *
 * O texto todo vem de `antigravity-content.ts` — nada de frase escrita aqui dentro, para quem for
 * revisar a mensagem do estande não precisar abrir um arquivo de layout.
 */
export function AntigravityShowcase({ section, holdMs }: AntigravityShowcaseProps) {
  const atual = ANTIGRAVITY_SECTIONS[section] ?? ANTIGRAVITY_SECTIONS[0];
  if (!atual) return null;

  const Icon = SECTION_ICON[section % SECTION_ICON.length];
  // Duas colunas a partir de 4 itens: é o que deixa as 6 superfícies caberem sem encolher nada.
  const duasColunas = atual.items.length > 3;

  return (
    <div className="flight-panel p-10 rounded-3xl border border-slate-700/60 shadow-2xl flex flex-col h-full animate-fadeIn">
      {/* Cabeçalho da seção */}
      <div className="flex items-center justify-between pb-5 border-b border-slate-700/60 flex-shrink-0">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl bg-[#38bdf8]/10 border border-[#38bdf8]/30 text-[#38bdf8]">
            <Icon className="w-8 h-8" />
          </div>
          <div>
            <p className="text-xs text-[#38bdf8] font-mono tracking-widest uppercase">{atual.kicker}</p>
            <h2 className="text-3xl font-black text-white tracking-wider uppercase font-sans text-glow-cobalt">
              {atual.title}
            </h2>
          </div>
        </div>

        {/* Pontinhos de progresso: onde estamos no ciclo de três seções. */}
        <div className="flex items-center gap-2.5">
          {ANTIGRAVITY_SECTIONS.map((s, i) => (
            <span
              key={s.id}
              className={`rounded-full transition-all ${
                i === section ? 'w-8 h-2.5 bg-[#ff9e0b] glow-amber' : 'w-2.5 h-2.5 bg-slate-700'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Itens da seção */}
      <div
        className={`flex-1 min-h-0 mt-6 grid gap-x-8 gap-y-4 content-center ${
          duasColunas ? 'grid-cols-2' : 'grid-cols-1'
        }`}
      >
        {atual.items.map((item) => (
          <div
            key={item.name}
            className="p-5 rounded-2xl bg-slate-950/50 border border-slate-800/80 flex flex-col gap-1.5"
          >
            <span className="text-xl font-black text-white tracking-wide">{item.name}</span>
            <span className="text-base text-slate-300 leading-snug">{item.blurb}</span>
          </div>
        ))}
      </div>

      {/* Rodapé: o fecho da seção e, quando alguém está apresentando, a contagem de volta */}
      <div className="flex items-center justify-between gap-6 pt-5 mt-2 border-t border-slate-700/60 flex-shrink-0">
        {atual.footnote ? (
          <p className="text-lg font-black text-[#ff9e0b] text-glow-amber tracking-wide">{atual.footnote}</p>
        ) : (
          <span />
        )}

        {holdMs > 0 && (
          <span
            className="flex items-center gap-2 text-xs font-bold px-3 py-1.5 rounded-2xl bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/40 uppercase tracking-wider font-mono flex-shrink-0"
            title="Setas navegam as seções. Sem toque no teclado, o placar volta sozinho."
          >
            <Presentation className="w-3.5 h-3.5" />
            Modo apresentação · placar em {formatCountdown(holdMs)}
          </span>
        )}
      </div>
    </div>
  );
}
