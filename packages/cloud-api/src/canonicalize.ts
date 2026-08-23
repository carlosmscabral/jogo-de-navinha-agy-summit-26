/**
 * Canonicalização assíncrona com backfill — Spec 05 §3.1/§3.2, Spec 08 §6.
 *
 * Ao contrário de `moderation-l2.ts` (bloqueante, falha fechada), este arquivo é
 * o lado "não vale a espera" da Tarefa C4: uma partida com `needs_company_review`
 * já foi gravada com o palpite local (a resolução por catálogo/fuzzy-match do
 * daemon); o modelo roda depois, em segundo plano, e CORRIGE o que já está no
 * Firestore se tiver confiança o bastante. Nenhum visitante espera por isto —
 * o gatilho é disparado sem `await` no fim de `ingestBatch` (ver ingest.ts).
 *
 * Falha do modelo aqui não vira `block` de coisa nenhuma (não existe "bloquear"
 * uma partida já aceita) — vira confidence 0, a partida continua marcada, e a
 * próxima varredura tenta de novo. Isso é intencional: uma correção errada por
 * pressa é pior que nenhuma correção.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { SCHEMA_VERSION, type MatchDocument, type CompanyRankingDocument } from '@jogo/shared';
import { generateJson } from './vertex.js';

export type GenerateFn = (prompt: string) => Promise<string>;

export interface CanonicalizeRequestItem {
  match_id: string;
  company_raw: string;
  local_guess: string;
}

export interface CanonicalizeResolvedItem {
  match_id: string;
  company_canonical: string;
  confidence: number;
}

export interface ResolvedAlias {
  raw: string;
  canonical: string;
  resolved_at: string;
}

/** Abaixo disso, a partida continua marcada e é retentada na próxima varredura — nunca "corrigida" com pouca certeza. */
export const CANONICALIZE_CONFIDENCE_THRESHOLD = 0.85;

/** No máximo isto por varredura — mesma ordem de grandeza do MAX_BATCH_SIZE de ingest.ts. */
const CANONICALIZE_SWEEP_LIMIT = 50;

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * `loadCompanyCatalog` já existe em `packages/daemon/src/services/sqlite-buffer.ts`,
 * mas importar o pacote `daemon` a partir de `cloud-api` inverteria a dependência
 * entre os dois serviços: `cloud-api` roda no Cloud Run e não deveria depender de
 * um pacote cujo papel inteiro é ser o bridge local do estande. Esta função lê o
 * mesmo `config/companies.json` — a fonte de verdade é o arquivo, não o código —
 * sem puxar o pacote do daemon como dependência. Documentado também no relatório
 * da Tarefa C4 (Passo 6: "reusar loadCompanyCatalog... ou usar uma alternativa").
 */
export function loadCompanyCatalog(filePath?: string): string[] {
  const target =
    filePath || process.env.BOOTH_COMPANIES_FILE || path.join(packageRoot, '..', '..', 'config', 'companies.json');
  if (!fs.existsSync(target)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8')) as { companies?: unknown };
    return Array.isArray(parsed.companies) ? (parsed.companies as string[]) : [];
  } catch {
    return [];
  }
}

const RESOLVE_RESPONSE_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      match_id: { type: 'string' },
      company_canonical: { type: 'string' },
      confidence: { type: 'number' }
    },
    required: ['match_id', 'company_canonical', 'confidence']
  }
};

export function buildCanonicalizePrompt(items: CanonicalizeRequestItem[], catalog: string[]): string {
  return [
    'Você canonicaliza nomes de empresa digitados por visitantes de um evento, a partir de um',
    'catálogo curado de empresas participantes. Para cada item, escolha o nome do catálogo que',
    'melhor corresponde ao texto digitado (erro de digitação, abreviação, sigla, subsidiária,',
    'razão social) OU repita exatamente `local_guess` se nada do catálogo servir. Nunca invente',
    'um nome fora do catálogo e fora de `local_guess`.',
    '',
    `Catálogo: ${JSON.stringify(catalog)}`,
    `Itens a resolver: ${JSON.stringify(items)}`,
    '',
    'Responda SOMENTE um array JSON, um item por entrada de entrada, no formato exato',
    '[{"match_id": string, "company_canonical": string, "confidence": number}], confidence entre 0 e 1.'
  ].join('\n');
}

/** Fail-safe: nenhuma correção é aplicada com confidence 0 — a partida só é retentada depois. */
function fallbackResolution(items: CanonicalizeRequestItem[]): CanonicalizeResolvedItem[] {
  return items.map((i) => ({ match_id: i.match_id, company_canonical: i.local_guess, confidence: 0 }));
}

function isResolvedItemShape(value: unknown): value is CanonicalizeResolvedItem {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).match_id === 'string' &&
    typeof (value as Record<string, unknown>).company_canonical === 'string' &&
    typeof (value as Record<string, unknown>).confidence === 'number'
  );
}

/**
 * Resolve uma lista de itens contra o modelo. Usada tanto pela rota
 * `POST /v1/canonicalize` (itens vindos do corpo da requisição) quanto pela
 * varredura interna (itens vindos de `matches` com `needs_company_review`).
 */
export async function resolveCompanies(
  items: CanonicalizeRequestItem[],
  generate: GenerateFn,
  catalog: string[]
): Promise<CanonicalizeResolvedItem[]> {
  if (items.length === 0) return [];

  let raw: string;
  try {
    raw = await generate(buildCanonicalizePrompt(items, catalog));
  } catch {
    return fallbackResolution(items);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallbackResolution(items);
  }
  if (!Array.isArray(parsed)) return fallbackResolution(items);

  return items.map((item) => {
    const found = parsed.find((p) => isResolvedItemShape(p) && p.match_id === item.match_id);
    return isResolvedItemShape(found)
      ? { match_id: item.match_id, company_canonical: found.company_canonical, confidence: found.confidence }
      : { match_id: item.match_id, company_canonical: item.local_guess, confidence: 0 };
  });
}

/** Ponte real para o Vertex — nunca usada em teste. Sem thinkingLevel: usa o padrão do SDK ('medium'). */
export const generateWithVertex: GenerateFn = (prompt) => generateJson(prompt, RESOLVE_RESPONSE_SCHEMA);

/**
 * Corrige uma partida cuja canonicalização mudou de ideia em relação ao palpite
 * local. Idempotente (reler `needs_company_review` dentro da transação) e
 * modelada no mesmo estilo de `ingestOne` em `ingest.ts`: uma transação por
 * partida, lê tudo antes de escrever qualquer coisa.
 *
 * Limitação aceita, documentada no relatório da Tarefa C4: `pilots_count` em
 * `company_rankings` é, desde `ingestOne`, uma aproximação de "a empresa mais
 * recente registrada para este piloto" — não uma contagem exata por conjunto.
 * Esta correção só ajusta `pilots_count` quando o documento em `pilots/{id}`
 * ainda aponta para a empresa errada desta partida (isto é, nenhuma partida
 * mais nova já sobrescreveu isso); do contrário, mexer em `pilots_count` aqui
 * dessincronizaria do que `ingestOne` já contou depois. Pelo mesmo motivo,
 * `top_individual_score` da empresa de origem não é reduzido de propósito
 * quando a partida corrigida NÃO era necessariamente o topo — recalcular o
 * máximo exigiria varrer todas as partidas daquela empresa, custoso demais
 * para uma correção em segundo plano; ficar com um teto levemente otimista
 * (nunca abaixo do real) é o erro mais seguro dos dois.
 */
export async function correctMatchCompany(
  db: Firestore,
  matchId: string,
  newCompany: string,
  newConfidence: number
): Promise<void> {
  await db.runTransaction(async (tx) => {
    const matchRef = db.collection('matches').doc(matchId);
    const matchSnap = await tx.get(matchRef);
    if (!matchSnap.exists) return;

    const match = matchSnap.data() as MatchDocument;
    // Revisão final Fase C — Importante 6: uma partida anulada (`patchMatch`, Tarefa C7) nunca
    // pode voltar a somar em nenhum agregado. Hoje `needs_company_review` não é setado por
    // nenhum caminho real (Spec 11 §4.11), então este `if` é preventivo — mas o dia em que
    // §4.11 for corrigido e as duas coisas puderem coexistir na mesma partida, sem esta
    // checagem uma varredura de canonicalização desfaria silenciosamente a anulação de um
    // operador, somando de volta o `final_score` de uma partida que ele explicitamente excluiu.
    if (match.voided) return;
    if (!match.needs_company_review) return; // já resolvida por outra varredura — idempotente

    const oldCompany = match.company_canonical;

    if (oldCompany === newCompany) {
      // O palpite local já estava certo — só confirma e limpa a marca, sem tocar em agregado.
      tx.update(matchRef, { company_confidence: newConfidence, needs_company_review: FieldValue.delete() });
      return;
    }

    const oldCompanyRef = db.collection('company_rankings').doc(oldCompany);
    const newCompanyRef = db.collection('company_rankings').doc(newCompany);
    const pilotRef = db.collection('pilots').doc(match.pilot_id);
    const [oldSnap, newSnap, pilotSnap] = await Promise.all([
      tx.get(oldCompanyRef),
      tx.get(newCompanyRef),
      tx.get(pilotRef)
    ]);

    const oldData = oldSnap.data() as CompanyRankingDocument | undefined;
    const newData = newSnap.data() as CompanyRankingDocument | undefined;
    const pilot = pilotSnap.data() as { company_canonical?: string } | undefined;

    // Ver limitação documentada acima.
    const pilotStillPointsAtOldCompany = pilot?.company_canonical === oldCompany;

    if (oldData) {
      tx.set(oldCompanyRef, {
        ...oldData,
        total_score: Math.max(0, oldData.total_score - match.final_score),
        pilots_count: pilotStillPointsAtOldCompany ? Math.max(0, oldData.pilots_count - 1) : oldData.pilots_count,
        last_updated: FieldValue.serverTimestamp()
      });
    }

    tx.set(newCompanyRef, {
      // Importante 6: a constante, não `match.schema_version` — uma partida legada sem esse
      // campo faria isto gravar `undefined`, que o Admin SDK rejeita, e todo o resto do
      // código (`ingest.ts`, `admin.ts`) já escreve agregados usando esta mesma constante.
      schema_version: SCHEMA_VERSION,
      company_canonical: newCompany,
      total_score: (newData?.total_score ?? 0) + match.final_score,
      pilots_count: (newData?.pilots_count ?? 0) + (pilotStillPointsAtOldCompany ? 1 : 0),
      top_individual_score: Math.max(match.final_score, newData?.top_individual_score ?? 0),
      last_updated: FieldValue.serverTimestamp()
    });

    if (pilotStillPointsAtOldCompany && pilot) {
      tx.set(pilotRef, { ...pilot, company_canonical: newCompany }, { merge: true });
    }

    tx.update(matchRef, {
      company_canonical: newCompany,
      company_confidence: newConfidence,
      needs_company_review: FieldValue.delete()
    });

    // Spec 05 §3.1: o alias resolvido é servido por GET /v1/aliases para o daemon cachear
    // localmente em company_aliases — é isso que faz o PRÓXIMO visitante da mesma empresa
    // resolver em 1ms, local, sem rede.
    tx.set(db.collection('company_aliases').doc(), {
      raw: match.company_raw,
      canonical: newCompany,
      resolved_at: FieldValue.serverTimestamp()
    });
  });
}

/**
 * Varredura completa: busca partidas marcadas, resolve contra o modelo, e aplica
 * a correção só onde a confiança supera o limiar. Chamada sem `await` no fim de
 * `ingestBatch` — nunca no caminho de resposta de `POST /v1/matches`.
 */
export async function runCanonicalizationSweep(
  db: Firestore,
  generate: GenerateFn,
  catalog: string[],
  threshold: number = CANONICALIZE_CONFIDENCE_THRESHOLD
): Promise<void> {
  const flagged = await db
    .collection('matches')
    .where('needs_company_review', '==', true)
    .limit(CANONICALIZE_SWEEP_LIMIT)
    .get();
  if (flagged.empty) return;

  const items: CanonicalizeRequestItem[] = flagged.docs.map((d) => {
    const m = d.data() as MatchDocument;
    return { match_id: m.match_id, company_raw: m.company_raw, local_guess: m.company_canonical };
  });

  const resolved = await resolveCompanies(items, generate, catalog);

  for (const r of resolved) {
    if (r.confidence < threshold) continue;
    await correctMatchCompany(db, r.match_id, r.company_canonical, r.confidence);
  }
}

/** `GET /v1/aliases?since=<iso>` — aliases resolvidos depois de `sinceIso`, mais antigos primeiro. */
export async function listAliasesSince(db: Firestore, sinceIso: string): Promise<ResolvedAlias[]> {
  const since = new Date(sinceIso);
  const snap = await db
    .collection('company_aliases')
    .where('resolved_at', '>=', since)
    .orderBy('resolved_at', 'asc')
    .get();

  return snap.docs.map((d) => {
    const data = d.data() as { raw: string; canonical: string; resolved_at: FirebaseFirestore.Timestamp };
    return {
      raw: data.raw,
      canonical: data.canonical,
      resolved_at: data.resolved_at.toDate().toISOString()
    };
  });
}
