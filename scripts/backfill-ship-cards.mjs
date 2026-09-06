#!/usr/bin/env node
/**
 * Gera `ship_card_svg` nas partidas que o gatilho Eventarc não pegou.
 *
 * POR QUE ISTO EXISTE: o gatilho de `document.v1.created` só vê o que for criado DEPOIS dele.
 * Tudo que já estava no Firestore quando o `deploy.sh` provisionou o `cardgen` — as partidas de
 * teste do Gate M3, o que rodar antes do evento — fica sem cartão para sempre, e não há evento
 * nenhum que as reprocesse. Este script é a outra metade: cobre o passado, e serve de novo,
 * inteiro, quando `SHIP_CARD_VERSION` subir e todos os cartões precisarem ser redesenhados.
 *
 * Renderiza com exatamente o mesmo `renderShipCardSvg` que o serviço usa — importado de
 * `@jogo/shared`, não reimplementado —, então uma partida escrita por aqui é indistinguível de
 * uma escrita pelo gatilho.
 *
 * CREDENCIAL: ADC do operador (`gcloud auth application-default login`). Nenhum arquivo de chave
 * é lido, gerado ou aceito — é a mesma regra do estande, e a razão de este script rodar na
 * máquina de quem opera e não na do evento.
 *
 * Uso:
 *   node scripts/backfill-ship-cards.mjs                    # --dry-run é o padrão: não escreve
 *   node scripts/backfill-ship-cards.mjs --apply            # grava
 *   node scripts/backfill-ship-cards.mjs --apply --limit 50 # só as 50 primeiras sem cartão
 *   PROJECT_ID=outro node scripts/backfill-ship-cards.mjs --database outro-banco
 *
 * Requer `npm run build --workspace=packages/shared` antes (importa de `dist/`, como o
 * moderation-bench.mjs).
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { SHIP_CARD_VERSION, renderShipCardSvg } from '../packages/shared/dist/index.js';

const argv = process.argv.slice(2);
const has = (name) => argv.includes(name);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

// Mesmos defaults do deploy.sh — um backfill apontado para o projeto errado é uma escrita em
// massa num banco de outra pessoa, então os dois arquivos têm de concordar.
const PROJECT_ID = argOf('--project', process.env.PROJECT_ID || 'vibe-cabral');
const DATABASE_ID = argOf('--database', process.env.FIRESTORE_DATABASE || 'jogo-navinha');
// `--dry-run` é o padrão, e `--apply` é a única forma de escrever: o modo destrutivo nunca é o
// que acontece quando alguém roda o script sem ler esta ajuda.
const APPLY = has('--apply');
const LIMIT = Number(argOf('--limit', '0')) || Infinity;
// Página de leitura. Nada a ver com o lote de escrita do BulkWriter, que ele gerencia sozinho.
const PAGE_SIZE = 400;

if (has('--help') || has('-h')) {
  console.log(
    'Uso: node scripts/backfill-ship-cards.mjs [--apply] [--limit N] [--project ID] [--database ID]'
  );
  process.exit(0);
}
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  // Não é purismo: um arquivo de chave no disco é a coisa que este projeto inteiro evita, e um
  // backfill é justamente a operação em que ninguém percebe qual identidade escreveu.
  console.error(
    'GOOGLE_APPLICATION_CREDENTIALS está definida. Este script usa ADC do operador\n' +
      '(`gcloud auth application-default login`) e nenhum arquivo de credencial. Remova a\n' +
      'variável do ambiente e rode de novo.'
  );
  process.exit(2);
}

initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
const db = getFirestore(DATABASE_ID);

console.log(`Projeto:  ${PROJECT_ID}`);
console.log(`Banco:    ${DATABASE_ID}`);
console.log(`Modo:     ${APPLY ? 'APPLY (grava)' : 'dry-run (não escreve nada)'}`);
console.log(`Versão do renderizador: ${SHIP_CARD_VERSION}`);
console.log('');

const writer = APPLY ? db.bulkWriter() : null;

let scanned = 0;
let already = 0;
let unrenderable = 0;
let pending = 0;
let firstSvg = null;
let cursor = null;

// Paginação por `__name__` (o ID do documento), não por `created_at`: é o único campo que toda
// partida tem, é único, e é o que garante que a varredura termina mesmo se alguém estiver
// gravando partidas novas enquanto o backfill roda.
for (;;) {
  let q = db.collection('matches').orderBy('__name__').limit(PAGE_SIZE);
  if (cursor) q = q.startAfter(cursor);
  const page = await q.get();
  if (page.empty) break;
  cursor = page.docs[page.docs.length - 1];

  for (const doc of page.docs) {
    if (pending >= LIMIT) break;
    scanned += 1;
    const match = doc.data();

    if (match.ship_card_version === SHIP_CARD_VERSION) {
      already += 1;
      continue;
    }

    // Mesma checagem do serviço (`generateShipCard`): o renderizador já cai na silhueta neutra
    // para casco ruim e na paleta do tema para cor ruim, então chegar aqui significa um
    // documento sem a forma de uma partida — conta e segue, não interrompe o lote.
    const spec = match.ship_spec_snapshot;
    if (!spec || typeof spec !== 'object' || !spec.visuals || !spec.attributes) {
      unrenderable += 1;
      console.warn(`  ${doc.id}: sem ship_spec_snapshot utilizável — pulando.`);
      continue;
    }

    const svg = renderShipCardSvg(spec);
    if (firstSvg === null) firstSvg = { id: doc.id, svg };
    pending += 1;

    if (writer) {
      // `update`, e não `set`: falha se o documento sumiu no meio da varredura, e toca só os
      // dois campos do cartão. O BulkWriter agrupa e faz backoff sozinho.
      writer.update(doc.ref, { ship_card_svg: svg, ship_card_version: SHIP_CARD_VERSION }).catch((err) => {
        console.error(`  ${doc.id}: falhou ao gravar —`, err.message);
      });
    }
  }

  if (pending >= LIMIT || page.size < PAGE_SIZE) break;
}

if (writer) await writer.close();

console.log('');
console.log(`Partidas varridas:              ${scanned}`);
console.log(`Já tinham o cartão v${SHIP_CARD_VERSION}:          ${already}`);
console.log(`Sem spec utilizável (puladas):  ${unrenderable}`);
console.log(`${APPLY ? 'Gravadas:                       ' : 'Gravaria (com --apply):         '}${pending}`);

if (firstSvg) {
  console.log('');
  console.log(`Primeiro cartão gerado (${firstSvg.id}), ${firstSvg.svg.length} bytes:`);
  console.log(firstSvg.svg);
}

if (!APPLY && pending > 0) {
  console.log('');
  console.log('Nada foi escrito. Rode de novo com --apply para gravar.');
}

// O processo do firebase-admin segura o event loop com o canal gRPC aberto.
await db.terminate();
