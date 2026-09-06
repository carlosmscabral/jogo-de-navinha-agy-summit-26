import React from 'react';
import { ChevronLeft, ChevronRight, Presentation, LayoutDashboard } from 'lucide-react';

interface OperatorControlsProps {
  /** `true` enquanto o placar está no ar: aí só existe uma ação, entrar no painel. */
  noPlacar: boolean;
  onNext: () => void;
  onPrev: () => void;
  onExit: () => void;
}

/**
 * Os controles do apresentador em forma clicável, no canto direito do cabeçalho — o MESMO canto nas
 * duas visões, para quem assumir o estande no meio do dia procurar em um lugar só.
 *
 * O teclado continua valendo e faz exatamente o mesmo (ver o `keydown` em `App.tsx`); estes botões
 * existem porque uma tecla combinada não se anuncia sozinha, e a pessoa no estande pode nunca ter
 * visto este telão antes.
 *
 * Nenhuma decisão mora aqui: cada botão despacha um evento que o `rotationReducer` já define e que
 * já tem teste. É layout, como todo componente deste pacote.
 */
export function OperatorControls({ noPlacar, onNext, onPrev, onExit }: OperatorControlsProps) {
  // `blur()` depois de cada clique, e não é detalhe: o apontador do estande manda ESPAÇO no botão
  // "avançar", e um espaço com o foco preso em "Voltar ao placar" tiraria o painel do ar em vez de
  // passar de seção. Sem foco retido, a tecla volta a cair no listener da janela.
  const clique = (acao: () => void) => (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.blur();
    acao();
  };

  const base =
    'flex items-center gap-1.5 px-3 py-2 rounded-2xl border font-mono text-[11px] font-bold ' +
    'uppercase tracking-wider transition-colors cursor-pointer';

  if (noPlacar) {
    return (
      <button
        type="button"
        onClick={clique(onNext)}
        title="Mostrar o painel do Antigravity (seta →, no teclado ou no apontador)"
        className={`${base} bg-[#38bdf8]/10 text-[#38bdf8] border-[#38bdf8]/40 hover:bg-[#38bdf8]/25`}
      >
        <Presentation className="w-3.5 h-3.5" />
        Antigravity
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={clique(onPrev)}
        title="Seção anterior (seta ←)"
        aria-label="Seção anterior"
        className={`${base} bg-slate-900/60 text-slate-300 border-slate-700 hover:bg-slate-800`}
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      <button
        type="button"
        onClick={clique(onNext)}
        title="Próxima seção (seta →)"
        aria-label="Próxima seção"
        className={`${base} bg-slate-900/60 text-slate-300 border-slate-700 hover:bg-slate-800`}
      >
        <ChevronRight className="w-4 h-4" />
      </button>

      <button
        type="button"
        onClick={clique(onExit)}
        title="Voltar ao placar agora (Esc)"
        className={`${base} bg-[#ff9e0b]/15 text-[#ff9e0b] border-[#ff9e0b]/40 hover:bg-[#ff9e0b]/30`}
      >
        <LayoutDashboard className="w-3.5 h-3.5" />
        Voltar ao placar
      </button>
    </div>
  );
}
