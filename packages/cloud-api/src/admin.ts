/**
 * Painel de administração — Tarefa C7 (brief `task-C7-brief.md`, Spec 05 §4.3).
 *
 * `patchMatch` é o único lugar do sistema onde recalcular um agregado varrendo as
 * partidas de uma empresa é a implementação correta. A Spec 05 §4.3 proíbe isso no
 * caminho de ingestão (`ingest.ts`), que é quente e roda centenas de vezes por evento;
 * este caminho é frio, roda um punhado de vezes, disparado por um operador humano atrás
 * do IAP — nunca pelo daemon do estande. `top_individual_score` é a razão de fundo:
 * é um máximo, não uma soma, e não sobrevive a um decremento aritmético — anular o
 * recordista exige descobrir quem é o segundo colocado, e só uma varredura responde
 * isso. `total_score`/`pilots_count` dariam para ajustar por delta, mas recalculá-los
 * junto com `top_individual_score`, do zero, a cada correção, é o que torna a operação
 * idempotente de graça: uma segunda anulação da mesma partida recalcula exatamente o
 * mesmo estado, em vez de descontar de novo.
 *
 * Autenticação: nenhuma checagem aqui. Em produção, `/v1/admin/*` fica atrás do
 * Identity-Aware Proxy do Cloud Run (configuração de deploy, ver README) — o token de
 * ingestão de escopo único da Tarefa C3 não abre esta porta de propósito, porque é o
 * mesmo token que vive na máquina do estande. Em desenvolvimento/emulador, isso
 * significa que estas rotas ficam abertas sem nenhum token, o que é esperado nesta
 * camada.
 */
import { FieldValue, type Firestore, type Query } from 'firebase-admin/firestore';
import {
  SCHEMA_VERSION,
  field,
  type MatchDocument,
  type CompanyCatalogDocument
} from '@jogo/shared';
import { MAX_PLAUSIBLE_SCORE } from './ingest.js';

// ---------------------------------------------------------------------------
// PATCH /v1/admin/matches/:id
// ---------------------------------------------------------------------------

/** Campos que uma correção manual pode tocar. Tudo opcional: o operador manda só o que muda. */
export interface MatchCorrection {
  callsign?: string;
  company_canonical?: string;
  final_score?: number;
  voided?: boolean;
}

type StoredMatch = MatchDocument;

interface CompanyAggregate {
  total_score: number;
  pilots_count: number;
  top_individual_score: number;
}

/**
 * Recalcula do zero o agregado de uma empresa a partir dos documentos que a consulta
 * (feita ANTES de qualquer escrita, dentro da mesma transação) trouxe. `patchedMatch` é
 * a versão já corrigida da partida em edição — ela é removida da lista bruta (pelo id,
 * que reflete o estado ANTES da correção) e reinserida só se, depois da correção, ainda
 * pertencer a esta empresa. Isso é o que faz `patchMatch` acertar os dois agregados numa
 * troca de empresa: a consulta pela empresa antiga inclui a partida (ela ainda apontava
 * para lá quando a consulta rodou); a consulta pela empresa nova não inclui (ela nunca
 * apontou pra lá) — a substituição manual cobre os dois lados.
 */
function recalcAggregate(
  company: string,
  rawDocs: StoredMatch[],
  patchedMatchId: string,
  patchedMatch: StoredMatch
): CompanyAggregate {
  const docs: StoredMatch[] = [];
  for (const d of rawDocs) {
    if (d.match_id === patchedMatchId) continue; // versão pré-correção; tratada abaixo
    docs.push(d);
  }
  if (patchedMatch.company_canonical === company) {
    docs.push(patchedMatch);
  }

  const active = docs.filter((d) => !d.voided);
  return {
    total_score: active.reduce((sum, d) => sum + d.final_score, 0),
    pilots_count: new Set(active.map((d) => d.pilot_id)).size,
    top_individual_score: active.reduce((max, d) => Math.max(max, d.final_score), 0)
  };
}

function validateCorrection(current: StoredMatch, changes: MatchCorrection): void {
  if (changes.final_score !== undefined) {
    const s = changes.final_score;
    if (typeof s !== 'number' || Number.isNaN(s) || s < 0 || s > MAX_PLAUSIBLE_SCORE) {
      throw new Error(`patchMatch: final_score out of plausible range (0-${MAX_PLAUSIBLE_SCORE}): ${s}`);
    }
  }
  if (changes.callsign !== undefined && !changes.callsign.trim()) {
    throw new Error('patchMatch: callsign cannot be blank');
  }
  if (changes.company_canonical !== undefined && !changes.company_canonical.trim()) {
    throw new Error('patchMatch: company_canonical cannot be blank');
  }
  void current;
}

/**
 * Corrige uma partida numa única transação: lê a partida e as partidas de toda empresa
 * afetada (a antiga e, se `company_canonical` mudou, a nova), aplica as mudanças
 * validadas, e regrava `company_rankings` das empresas afetadas com o agregado
 * recalculado do zero. Anular (`voided: true`) nunca apaga o documento — só o exclui
 * dos três campos agregados daqui pra frente.
 */
export async function patchMatch(db: Firestore, matchId: string, changes: MatchCorrection): Promise<void> {
  await db.runTransaction(async (tx) => {
    const matchRef = db.collection('matches').doc(matchId);
    const matchSnap = await tx.get(matchRef);
    if (!matchSnap.exists) {
      throw new Error(`patchMatch: match ${matchId} not found`);
    }
    const current = matchSnap.data() as StoredMatch;
    validateCorrection(current, changes);

    const patchedMatch: StoredMatch = { ...current, ...changes };
    const oldCompany = current.company_canonical;
    const newCompany = patchedMatch.company_canonical;
    const affectedCompanies = Array.from(new Set([oldCompany, newCompany]));

    // Todas as leituras (as duas consultas por empresa, no máximo) vêm antes de
    // qualquer escrita — regra de transação do Firestore.
    const companyDocs = new Map<string, StoredMatch[]>();
    for (const company of affectedCompanies) {
      const query: Query = db.collection('matches').where(field<MatchDocument>('company_canonical'), '==', company);
      const snap = await tx.get(query);
      companyDocs.set(company, snap.docs.map((d) => d.data() as StoredMatch));
    }

    for (const company of affectedCompanies) {
      const agg = recalcAggregate(company, companyDocs.get(company)!, matchId, patchedMatch);
      const companyRef = db.collection('company_rankings').doc(company);
      tx.set(companyRef, {
        schema_version: SCHEMA_VERSION,
        company_canonical: company,
        total_score: agg.total_score,
        pilots_count: agg.pilots_count,
        top_individual_score: agg.top_individual_score,
        last_updated: FieldValue.serverTimestamp()
      });
    }

    tx.set(matchRef, { ...patchedMatch, schema_version: SCHEMA_VERSION });
  });
}

// ---------------------------------------------------------------------------
// GET /v1/admin/matches
// ---------------------------------------------------------------------------

export interface ListMatchesParams {
  q?: string;
  company?: string;
  limit?: number;
}

const LIST_MATCHES_DEFAULT_LIMIT = 50;
const LIST_MATCHES_MAX_LIMIT = 200;
// Firestore não faz busca de texto OR entre dois campos (callsign, company_canonical)
// numa única consulta indexada. Este endpoint é administrativo e frio (Spec 05 §4.3 não
// se aplica aqui, mesmo raciocínio de patchMatch acima) — busca a janela mais recente e
// filtra em memória. Uma janela de 500 cobre um evento inteiro com folga; se o volume
// crescer muito além disso, este é o primeiro lugar a revisar.
const LIST_MATCHES_SCAN_WINDOW = 500;

/** `GET /v1/admin/matches?q=&company=&limit=` — busca por callsign ou empresa (Spec 05 §4.3 não se aplica). */
export async function listMatches(db: Firestore, params: ListMatchesParams): Promise<MatchDocument[]> {
  const limit = Math.min(Math.max(params.limit ?? LIST_MATCHES_DEFAULT_LIMIT, 1), LIST_MATCHES_MAX_LIMIT);

  const snap = await db
    .collection('matches')
    .orderBy(field<MatchDocument>('created_at'), 'desc')
    .limit(LIST_MATCHES_SCAN_WINDOW)
    .get();
  let docs = snap.docs.map((d) => d.data() as MatchDocument);

  if (params.company) {
    docs = docs.filter((m) => m.company_canonical === params.company);
  }
  if (params.q) {
    const q = params.q.toLowerCase();
    docs = docs.filter(
      (m) => m.callsign.toLowerCase().includes(q) || m.company_canonical.toLowerCase().includes(q)
    );
  }
  return docs.slice(0, limit);
}

// ---------------------------------------------------------------------------
// GET/PUT /v1/admin/companies
// ---------------------------------------------------------------------------

const COMPANY_CATALOG_DOC_ID = 'catalog';

/** `GET /v1/admin/companies` — devolve `{ companies: [] }` se o painel ainda nunca gravou nada. */
export async function getCompanyCatalog(db: Firestore): Promise<CompanyCatalogDocument> {
  const snap = await db.collection('companies').doc(COMPANY_CATALOG_DOC_ID).get();
  if (!snap.exists) {
    return { schema_version: SCHEMA_VERSION, companies: [], updated_at: new Date(0).toISOString() };
  }
  return snap.data() as CompanyCatalogDocument;
}

/**
 * `PUT /v1/admin/companies` — grava o catálogo canônico no Firestore. Esta escrita NÃO
 * toca `config/companies.json` do estande: as duas fontes existem de propósito (Spec 05
 * §5 evita um segundo canal nuvem→estande), e a reconciliação é manual, via o botão
 * "exportar para o estande" do painel (client-side, gera o JSON para download).
 */
export async function putCompanyCatalog(db: Firestore, companies: string[]): Promise<void> {
  if (!Array.isArray(companies) || companies.some((c) => typeof c !== 'string' || !c.trim())) {
    throw new Error('putCompanyCatalog: companies must be an array of non-blank strings');
  }
  await db.collection('companies').doc(COMPANY_CATALOG_DOC_ID).set({
    schema_version: SCHEMA_VERSION,
    companies,
    updated_at: FieldValue.serverTimestamp()
  });
}

// ---------------------------------------------------------------------------
// GET /v1/admin/health
// ---------------------------------------------------------------------------

/** Janela de partidas (por `created_at`) usada para estimar a taxa de preset de emergência. */
const HEALTH_SAMPLE_SIZE = 200;

export interface AdminHealthReport {
  syncQueue: {
    stations: Array<{ stationId: string; pending: number; state: string }>;
    note: string;
  };
  recentRejections: {
    items: Array<{ match_id: string; reason: string }>;
    note: string;
  };
  emergencyPreset: {
    rate: number;
    sampleSize: number;
    note: string;
  };
}

/**
 * `GET /v1/admin/health`. Limitação aceita e documentada (não corrigida aqui, ver
 * relatório da Tarefa C7): `CloudSyncService.status()` (Tarefa C5) é estado em processo
 * de CADA daemon do estande, nunca reportado ao Firestore — este endpoint roda no
 * Cloud Run e não tem, hoje, nenhuma fila de sincronização por estação para mostrar.
 * O mesmo vale para `ingestBatch`'s `rejected[]` (`ingest.ts`): é devolvido na resposta
 * HTTP e nunca persistido. A única métrica que este endpoint calcula de verdade é a taxa
 * de preset de emergência, porque `telemetry.fallback_used` É gravado em `matches`.
 */
export async function getHealthReport(db: Firestore): Promise<AdminHealthReport> {
  const snap = await db
    .collection('matches')
    .orderBy(field<MatchDocument>('created_at'), 'desc')
    .limit(HEALTH_SAMPLE_SIZE)
    .get();
  const docs = snap.docs.map((d) => d.data() as MatchDocument);
  const sampleSize = docs.length;
  const fallbackCount = docs.filter((d) => d.telemetry?.fallback_used).length;
  const rate = sampleSize > 0 ? fallbackCount / sampleSize : 0;

  return {
    syncQueue: {
      stations: [],
      note:
        "CloudSyncService.status() (Task C5) is per-daemon, in-process state and is never reported " +
        'to Firestore, so this cloud-side endpoint has no per-station sync queue to show today. Only ' +
        'a single station is realistically deployed for this event; a real multi-station queue view ' +
        'would need a new booth-to-cloud status channel, which is out of scope here.'
    },
    recentRejections: {
      items: [],
      note:
        "ingestBatch's rejected list (ingest.ts) is returned synchronously in the POST /v1/matches " +
        'response and is never persisted, so there is no server-side history to query yet.'
    },
    emergencyPreset: {
      rate,
      sampleSize,
      note: `Share of the last ${HEALTH_SAMPLE_SIZE} matches (ordered by created_at) with telemetry.fallback_used = true.`
    }
  };
}
