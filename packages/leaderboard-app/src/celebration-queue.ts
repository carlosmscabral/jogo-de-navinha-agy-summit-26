/**
 * A fila de celebração do telão, isolada do React para poder ser testada.
 *
 * POR QUE FILA. Era um slot único (`setCelebrationMatch`), sobrescrito a cada recorde. Com UM
 * estande isso quase nunca mordia: as partidas chegavam com minutos de intervalo e o modal vive
 * 7 s. Com DOIS estandes jogando ao mesmo tempo, dois recordes dentro da mesma janela de 7 s
 * passam a ser rotina — e o segundo apagava o primeiro no meio da animação. O visitante que
 * acabou de entrar no pódio olhava para a TV e não via nada, que é justamente o clímax que a
 * experiência inteira existe para produzir.
 *
 * Este módulo é uma função pura de propósito: o `leaderboard-app` não tem jsdom nem
 * testing-library, então lógica que precisa de teste não pode morar dentro de um componente.
 */
import type { RecentMatchEntry } from './components/LiveTickerFeed.js';

export interface Celebration {
  match: RecentMatchEntry;
  rank: number;
}

/**
 * Teto da fila. Cada modal ocupa a tela por 7 s, então 4 na fila já são quase meio minuto de TV
 * coberta. Uma rajada maior que isto não é o estande indo bem — é uma reconexão despejando
 * partidas acumuladas de uma vez, e aí a coisa certa é mostrar as primeiras e devolver o placar,
 * não sequestrar o telão por minutos com recordes que já são história.
 */
export const CELEBRATION_QUEUE_MAX = 4;

/**
 * Enfileira uma celebração, se ela couber e ainda não estiver lá.
 *
 * Devolve a MESMA referência quando nada muda — o chamador é um `setState` do React, e devolver
 * o array anterior evita um re-render inútil do telão a cada partida fora do pódio.
 *
 * A deduplicação por `match_id` não é zelo: toda reinscrição do listener por recência
 * (`subscribeWithRetry`, depois de um erro permanente do `onSnapshot`) reentrega como `added`
 * tudo que estiver na janela. Sem ela, um soluço de rede reexibe celebrações antigas.
 */
export function enqueueCelebration(
  queue: Celebration[],
  entry: Celebration,
  max: number = CELEBRATION_QUEUE_MAX
): Celebration[] {
  if (queue.some((c) => c.match.match_id === entry.match.match_id)) return queue;
  if (queue.length >= max) return queue;
  return [...queue, entry];
}

/** Só o pódio celebra. `rank` 0 é o que a fonte devolve para "não entrou no top 10". */
export function isCelebrationWorthy(rank: number): boolean {
  return rank >= 1 && rank <= 3;
}
