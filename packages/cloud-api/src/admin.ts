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
  type CompanyCatalogDocument,
  type MatchCorrection,
  type AdminHealthReport
} from '@jogo/shared';
import { MAX_PLAUSIBLE_SCORE } from './ingest.js';

// ---------------------------------------------------------------------------
// PATCH /v1/admin/matches/:id
// ---------------------------------------------------------------------------

export type { MatchCorrection, AdminHealthReport };

type StoredMatch = MatchDocument;

/**
 * Crítico 2 (revisão final Fase C): `created_at` é gravado como `FieldValue.serverTimestamp()`
 * (`ingest.ts`), então todo documento lido de volta do Firestore carrega um `Timestamp` do
 * Admin SDK aqui, não a string ISO que o tipo `MatchDocument.created_at` promete. Sem esta
 * conversão, `listMatches` devolvia o `Timestamp` cru na resposta HTTP — que serializa como
 * `{ _seconds, _nanoseconds }` — e `MatchesScreen.tsx` (admin-app) quebrava ao tentar
 * renderizar isso como filho do React ("Objects are not valid as a React child"), tela
 * branca no painel principal. Detecta via `.toDate` (todo `Timestamp` do Admin SDK expõe
 * esse método) em vez de checar a classe exata, para não acoplar a um import específico.
 */
function toIsoTimestamp(value: unknown): string {
  if (value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return typeof value === 'string' ? value : new Date(0).toISOString();
}

/** Normaliza um documento cru do Firestore para o contrato ISO-string de `MatchDocument`. */
function normalizeMatchDocForRead(raw: MatchDocument): MatchDocument {
  return { ...raw, created_at: toIsoTimestamp(raw.created_at) };
}

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
  patchedMatch: StoredMatch | null
): CompanyAggregate {
  const docs: StoredMatch[] = [];
  for (const d of rawDocs) {
    if (d.match_id === patchedMatchId) continue; // versão pré-correção; tratada abaixo
    docs.push(d);
  }
  // `patchedMatch` é `null` quando a partida foi apagada (`deleteMatch`) — não sobra nada
  // para reinserir, ao contrário de `patchMatch`, que sempre tem uma versão corrigida.
  if (patchedMatch && patchedMatch.company_canonical === company) {
    docs.push(patchedMatch);
  }

  const active = docs.filter((d) => !d.voided);
  return {
    total_score: active.reduce((sum, d) => sum + d.final_score, 0),
    pilots_count: new Set(active.map((d) => d.pilot_id)).size,
    top_individual_score: active.reduce((max, d) => Math.max(max, d.final_score), 0)
  };
}

interface PilotAggregate {
  best_score: number;
  matches_played: number;
}

/**
 * Revisão final Fase C — Importante 7: espelha `recalcAggregate` acima, mas para
 * `pilots/{pilot_id}` em vez de `company_rankings/{company}`. `patchMatch` nunca troca o
 * `pilot_id` de uma partida (não é um campo de `MatchCorrection`), então só o piloto DONO
 * da partida em edição é afetado — sem o cenário "duas consultas, dois lados" que
 * `recalcAggregate` precisa tratar para empresa. Sem isto, anular ou corrigir o
 * `final_score` da melhor partida de um piloto deixava `pilots/{id}.best_score` e
 * `.matches_played` desatualizados para sempre (só `ingestOne`, no caminho de ingestão,
 * escrevia esses dois campos).
 */
function recalcPilotAggregate(
  rawDocs: StoredMatch[],
  patchedMatchId: string,
  patchedMatch: StoredMatch | null
): PilotAggregate {
  const docs: StoredMatch[] = [];
  for (const d of rawDocs) {
    if (d.match_id === patchedMatchId) continue; // versão pré-correção; substituída abaixo
    docs.push(d);
  }
  // `patchedMatch` é `null` quando a partida foi apagada (`deleteMatch`) — nada a
  // reinserir. `pilot_id` nunca muda via `patchMatch`, então quando não é null ela
  // sempre pertence a este piloto.
  if (patchedMatch) {
    docs.push(patchedMatch);
  }

  const active = docs.filter((d) => !d.voided);
  return {
    best_score: active.reduce((max, d) => Math.max(max, d.final_score), 0),
    matches_played: active.length
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
    // Importante 6: uma correção manual de empresa não pode ser sobrescrita depois por uma
    // varredura de canonicalização em segundo plano (Tarefa C4) que ainda enxergue a marca
    // antiga e "corrija de volta" para o palpite original do modelo.
    if (changes.company_canonical !== undefined) {
      delete patchedMatch.needs_company_review;
    }
    const oldCompany = current.company_canonical;
    const newCompany = patchedMatch.company_canonical;
    const affectedCompanies = Array.from(new Set([oldCompany, newCompany]));

    // Todas as leituras (as consultas por empresa e a consulta pelo piloto) vêm antes de
    // qualquer escrita — regra de transação do Firestore.
    const companyDocs = new Map<string, StoredMatch[]>();
    for (const company of affectedCompanies) {
      const query: Query = db.collection('matches').where(field<MatchDocument>('company_canonical'), '==', company);
      const snap = await tx.get(query);
      companyDocs.set(company, snap.docs.map((d) => d.data() as StoredMatch));
    }

    // Importante 7: `pilot_id` nunca muda via `MatchCorrection` — só o piloto dono desta
    // partida pode ser afetado por ela.
    const pilotId = current.pilot_id;
    const pilotMatchesQuery: Query = db.collection('matches').where(field<MatchDocument>('pilot_id'), '==', pilotId);
    const pilotMatchesSnap = await tx.get(pilotMatchesQuery);
    const pilotMatches = pilotMatchesSnap.docs.map((d) => d.data() as StoredMatch);
    const pilotRef = db.collection('pilots').doc(pilotId);
    const pilotSnap = await tx.get(pilotRef);

    // Minor 10 (revisão final Fase C): considerado apagar (`tx.delete`) o documento de uma
    // empresa cujo agregado recalculado zerou (0 partidas ativas), em vez de deixar um
    // documento zerado. Decidido NÃO fazer isso: `admin.test.ts`'s "anular duas vezes não
    // desconta duas vezes" (dado verbatim pelo plano) lê `company_rankings/Google` com `!`
    // logo depois de anular a única partida da empresa — esperando um documento zerado, não
    // ausente. Apagar aqui quebraria esse teste sem ganho funcional real (um zero-valorado é
    // inofensivo, como o revisor já observou); manter o `set` incondicional de baixo.
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

    const pilotAgg = recalcPilotAggregate(pilotMatches, matchId, patchedMatch);
    if (pilotSnap.exists) {
      tx.set(
        pilotRef,
        { best_score: pilotAgg.best_score, matches_played: pilotAgg.matches_played },
        { merge: true }
      );
    }
    // Se o documento do piloto não existir (não deveria acontecer — `ingestOne` sempre cria
    // um — não inventamos um aqui: faltariam `callsign`/`company_canonical`/`created_at`
    // reais para um `set` completo, e um `patchMatch` não é o lugar de suprir isso.

    tx.set(matchRef, { ...patchedMatch, schema_version: SCHEMA_VERSION });
  });
}

// ---------------------------------------------------------------------------
// DELETE /v1/admin/matches/:id (via POST /v1/admin/matches/bulk, Tarefa C9)
// ---------------------------------------------------------------------------

/**
 * Apaga de verdade uma partida (`tx.delete`), ao contrário de `patchMatch({voided: true})`,
 * que mantém o documento e só o exclui dos agregados. Existe para limpar dados de teste
 * (placares de antes de correções, empresas fictícias) sem deixá-los acumulados como
 * "ANULADA" para sempre — brief da Tarefa C9. Segue a mesma forma de transação de
 * `patchMatch` (ler tudo antes de escrever, recalcular do zero via os mesmos
 * `recalcAggregate`/`recalcPilotAggregate`), mas mais simples: só UMA empresa é afetada
 * (a da própria partida — nada muda de empresa aqui), e não há "versão corrigida" para
 * reinserir, então os dois helpers recebem `null` no lugar de `patchedMatch`.
 */
export async function deleteMatch(db: Firestore, matchId: string): Promise<void> {
  await db.runTransaction(async (tx) => {
    const matchRef = db.collection('matches').doc(matchId);
    const matchSnap = await tx.get(matchRef);
    if (!matchSnap.exists) {
      throw new Error(`deleteMatch: match ${matchId} not found`);
    }
    const current = matchSnap.data() as StoredMatch;
    const company = current.company_canonical;

    // Todas as leituras antes de qualquer escrita — mesma regra de transação do Firestore
    // que `patchMatch` segue.
    const companyQuery: Query = db.collection('matches').where(field<MatchDocument>('company_canonical'), '==', company);
    const companySnap = await tx.get(companyQuery);
    const companyDocs = companySnap.docs.map((d) => d.data() as StoredMatch);

    const pilotId = current.pilot_id;
    const pilotMatchesQuery: Query = db.collection('matches').where(field<MatchDocument>('pilot_id'), '==', pilotId);
    const pilotMatchesSnap = await tx.get(pilotMatchesQuery);
    const pilotMatches = pilotMatchesSnap.docs.map((d) => d.data() as StoredMatch);
    const pilotRef = db.collection('pilots').doc(pilotId);
    const pilotSnap = await tx.get(pilotRef);

    // Diferente de patchMatch (comentário acima, Minor 10): deleteMatch é o caminho de
    // limpeza de dados de teste, então um agregado que recalcula para zero partidas ativas
    // aqui não é "temporariamente zerado" -- é "não sobrou nada desta empresa/piloto", e um
    // documento fantasma zero-valorado poderia aparecer no ranking do painel ou (no início
    // de um evento, antes de empresas reais pontuarem) até no telão público. `tx.delete` em
    // vez de `tx.set` quando o agregado recalculado está vazio.
    const agg = recalcAggregate(company, companyDocs, matchId, null);
    const companyRef = db.collection('company_rankings').doc(company);
    if (agg.pilots_count === 0) {
      tx.delete(companyRef);
    } else {
      tx.set(companyRef, {
        schema_version: SCHEMA_VERSION,
        company_canonical: company,
        total_score: agg.total_score,
        pilots_count: agg.pilots_count,
        top_individual_score: agg.top_individual_score,
        last_updated: FieldValue.serverTimestamp()
      });
    }

    const pilotAgg = recalcPilotAggregate(pilotMatches, matchId, null);
    if (pilotSnap.exists) {
      if (pilotAgg.matches_played === 0) {
        tx.delete(pilotRef);
      } else {
        tx.set(
          pilotRef,
          { best_score: pilotAgg.best_score, matches_played: pilotAgg.matches_played },
          { merge: true }
        );
      }
    }

    tx.delete(matchRef);
  });
}

// ---------------------------------------------------------------------------
// POST /v1/admin/matches/bulk (Tarefa C9)
// ---------------------------------------------------------------------------

export interface BulkMatchActionResult {
  succeeded: string[];
  failed: Array<{ match_id: string; reason: string }>;
}

/**
 * Aplica `action` a cada `match_id` do lote, um de cada vez, isolando falhas por item —
 * mesmo espírito de `ingestBatch` (`ingest.ts`): uma partida com problema (já apagada,
 * `match_id` inexistente) não pode travar as outras 49 de uma limpeza em lote. Reusa
 * `patchMatch`/`deleteMatch` (já testados pela Tarefa C7 e acima) em vez de duplicar a
 * lógica de recálculo — se o volume real mostrar que recalcular a mesma empresa dezenas
 * de vezes em sequência é lento, otimizar isso é uma tarefa separada.
 */
export async function bulkPatchOrDelete(
  db: Firestore,
  matchIds: string[],
  action: 'void' | 'delete'
): Promise<BulkMatchActionResult> {
  const succeeded: string[] = [];
  const failed: Array<{ match_id: string; reason: string }> = [];

  for (const matchId of matchIds) {
    try {
      if (action === 'delete') {
        await deleteMatch(db, matchId);
      } else {
        await patchMatch(db, matchId, { voided: true });
      }
      succeeded.push(matchId);
    } catch (err) {
      failed.push({ match_id: matchId, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  return { succeeded, failed };
}

// ---------------------------------------------------------------------------
// GET /v1/admin/matches
// ---------------------------------------------------------------------------

export interface ListMatchesParams {
  q?: string;
  company?: string;
  /**
   * Filtra por `station_id`. Em memória, sobre a mesma janela já varrida — nenhuma consulta nova,
   * nenhum índice novo. Serve à pergunta operacional de um evento com dois estandes: "o que
   * aquele Mac mandou?", tipicamente depois da tabela de atividade apontar um deles.
   */
  station?: string;
  limit?: number;
}

const LIST_MATCHES_DEFAULT_LIMIT = 50;
const LIST_MATCHES_MAX_LIMIT = 200;
// Firestore não faz busca de texto OR entre campos (callsign, company_canonical, match_id)
// numa única consulta indexada. Este endpoint é administrativo e frio (Spec 05 §4.3 não
// se aplica aqui, mesmo raciocínio de patchMatch acima) — busca a janela mais recente e
// filtra em memória. Uma janela de 500 cobre um evento inteiro com folga; se o volume
// crescer muito além disso, este é o primeiro lugar a revisar.
const LIST_MATCHES_SCAN_WINDOW = 500;

/**
 * Um `q` que seja um `match_id` inteiro pode ser resolvido por leitura direta, porque
 * `match_id` É o ID do documento (`ingest.ts`). Isso importa: a busca em memória acima só
 * enxerga as 500 partidas mais recentes, e o caso em que o staff digita um `match_id`
 * completo é justamente o caso em que ele veio de um log ou do JSON de debriefing e pode
 * ser de horas antes. Sem esta leitura, o operador tem o identificador exato na mão e a
 * busca não acha nada.
 *
 * O guarda não é decorativo: `.doc()` lança para caminho vazio, com `/`, ou `.`/`..`, e
 * `q` é texto livre digitado por gente. Sem ele, buscar "a/b" derruba o endpoint com 500.
 */
function couldBeDocumentId(q: string): boolean {
  return q.length > 0 && q.length <= 1500 && !q.includes('/') && q !== '.' && q !== '..';
}

/** `GET /v1/admin/matches?q=&company=&limit=` — busca por callsign, empresa ou match_id (Spec 05 §4.3 não se aplica). */
export async function listMatches(db: Firestore, params: ListMatchesParams): Promise<MatchDocument[]> {
  const limit = Math.min(Math.max(params.limit ?? LIST_MATCHES_DEFAULT_LIMIT, 1), LIST_MATCHES_MAX_LIMIT);

  const snap = await db
    .collection('matches')
    .orderBy(field<MatchDocument>('created_at'), 'desc')
    .limit(LIST_MATCHES_SCAN_WINDOW)
    .get();
  let docs = snap.docs.map((d) => normalizeMatchDocForRead(d.data() as MatchDocument));

  if (params.company) {
    docs = docs.filter((m) => m.company_canonical === params.company);
  }
  if (params.station) {
    docs = docs.filter((m) => (m.station_id ?? UNKNOWN_STATION_LABEL) === params.station);
  }
  if (params.q) {
    const q = params.q.toLowerCase();
    docs = docs.filter(
      (m) =>
        m.callsign.toLowerCase().includes(q) ||
        m.company_canonical.toLowerCase().includes(q) ||
        m.match_id.toLowerCase().includes(q)
    );

    // Fora da janela de varredura: leitura direta pelo ID, unida ao resultado. Vai na
    // frente porque quem colou um `match_id` inteiro quer aquela partida, não uma lista.
    if (couldBeDocumentId(params.q) && !docs.some((m) => m.match_id === params.q)) {
      const exact = await db.collection('matches').doc(params.q).get();
      if (exact.exists) {
        const doc = normalizeMatchDocForRead(exact.data() as MatchDocument);
        // Os filtros continuam valendo: um ID exato de outra empresa (ou de outra estação)
        // apareceria como resultado de uma busca que o operador restringiu de propósito.
        const matchesCompany = !params.company || doc.company_canonical === params.company;
        const matchesStation = !params.station || (doc.station_id ?? UNKNOWN_STATION_LABEL) === params.station;
        if (matchesCompany && matchesStation) {
          docs = [doc, ...docs];
        }
      }
    }
  }
  return docs.slice(0, limit);
}

// ---------------------------------------------------------------------------
// GET/PUT /v1/admin/companies
// ---------------------------------------------------------------------------

const COMPANY_CATALOG_DOC_ID = 'catalog';

/**
 * Uma gravação perdeu a corrida contra outra. Tipo próprio (e não um `Error` genérico) porque
 * `index.ts` precisa distinguir isto de um corpo malformado: 409 com o estado atual, para o
 * painel poder dizer "outro operador salvou primeiro" em vez de 400 "requisição inválida".
 */
export class CatalogConflictError extends Error {
  constructor(readonly current: CompanyCatalogDocument) {
    super('putCompanyCatalog: o catálogo foi alterado por outra pessoa desde que esta tela carregou');
    this.name = 'CatalogConflictError';
  }
}

/** `GET /v1/admin/companies` — devolve `{ companies: [] }` se o painel ainda nunca gravou nada. */
export async function getCompanyCatalog(db: Firestore): Promise<CompanyCatalogDocument> {
  const snap = await db.collection('companies').doc(COMPANY_CATALOG_DOC_ID).get();
  if (!snap.exists) {
    return { schema_version: SCHEMA_VERSION, companies: [], updated_at: new Date(0).toISOString(), version: 0 };
  }
  const data = snap.data() as CompanyCatalogDocument;
  // Documento gravado antes de `version` existir: 1, não 0. Zero significa "nunca gravado", e
  // um `PUT` com `expectedVersion: 0` contra um documento real seria um conflito de verdade.
  return { ...data, version: typeof data.version === 'number' ? data.version : 1 };
}

/**
 * `PUT /v1/admin/companies` — grava o catálogo canônico, que é a FONTE ÚNICA consumida pela
 * canonicalização na nuvem e pelas duas estações (via `GET /v1/companies`).
 *
 * Duas travas que não existiam quando esta escrita era um `.set()` puro e o documento não
 * alimentava nada:
 *
 * 1. **Lista vazia é recusada** sem `force`. Um catálogo vazio não é um estado neutro: ele
 *    desliga o casamento de nomes nas duas estações ao mesmo tempo e racha `company_rankings`
 *    em uma entrada por grafia digitada. É um bloqueador visível ao visitante nascido de um
 *    clique no painel, e o caminho mais provável até ele é banal — a tela abria com `[]`
 *    quando o documento não existia, e bastava um "Salvar" descuidado.
 * 2. **Concorrência otimista** por `version`. Dois operadores com a tela aberta ao mesmo tempo
 *    não podem mais fazer o segundo apagar as edições do primeiro em silêncio.
 */
export async function putCompanyCatalog(
  db: Firestore,
  companies: string[],
  opts: { expectedVersion?: number; force?: boolean } = {}
): Promise<{ version: number }> {
  if (!Array.isArray(companies) || companies.some((c) => typeof c !== 'string' || !c.trim())) {
    throw new Error('putCompanyCatalog: companies must be an array of non-blank strings');
  }
  if (companies.length === 0 && !opts.force) {
    throw new Error(
      'putCompanyCatalog: recusando gravar um catálogo VAZIO. Isso desliga o casamento de ' +
        'empresas nas duas estações e racha o ranking por grafia. Se é mesmo o que você quer, ' +
        'reenvie com force=true.'
    );
  }

  const ref = db.collection('companies').doc(COMPANY_CATALOG_DOC_ID);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? (snap.data() as CompanyCatalogDocument) : null;
    const currentVersion = current ? (typeof current.version === 'number' ? current.version : 1) : 0;

    if (opts.expectedVersion !== undefined && opts.expectedVersion !== currentVersion) {
      throw new CatalogConflictError(
        current
          ? { ...current, version: currentVersion }
          : { schema_version: SCHEMA_VERSION, companies: [], updated_at: new Date(0).toISOString(), version: 0 }
      );
    }

    const nextVersion = currentVersion + 1;
    tx.set(ref, {
      schema_version: SCHEMA_VERSION,
      companies,
      updated_at: FieldValue.serverTimestamp(),
      version: nextVersion
    });
    return { version: nextVersion };
  });
}

/**
 * Semeadura idempotente: cria o documento a partir de `config/companies.json` se — e somente
 * se — ele ainda não existir. Devolve `true` quando de fato criou.
 *
 * **Nunca sobrescreve.** Um deploy na véspera do evento que apagasse as empresas cadastradas
 * pelo operador seria pior que um deploy que não semeia nada. É por isso que a leitura e a
 * escrita ficam na mesma transação em vez de um `set` com merge.
 */
export async function seedCompanyCatalogIfMissing(db: Firestore, companies: string[]): Promise<boolean> {
  if (!Array.isArray(companies) || companies.length === 0) return false;

  const ref = db.collection('companies').doc(COMPANY_CATALOG_DOC_ID);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const existing = snap.exists ? (snap.data() as CompanyCatalogDocument) : null;
    // Documento presente mas VAZIO também é semeado: é o resultado exato do "Salvar" descuidado
    // descrito em `putCompanyCatalog`, e deixá-lo assim manteria as duas estações sem catálogo.
    if (existing && Array.isArray(existing.companies) && existing.companies.length > 0) return false;

    tx.set(ref, {
      schema_version: SCHEMA_VERSION,
      companies,
      updated_at: FieldValue.serverTimestamp(),
      version: (existing && typeof existing.version === 'number' ? existing.version : 0) + 1
    });
    return true;
  });
}

// ---------------------------------------------------------------------------
// GET /v1/admin/health
// ---------------------------------------------------------------------------

/** Janela de partidas (por `created_at`) usada para estimar a taxa de preset de emergência. */
const HEALTH_SAMPLE_SIZE = 200;

/** Rótulo das partidas ingeridas antes de `station_id` existir, ou vindas de um daemon sem env. */
export const UNKNOWN_STATION_LABEL = '(sem station_id)';

/**
 * Agrupa a amostra de partidas por estação. Recebe os documentos já lidos — a leitura é a MESMA
 * de `getHealthReport`, e o ponto inteiro desta seção é não custar nenhuma leitura extra nem
 * exigir um canal novo do estande para a nuvem.
 *
 * Ordena por atividade mais recente primeiro: no dia, a pergunta é "qual Mac parou?", e a
 * resposta é a última linha da tabela.
 */
export function groupMatchesByStation(
  docs: MatchDocument[]
): Array<{ stationId: string; matches: number; lastMatchAt: string }> {
  const byStation = new Map<string, { matches: number; lastMatchAt: string }>();

  for (const doc of docs) {
    const stationId = typeof doc.station_id === 'string' && doc.station_id ? doc.station_id : UNKNOWN_STATION_LABEL;
    // `toIsoTimestamp` e não `String(...)`: `created_at` volta do Firestore como `Timestamp` do
    // Admin SDK, e mandar isso cru para o React é exatamente o bug que aquele helper documenta.
    const at = toIsoTimestamp(doc.created_at);
    const current = byStation.get(stationId);
    if (!current) {
      byStation.set(stationId, { matches: 1, lastMatchAt: at });
      continue;
    }
    current.matches += 1;
    if (at > current.lastMatchAt) current.lastMatchAt = at;
  }

  return [...byStation.entries()]
    .map(([stationId, v]) => ({ stationId, ...v }))
    .sort((a, b) => (a.lastMatchAt < b.lastMatchAt ? 1 : a.lastMatchAt > b.lastMatchAt ? -1 : 0));
}

/**
 * `GET /v1/admin/health`. Limitação aceita e documentada (não corrigida aqui, ver
 * relatório da Tarefa C7): `CloudSyncService.status()` (Tarefa C5) é estado em processo
 * de CADA daemon do estande, nunca reportado ao Firestore — este endpoint roda no
 * Cloud Run e não tem, hoje, nenhuma fila de sincronização por estação para mostrar.
 * O mesmo vale para `ingestBatch`'s `rejected[]` (`ingest.ts`): é devolvido na resposta
 * HTTP e nunca persistido.
 *
 * O que este endpoint calcula de verdade é o que sai da própria coleção `matches`: a taxa de
 * preset de emergência (`telemetry.fallback_used` É gravado) e, desde que o evento passou a ter
 * dois estandes, a atividade por estação — o mesmo snapshot de 200 partidas agrupado por
 * `station_id`, sem nenhuma leitura extra e sem canal novo do estande para a nuvem.
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
        'to Firestore, so this cloud-side endpoint has no per-station sync queue to show today. A real ' +
        'multi-station queue view would need a new booth-to-cloud status channel, which is out of scope ' +
        'here. Para saber se cada Mac está VIVO — pergunta diferente — ver stationActivity abaixo.'
    },
    stationActivity: {
      stations: groupMatchesByStation(docs),
      sampleSize,
      note:
        `Partidas das últimas ${HEALTH_SAMPLE_SIZE} ingeridas, agrupadas por station_id. É atividade ` +
        'observada na nuvem, não estado do estande: uma estação que jogou e ficou sem rede só aparece ' +
        'aqui quando a fila dela drenar, e lastMatchAt é a hora de INGESTÃO, não a de jogo. Partidas ' +
        `anteriores ao campo station_id aparecem como "${UNKNOWN_STATION_LABEL}".`
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
