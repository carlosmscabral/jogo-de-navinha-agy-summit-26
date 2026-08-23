/**
 * Ingestão de partidas — Spec 05 §4, Spec 08 §6.3.
 *
 * `ingestBatch` valida cada partida do lote de forma independente (uma partida corrompida
 * não derruba as outras 49) e grava as válidas com `ingestOne`, uma transação por partida.
 * A idempotência por `match_id` vem de ler `matches/{match_id}` **dentro** da transação: se
 * o documento já existe, a transação não toca em nenhum agregado — reenviar o mesmo lote
 * (o worker da Tarefa C5 pode reenviar em caso de falha de rede) não soma duas vezes.
 */
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { SCHEMA_VERSION, type MatchDocument } from '@jogo/shared';

/**
 * Ordem de 5x o teto teórico da Spec 09; barra lixo, não perícia. Exportado porque
 * `admin.ts` (Tarefa C7) reusa a mesma checagem de faixa plausível para `patchMatch` —
 * um único teto, não dois números que podem divergir com o tempo.
 */
export const MAX_PLAUSIBLE_SCORE = 500_000;

export interface IngestResult {
  accepted: string[];
  rejected: Array<{ match_id: string; reason: string }>;
}

/**
 * Validação de forma, antes de qualquer escrita. Cada checagem alimenta `rejected` com um
 * motivo específico em vez de deixar a partida cair silenciosamente ou derrubar o lote.
 *
 * Nota: o rascunho original desta tarefa também previa recusar `match_id` fora do formato
 * UUID (a defesa da Tarefa C0 contra `match_${Date.now()}`). Os testes de aceitação deste
 * pacote (`ingest.test.ts`, dados verbatim pelo plano) usam IDs curtos como `'m1'`/`'ok'`/
 * `'absurdo'` e esperam que sejam aceitos — impor o formato UUID aqui rejeitaria esses casos
 * pelo motivo errado. Este arquivo mantém só a checagem de não-vazio para `match_id`; a
 * defesa de formato, se necessária, pertence à camada de validação de UUID de fato usada
 * pelo cliente (Tarefa C0) ou deveria vir com uma revisão dos fixtures de teste.
 */
function validate(m: MatchDocument): string | null {
  if (!m.pilot_id) return 'empty pilot_id';
  if (!m.match_id) return 'empty match_id';
  if (typeof m.final_score !== 'number' || m.final_score < 0 || m.final_score > MAX_PLAUSIBLE_SCORE) {
    return `final_score out of plausible range (0-${MAX_PLAUSIBLE_SCORE}): ${m.final_score}`;
  }
  if (!m.telemetry) return 'missing telemetry';
  if (!m.ship_spec_snapshot) return 'missing ship_spec_snapshot';
  return null;
}

async function ingestOne(db: Firestore, m: MatchDocument): Promise<void> {
  await db.runTransaction(async (tx) => {
    const matchRef = db.collection('matches').doc(m.match_id);
    const existing = await tx.get(matchRef);
    if (existing.exists) return;                 // idempotente: nada a somar

    const pilotRef = db.collection('pilots').doc(m.pilot_id);
    const companyRef = db.collection('company_rankings').doc(m.company_canonical);
    const [pilot, company] = await Promise.all([tx.get(pilotRef), tx.get(companyRef)]);

    // O piloto conta como novo PARA ESTA EMPRESA se nunca existiu, ou se existia
    // registrado em outra. O caso do meio é real: alguém digita a empresa errada
    // na primeira partida e certo na segunda, e a Tarefa C4 canonicaliza depois.
    const pilotIsNewToCompany =
      !pilot.exists || pilot.data()!.company_canonical !== m.company_canonical;

    tx.set(matchRef, { ...m, schema_version: SCHEMA_VERSION, created_at: FieldValue.serverTimestamp() });
    tx.set(pilotRef, {
      schema_version: SCHEMA_VERSION,
      pilot_id: m.pilot_id,
      callsign: m.callsign,
      company_canonical: m.company_canonical,
      created_at: pilot.exists ? pilot.data()!.created_at : FieldValue.serverTimestamp(),
      best_score: Math.max(m.final_score, pilot.exists ? pilot.data()!.best_score : 0),
      matches_played: (pilot.exists ? pilot.data()!.matches_played : 0) + 1
    });
    tx.set(companyRef, {
      schema_version: SCHEMA_VERSION,
      company_canonical: m.company_canonical,
      total_score: (company.exists ? company.data()!.total_score : 0) + m.final_score,
      pilots_count: (company.exists ? company.data()!.pilots_count : 0) + (pilotIsNewToCompany ? 1 : 0),
      top_individual_score: Math.max(m.final_score, company.exists ? company.data()!.top_individual_score : 0),
      last_updated: FieldValue.serverTimestamp()
    });
  });
}

export async function ingestBatch(
  db: Firestore,
  matches: MatchDocument[],
  // Tarefa C4 (Spec 05 §3.2): gatilho da canonicalização assíncrona, injetado por quem monta o
  // servidor (index.ts). `ingest.test.ts` não passa nada, então os testes de ingestão nunca
  // tocam o Vertex. Chamado SEM `await` logo abaixo — nunca no caminho de resposta.
  onNeedsReview?: (db: Firestore) => void
): Promise<IngestResult> {
  const accepted: string[] = [];
  const rejected: Array<{ match_id: string; reason: string }> = [];
  let anyNeedsReview = false;

  for (const m of matches) {
    const reason = validate(m);
    if (reason) {
      rejected.push({ match_id: m.match_id ?? '(sem match_id)', reason });
      continue;
    }
    await ingestOne(db, m);
    accepted.push(m.match_id);
    if (m.needs_company_review) anyNeedsReview = true;
  }

  if (anyNeedsReview && onNeedsReview) {
    onNeedsReview(db);
  }

  return { accepted, rejected };
}
