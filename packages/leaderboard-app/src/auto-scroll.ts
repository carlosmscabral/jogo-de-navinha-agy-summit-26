/**
 * A rolagem vai-e-volta dos painéis do placar, isolada do DOM para poder ser testada.
 *
 * POR QUE EXISTE. O telão passou a mostrar 20 pilotos e 15 empresas, e a exigência explícita é que
 * NADA encolha: a TV é lida do fundo do estande, então diminuir fonte para caber mais seria trocar
 * o problema por outro pior. A saída é rolar. E rolar num telão não é rolar numa página: não há
 * quem role, o movimento tem de ser lento o bastante para se ler enquanto anda, e tem de voltar
 * ao topo sem um salto — quem estava lendo o 15º lugar não pode ver a lista piscar para o 1º.
 *
 * Daí o vai-e-volta com pausas: pausa no topo, desce, pausa no fundo, sobe. O ciclo é periódico,
 * então `scrollOffsetAt` é uma função pura do tempo decorrido — dá para verificar o ciclo inteiro
 * sem relógio, sem DOM e sem jsdom (que este pacote não tem; ver `celebration-queue.ts`).
 */

export interface AutoScrollConfig {
  /** Velocidade da rolagem, em pixels por segundo. Lento de propósito: dá para ler andando. */
  pxPerSecond: number;
  /** Pausa no topo e no fundo, em ms. Sem ela, a lista chega na ponta e já reverte. */
  holdMs: number;
}

/**
 * 20 px/s com 5 s de pausa. Numa TV 1080p, 20 linhas de piloto transbordam ≈780 px, o que dá um
 * vai-e-volta completo de ≈88 s — aprox. uma passagem inteira por fatia de 90 s do placar. O passo
 * 27.2 do plano de teste manual é quem valida isso na TV real; se precisar de ajuste, é ESTE
 * número que se mexe, nunca a tipografia.
 */
export const DEFAULT_AUTO_SCROLL_CONFIG: AutoScrollConfig = { pxPerSecond: 20, holdMs: 5_000 };

/** Duração de um ciclo completo (pausa + descida + pausa + subida), em ms. */
export function scrollCycleMs(overflowPx: number, cfg: AutoScrollConfig = DEFAULT_AUTO_SCROLL_CONFIG): number {
  if (overflowPx <= 0) return 0;
  const travelMs = (overflowPx / cfg.pxPerSecond) * 1000;
  return 2 * cfg.holdMs + 2 * travelMs;
}

/**
 * Deslocamento vertical, em pixels, no instante `elapsedMs` do ciclo.
 *
 * Devolve 0 quando não há transbordo — é o caso normal na primeira meia hora do evento, com três
 * pilotos no placar. Uma lista que cabe inteira não pode tremer.
 */
export function scrollOffsetAt(
  elapsedMs: number,
  overflowPx: number,
  cfg: AutoScrollConfig = DEFAULT_AUTO_SCROLL_CONFIG
): number {
  if (overflowPx <= 0 || cfg.pxPerSecond <= 0) return 0;

  const travelMs = (overflowPx / cfg.pxPerSecond) * 1000;
  const cycleMs = 2 * cfg.holdMs + 2 * travelMs;
  // Módulo positivo: `elapsedMs` vem de um relógio monotônico, mas um valor negativo por um
  // remonte do componente não pode virar um deslocamento negativo (lista subindo para fora da caixa).
  const t = ((elapsedMs % cycleMs) + cycleMs) % cycleMs;

  if (t < cfg.holdMs) return 0;

  const descida = t - cfg.holdMs;
  if (descida < travelMs) return (descida / travelMs) * overflowPx;

  const noFundo = descida - travelMs;
  if (noFundo < cfg.holdMs) return overflowPx;

  const subida = noFundo - cfg.holdMs;
  return overflowPx - (subida / travelMs) * overflowPx;
}
