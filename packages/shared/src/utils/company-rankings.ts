import type { CompanyRankingDocument } from '../types/cloud.js';

/**
 * Uma empresa só deve aparecer nos placares se ainda tiver pelo menos um piloto contabilizado.
 *
 * A coleção `company_rankings` acumula "cascas": documentos zerados que sobrevivem à empresa que
 * os originou. São três produtores, e nenhum deles é bug:
 *
 * - `correctMatchCompany` (`cloud-api/src/canonicalize.ts`) decrementa a empresa de origem quando
 *   a varredura corrige a grafia que o visitante digitou, mas nunca apaga o documento nem reduz
 *   o `top_individual_score`. Ou seja: toda correção de "Gogole" para "Google" deixa para trás um
 *   "Gogole" com 0 pilotos e um recorde individual fantasma.
 * - `patchMatch` (`cloud-api/src/admin.ts`) mantém o documento zerado DE PROPÓSITO ao anular a
 *   única partida de uma empresa (ver o comentário "Minor 10" naquele arquivo).
 * - `deleteMatch` só limpa o documento da empresa ATUAL da partida, então uma partida já
 *   recanonizada nunca leva a casca da empresa antiga junto.
 *
 * Filtrar no consumidor cobre os três de uma vez, sem índice novo e sem mexer em quem escreve.
 */
export function hasActivePilots(ranking: Pick<CompanyRankingDocument, 'pilots_count'>): boolean {
  return (ranking.pilots_count ?? 0) > 0;
}
