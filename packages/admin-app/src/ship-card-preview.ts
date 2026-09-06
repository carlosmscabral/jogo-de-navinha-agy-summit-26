/**
 * Mostra no painel o cartão SVG que o `cardgen` desenhou na nuvem.
 *
 * O campo `ship_card_svg` é OPCIONAL e chega vazio o tempo todo: partidas anteriores ao gatilho
 * Eventarc nunca terão um (só o `scripts/backfill-ship-cards.mjs` as cobre), e uma partida
 * recém-ingerida fica alguns segundos sem, entre a ingestão e a entrega do evento. Ausência não é
 * erro nem estado degradado — é o normal, e a UI trata assim.
 *
 * POR QUE UMA `data:` URI NUM `<img>`, E NÃO O SVG INLINE: um `<svg>` injetado no DOM do painel
 * (via `dangerouslySetInnerHTML`) roda no mesmo contexto da página — `<script>`, `onload`,
 * `<foreignObject>` e afins passariam a executar com a sessão autenticada do administrador. Um
 * `<img>` com `data:` URI é um contexto de imagem isolado: o navegador não executa script nem
 * carrega sub-recursos externos de dentro dele. Isso importa porque o SVG NÃO vem do nosso
 * renderizador aqui — vem do Firestore, e o painel é o único lugar do sistema que o interpreta em
 * vez de só armazená-lo.
 */
import type { MatchDocument } from '@jogo/shared';

/**
 * `data:` URI pronta para o `src` de um `<img>`, ou `null` quando não há cartão para mostrar.
 *
 * O prefixo `<svg` é uma checagem de sanidade, não uma validação de segurança (o isolamento é o
 * `<img>`): garante que um campo corrompido ou de outro tipo vire "sem cartão" em vez de uma
 * imagem quebrada sem explicação.
 */
export function shipCardDataUri(match: Pick<MatchDocument, 'ship_card_svg'>): string | null {
  const svg = match.ship_card_svg;
  if (typeof svg !== 'string' || !svg.trimStart().startsWith('<svg')) return null;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** Texto alternativo e tooltip: o nome que o agente deu à nave, com o callsign como fallback. */
export function shipCardLabel(match: Pick<MatchDocument, 'callsign' | 'ship_spec_snapshot'>): string {
  const styleName = match.ship_spec_snapshot?.visuals?.style_name;
  return typeof styleName === 'string' && styleName.trim() !== ''
    ? `Nave de ${match.callsign}: ${styleName}`
    : `Nave de ${match.callsign}`;
}
