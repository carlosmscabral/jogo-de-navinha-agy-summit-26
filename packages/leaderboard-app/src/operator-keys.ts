import type { RotationEvent } from './view-rotation.js';

/**
 * O mapa de teclas do apresentador, separado do componente porque foi exatamente aqui que o telão
 * falhou ao vivo em 2026-09-06: `FORCE_SCOREBOARD` existia no reducer, tinha teste, e **nenhuma
 * tecla o disparava** — dava para navegar as seções do painel do Antigravity e não dava para sair.
 * Enquanto o `switch` morava dentro do `keydown` do `App.tsx`, nenhum teste podia enxergá-lo: o
 * vitest deste pacote roda com `environment: 'node'`, sem jsdom.
 *
 * Uma função pura de `KeyboardEvent.key` para evento do reducer resolve isso. O componente vira
 * três linhas sem decisão nenhuma, e o teste consegue afirmar a propriedade que faltava: que toda
 * ação que o reducer oferece tem pelo menos uma tecla que a alcança.
 */
export interface KeyBinding {
  event: RotationEvent;
  /**
   * Se o navegador deve ser impedido de agir. Vale para as teclas de navegação — espaço rola a
   * página, Backspace já foi "voltar" no histórico —, nunca para o caso geral: engolir o
   * comportamento padrão de toda tecla quebraria qualquer coisa que se queira digitar na página.
   */
  preventDefault: boolean;
}

/** Avançar. O apontador do estande se anuncia como teclado e manda espaço ou seta. */
const AVANCAR = ['ArrowRight', 'ArrowDown', 'PageDown', ' '];

/** Voltar uma seção. */
const VOLTAR = ['ArrowLeft', 'ArrowUp', 'PageUp'];

/**
 * Sair para o placar agora. Três teclas de propósito: em tela cheia por `F11` o navegador consome
 * o `Escape` para sair do fullscreen antes de a página vê-lo (em `--kiosk` não), e um telão sem
 * saída alcançável é o bug que originou este arquivo.
 */
const SAIR = ['Escape', 'Home', 'Backspace'];

export function bindingForKey(key: string): KeyBinding {
  if (AVANCAR.includes(key)) return { event: { type: 'OPERATOR_NEXT' }, preventDefault: true };
  if (VOLTAR.includes(key)) return { event: { type: 'OPERATOR_PREV' }, preventDefault: true };
  if (SAIR.includes(key)) return { event: { type: 'FORCE_SCOREBOARD' }, preventDefault: true };

  // Qualquer outra tecla só renova a retenção — e o reducer ignora isso quando o placar está no
  // ar, para que uma tecla esbarrada não tire o ranking da TV.
  return { event: { type: 'OPERATOR_ACTIVITY' }, preventDefault: false };
}
