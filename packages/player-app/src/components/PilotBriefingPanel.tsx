import React from 'react';
import { Lightbulb } from 'lucide-react';
import { ShipSpecification, SubagentName, SUBAGENT_CATALOG } from '@jogo/shared';

/**
 * As dicas de pilotagem que os sub-agentes táticos escrevem no PASSO 3 do protocolo, prontas para
 * a tela: o texto já filtrado e o especialista que assina.
 */
export interface PilotBriefing {
  tips: string[];
  /** Rótulo do tático selecionado. `null` quando a nave veio sem tático (preset de emergência). */
  authorLabel: string | null;
  color: string;
}

/** Usada quando ninguém assina o briefing — o cobalto neutro do resto da tela. */
const NEUTRAL_COLOR = '#38bdf8';

/**
 * `build_metadata.pilot_tips` é opcional por construção: uma nave sem dica é uma nave válida.
 * Devolver `null` (em vez de um briefing vazio) é o que faz o painel inteiro não ser montado —
 * a mesma disciplina do `shown()`/`DASH` do `HandoffTerminalScreen`, que existe para esta tela
 * nunca preencher uma ausência com conteúdo inventado.
 */
export function derivePilotBriefing(
  spec: ShipSpecification | null,
  selectedSubagents: SubagentName[]
): PilotBriefing | null {
  // `normalizeSpec` já descarta um `pilot_tips` que não seja array de strings, mas a checagem se
  // repete aqui: um payload torto não pode derrubar a tela de pré-voo inteira por causa de um
  // campo cosmético.
  const raw = spec?.build_metadata?.pilot_tips;
  const tips = (Array.isArray(raw) ? raw : []).filter(
    (tip): tip is string => typeof tip === 'string' && tip.trim() !== ''
  );
  if (tips.length === 0) return null;

  // O `aesthetic-designer` não produz dica e não é selecionável; quem assina é o tático que o
  // visitante escolheu. Rótulo e cor vêm do catálogo, nunca digitados aqui.
  const author = selectedSubagents.find((name) => SUBAGENT_CATALOG[name]?.selectable);
  const entry = author ? SUBAGENT_CATALOG[author] : undefined;

  return {
    tips,
    authorLabel: entry?.label ?? null,
    color: entry?.color ?? NEUTRAL_COLOR
  };
}

/**
 * O único texto livre que um sub-agente consegue mandar para o visitante. Renderizado entre a
 * grade de stats e o botão de decolagem, que é o instante em que a dica ainda dá para ser usada.
 */
export function PilotBriefingPanel({ briefing }: { briefing: PilotBriefing | null }) {
  if (!briefing) return null;

  return (
    <div
      className="p-4 rounded-xl bg-slate-950/80 border space-y-2"
      style={{ borderColor: `${briefing.color}66` }}
    >
      <div className="flex items-center gap-2">
        <Lightbulb className="w-5 h-5 shrink-0" style={{ color: briefing.color }} />
        <span
          className="text-sm font-bold uppercase tracking-wider"
          style={{ color: briefing.color }}
        >
          Briefing do seu especialista
        </span>
        {briefing.authorLabel && (
          <span className="text-sm text-slate-400 font-mono">{briefing.authorLabel}</span>
        )}
      </div>
      <ul className="space-y-1.5">
        {briefing.tips.map((tip, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-slate-200">
            <span className="font-mono shrink-0" style={{ color: briefing.color }}>
              ▸
            </span>
            <span>{tip}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
