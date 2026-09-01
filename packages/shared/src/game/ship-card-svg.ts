/**
 * Cartão SVG da nave: a mesma silhueta do pré-voo, desenhada sem Phaser e sem React.
 *
 * Existe porque o visual de cada nave já está inteiro no Firestore
 * (`MatchDocument.ship_spec_snapshot.visuals`) mas não havia como desenhá-lo fora do
 * `player-app` — `SvgShipRenderer.ts` importa Phaser no topo do módulo, e a única alternativa era
 * o JSX de `ShipPreviewCanvas.tsx`. Um consumidor futuro (uma galeria, um painel, um script de
 * exportação) teria que reimplementar o contrato do viewBox de cabeça.
 *
 * Aqui a função é pura: entra uma `ShipSpecification`, sai uma string com um documento SVG
 * autocontido. Sem DOM, sem canvas, sem dependência de runtime — é isso que a torna executável
 * dentro do Cloud Run.
 *
 * As três funções de validação de path (`isSafePathData`, `pathExtent`, `isDrawablePathData`)
 * moraram em `packages/player-app/src/game/factories/SvgShipRenderer.ts` até esta mudança. Elas
 * sempre foram puras; ficavam lá só por proximidade com o renderizador Phaser, o que obrigava
 * quem quisesse apenas SABER se um casco é desenhável a arrastar a engine junto. Agora aquele
 * arquivo as reexporta daqui — uma definição só, três consumidores.
 */
import type { ShipSpecification, ShipVisuals } from '../types/ship.js';
import { VISUAL_THEMES, type ThemePalette } from '../constants/visual-catalog.js';

/** Lado do viewBox que o agente recebe como contrato: todo `svg_path_data` é desenhado em 0..128. */
export const VIEWBOX_SIZE = 128;

/** Tolerância além do viewBox antes de recusar o desenho. */
export const EXTENT_SLACK = 20;

const SAFE_PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9eE,.\-+\s]+$/;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Silhueta neutra, usada quando o casco forjado não é desenhável. É a mesma que
 * `ShipPreviewCanvas.tsx` desenha nesse caso — uma nave genérica é melhor que um buraco.
 */
export const NEUTRAL_HULL_PATH = 'M 64 10 L 92 96 L 64 82 L 36 96 Z';

/**
 * O path vem de um LLM e vira conteúdo de canvas. Path2D não executa script,
 * mas um path com caracteres estranhos é sinal de que a saída do agente
 * degenerou — nesse caso é melhor a nave paramétrica que um casco corrompido.
 */
export function isSafePathData(d: string): boolean {
  if (typeof d !== 'string' || d.trim().length < 10) return false;
  return SAFE_PATH.test(d);
}

export function pathExtent(d: string): { min: number; max: number } {
  const numbers = (d.match(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g) || []).map(Number).filter(Number.isFinite);
  if (numbers.length === 0) return { min: 0, max: 0 };
  return { min: Math.min(...numbers), max: Math.max(...numbers) };
}

/**
 * As duas recusas de `renderSvgShipTexture` (caracteres fora do contrato, path fora do viewBox)
 * numa única pergunta, sem precisar de uma `Phaser.Scene`.
 */
export function isDrawablePathData(d: string): boolean {
  if (!isSafePathData(d)) return false;
  const { min, max } = pathExtent(d);
  return min >= -EXTENT_SLACK && max <= VIEWBOX_SIZE + EXTENT_SLACK;
}

/**
 * Sobe quando as REGRAS DE DESENHO mudam — nunca por mudança de dado. Grava-se junto do SVG
 * (`MatchDocument.ship_card_version`) para que o serviço saiba o que já está atualizado e para
 * que uma re-renderização em massa saiba o que precisa refazer.
 */
export const SHIP_CARD_VERSION = 1;

/**
 * Raio do anel de escudo, em unidades do viewBox do casco.
 *
 * No pré-voo o casco é exibido a `size * 0.42` e o escudo tem raio `size * 0.28`
 * (`ShipPreviewCanvas.tsx`), ou seja o escudo tem 2/3 da largura do casco de raio. Aqui o casco
 * ocupa os 128 nativos, então a razão é preservada em vez do número absoluto — é isso que faz o
 * cartão parecer a mesma nave que o piloto viu, e não uma nave com um anel de outro tamanho.
 */
const SHIELD_RADIUS = (VIEWBOX_SIZE * 0.28) / 0.42;

/**
 * Margem em volta do casco. O escudo transborda o viewBox 0..128 por construção (raio 85,33 a
 * partir do centro 64 chega a -21,33), então o cartão precisa de folga. A margem é CONSTANTE,
 * com ou sem escudo: numa galeria, todos os cartões têm que ter a mesma proporção e o casco tem
 * que ficar no mesmo lugar.
 */
const CARD_MARGIN = 24;
const CARD_SIZE = VIEWBOX_SIZE + CARD_MARGIN * 2;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * As cores já passaram pelo Ajv quando a spec foi aceita, mas este renderizador roda meses
 * depois, sobre um documento que pode ter passado por uma correção manual do painel de admin.
 * Uma cor fora do formato entraria numa string SVG concatenada — então ela não entra: cai para a
 * paleta do tema, que é o mesmo fallback que o resto do sistema já usa.
 */
function safeColor(value: string | undefined, fallback: string): string {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value : fallback;
}

function paletteFor(spec: ShipSpecification): ThemePalette {
  const theme = spec.build_metadata?.fast_grill_me_choices?.visual_theme;
  return (theme && VISUAL_THEMES[theme]?.palette) || VISUAL_THEMES.synthwave_80s.palette;
}

/**
 * Documento SVG autocontido com o casco e, quando a build tem escudo, o anel de escudo — as
 * mesmas duas formas que o pré-voo desenha, nas mesmas cores e na mesma proporção.
 *
 * O `svg_path_data` entra SEM transformação nenhuma: o casco mantém suas coordenadas nativas e é
 * o viewBox que se abre para acomodar o escudo. Isso mantém o campo do Firestore e o `d` do
 * cartão byte-idênticos, o que torna trivial conferir um contra o outro.
 *
 * Sem texto, sem callsign, sem score: identidade do piloto não é atributo visual da nave.
 */
export function renderShipCardSvg(spec: ShipSpecification): string {
  const visuals: Partial<ShipVisuals> = spec.visuals ?? {};
  const palette = paletteFor(spec);

  const primary = safeColor(visuals.primary_color, palette.primary_color);
  const secondary = safeColor(visuals.secondary_color, palette.secondary_color);
  const engineTrail = safeColor(visuals.engine_trail_color, palette.engine_trail_color);

  const d =
    typeof visuals.svg_path_data === 'string' && isDrawablePathData(visuals.svg_path_data)
      ? visuals.svg_path_data
      : NEUTRAL_HULL_PATH;

  const title = escapeXml(visuals.style_name || 'Nave');

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-CARD_MARGIN} ${-CARD_MARGIN} ${CARD_SIZE} ${CARD_SIZE}"` +
      ` width="${CARD_SIZE}" height="${CARD_SIZE}" role="img">`,
    `<title>${title}</title>`
  ];

  // O escudo vem antes do casco de propósito: é uma aura translúcida ATRÁS da nave, como na
  // partida e no pré-voo.
  if ((spec.attributes?.shield_capacity ?? 0) > 0) {
    parts.push(
      `<circle cx="${VIEWBOX_SIZE / 2}" cy="${VIEWBOX_SIZE / 2}" r="${SHIELD_RADIUS.toFixed(2)}"` +
        ` fill="${secondary}" fill-opacity="0.12"` +
        ` stroke="${engineTrail}" stroke-opacity="0.5" stroke-width="1"/>`
    );
  }

  parts.push(`<path d="${d}" fill="${primary}" stroke="${secondary}" stroke-width="2"/>`);
  parts.push('</svg>');

  return parts.join('');
}
