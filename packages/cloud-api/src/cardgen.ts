/**
 * Geração do cartão SVG da nave, FORA do fluxo do jogo.
 *
 * A criação de um documento em `matches/{match_id}` dispara um gatilho Eventarc que chama
 * `POST /internal/cardgen` no serviço Cloud Run `jogo-navinha-cardgen`. Nada disto está no
 * caminho de `POST /v1/matches`: a ingestão é o que o estande espera para considerar a partida
 * sincronizada, e uma falha de desenho não pode rejeitar uma partida nem somar latência ali.
 *
 * Duas escolhas explicam o formato deste arquivo.
 *
 * **O evento não é decodificado.** O corpo do CloudEvent do Firestore é protobuf, e lê-lo em Node
 * puro exigiria `protobufjs` mais os `.proto` publicados. Não vale: o cabeçalho `ce-subject` traz
 * `documents/matches/{matchId}`, e reler o documento é melhor que confiar no payload — o que for
 * renderizado é sempre o estado atual, mesmo que o evento chegue fora de ordem ou duplicado.
 *
 * **Não há laço.** O gatilho escuta só `document.v1.created`; a gravação de volta é um `update`,
 * que emite `updated`. Como segunda camada, `generateShipCard` sai sem escrever quando o
 * documento já tem a versão corrente do renderizador.
 */
import type { Firestore } from 'firebase-admin/firestore';
import { SHIP_CARD_VERSION, renderShipCardSvg, type MatchDocument } from '@jogo/shared';

/** Coleção que o gatilho observa. Declarada aqui para casar com o `document=matches/{matchId}`. */
const MATCHES_COLLECTION = 'matches';

/**
 * Extrai `{matchId}` de um `ce-subject` no formato `documents/matches/{matchId}`.
 *
 * Devolve `null` — e não lança — para qualquer coisa fora desse formato: um subject de outra
 * coleção, de um subdocumento, vazio ou ausente. O chamador traduz `null` em falha PERMANENTE
 * (204), porque reentregar o mesmo evento malformado nunca vai produzir outro resultado.
 */
export function matchIdFromSubject(subject: string | undefined | null): string | null {
  if (typeof subject !== 'string') return null;
  const parts = subject.split('/');
  // Exatamente três segmentos: `documents`, a coleção, e o ID. Um subdocumento
  // (`documents/matches/x/events/y`) não é o que este gatilho observa.
  if (parts.length !== 3) return null;
  const [prefix, collection, matchId] = parts;
  if (prefix !== 'documents' || collection !== MATCHES_COLLECTION) return null;
  return matchId.length > 0 ? matchId : null;
}

/** O que aconteceu, para a rota traduzir em status HTTP. */
export type CardGenOutcome = 'written' | 'up_to_date' | 'not_found' | 'unrenderable';

/**
 * Idempotente: relê o documento, renderiza, grava com `update`.
 *
 * `update` (e não `set`) é deliberado em três frentes: emite `updated` em vez de `created`
 * (nenhum laço), falha se o documento sumiu entre a leitura e a escrita (nada de ressuscitar uma
 * partida apagada pelo `deleteMatch`), e toca só os dois campos do cartão.
 *
 * Erros do Firestore sobem — são transientes e a retentativa do Eventarc é justamente o que
 * queremos. Só o que é permanente vira valor de retorno.
 */
export async function generateShipCard(db: Firestore, matchId: string): Promise<CardGenOutcome> {
  const ref = db.collection(MATCHES_COLLECTION).doc(matchId);
  const snap = await ref.get();
  if (!snap.exists) return 'not_found';

  const match = snap.data() as MatchDocument;
  if (match.ship_card_version === SHIP_CARD_VERSION) return 'up_to_date';

  // O renderizador já cai na silhueta neutra quando o casco é ruim e na paleta do tema quando a
  // cor é ruim. Chegar aqui sem `visuals` ou sem `attributes` significa um documento que não tem
  // a forma de um `MatchDocument` — permanente, e não vale uma retentativa.
  const spec = match.ship_spec_snapshot;
  if (!spec || typeof spec !== 'object' || !spec.visuals || !spec.attributes) return 'unrenderable';

  await ref.update({
    ship_card_svg: renderShipCardSvg(spec),
    ship_card_version: SHIP_CARD_VERSION
  });
  return 'written';
}
