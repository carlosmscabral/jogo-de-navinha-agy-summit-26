/**
 * Bootstrap do serviço Cloud Run — Spec 08 §6. A máquina do estande nunca fala com o
 * Firestore diretamente; este processo é o único lugar onde a credencial privilegiada
 * (a identidade da service account do Cloud Run, sem arquivo de chave) existe.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { DATABASE_ID, type MatchDocument } from '@jogo/shared';
import { isAuthorized } from './auth.js';
import { ingestBatch } from './ingest.js';
import {
  patchMatch,
  listMatches,
  getCompanyCatalog,
  putCompanyCatalog,
  getHealthReport,
  type MatchCorrection
} from './admin.js';
import { moderateCallsign, generateWithVertex as moderateWithVertex } from './moderation-l2.js';
import {
  resolveCompanies,
  runCanonicalizationSweep,
  listAliasesSince,
  loadCompanyCatalog,
  generateWithVertex as canonicalizeWithVertex,
  type CanonicalizeRequestItem
} from './canonicalize.js';

/** POST /v1/matches aceita no máximo isso por chamada (Spec 08 §6.1). */
const MAX_BATCH_SIZE = 50;

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const BOOTH_INGEST_TOKEN = process.env.BOOTH_INGEST_TOKEN;

// Tarefa C4 — moderação de camada 2 (bloqueante) e canonicalização (assíncrona). Ver
// vertex.ts para a pesquisa de parâmetros do Passo 1 e moderation-l2.ts/canonicalize.ts
// para a distinção fail-closed vs fail-open que rege este arquivo.
const MODERATION_L2_TIMEOUT_MS = Number(process.env.MODERATION_L2_TIMEOUT_MS) || 1500;
const COMPANY_CATALOG = loadCompanyCatalog();

// Sem argumentos: usa Application Default Credentials. No Cloud Run isso é a identidade
// da service account do serviço; não existe (nem deve existir) arquivo de chave aqui.
const firebaseApp = initializeApp();
const db = getFirestore(firebaseApp, DATABASE_ID);

export const app = express();
app.use(express.json({ limit: '2mb' }));

// GET /v1/health fica fora da autenticação: é o endpoint que o self_test.sh (Tarefa D3)
// bate para checar se o serviço subiu, antes de haver qualquer token para apresentar.
app.get('/v1/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });
});

// Tarefa C7 — /v1/admin/*. Este bloco fica ANTES do middleware do token de ingestão (logo
// abaixo) de propósito: o token de escopo único da Tarefa C3 vive na máquina do estande e
// não pode abrir a porta administrativa — são privilégios diferentes. Em produção, o
// Cloud Run serve /v1/admin/* atrás do Identity-Aware Proxy (configuração de deploy, ver
// README, não código aqui). Sem IAP na frente (localmente, contra o emulador), estas rotas
// ficam abertas sem nenhum token — esperado nesta camada; ver admin.ts para o resto do
// raciocínio de autenticação.
app.get('/v1/admin/matches', async (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;
  const company = typeof req.query.company === 'string' ? req.query.company : undefined;
  const limitParam = typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined;
  const matches = await listMatches(db, {
    q,
    company,
    limit: limitParam !== undefined && Number.isFinite(limitParam) ? limitParam : undefined
  });
  res.status(200).json({ matches });
});

app.patch('/v1/admin/matches/:matchId', async (req: Request, res: Response) => {
  try {
    await patchMatch(db, String(req.params.matchId), req.body as MatchCorrection);
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(/not found/i.test(message) ? 404 : 400).json({ error: message });
  }
});

app.get('/v1/admin/companies', async (_req: Request, res: Response) => {
  res.status(200).json(await getCompanyCatalog(db));
});

app.put('/v1/admin/companies', async (req: Request, res: Response) => {
  const body = req.body as { companies?: unknown };
  if (!Array.isArray(body?.companies) || body.companies.some((c) => typeof c !== 'string')) {
    res.status(400).json({ error: 'body must be { companies: string[] }' });
    return;
  }
  try {
    await putCompanyCatalog(db, body.companies as string[]);
    res.status(200).json({ status: 'ok' });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/v1/admin/health', async (_req: Request, res: Response) => {
  res.status(200).json(await getHealthReport(db));
});

// Tudo em /v1/* a partir daqui exige o token de ingestão. Um servidor que sobe sem
// BOOTH_INGEST_TOKEN configurado recusa tudo — ver auth.ts. /v1/admin/* já foi tratado
// pelas rotas acima e nunca chega até aqui.
app.use('/v1', (req: Request, res: Response, next: NextFunction) => {
  if (!isAuthorized(req.header('authorization'), BOOTH_INGEST_TOKEN)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
});

app.post('/v1/matches', async (req: Request, res: Response) => {
  const body = req.body as { matches?: unknown };
  if (!Array.isArray(body?.matches)) {
    res.status(400).json({ error: 'body must be { matches: MatchDocument[] }' });
    return;
  }
  if (body.matches.length > MAX_BATCH_SIZE) {
    res.status(400).json({ error: `batch exceeds the limit of ${MAX_BATCH_SIZE} matches` });
    return;
  }

  const result = await ingestBatch(db, body.matches as MatchDocument[], triggerCanonicalizationSweep);
  res.status(200).json(result);
});

/**
 * Gatilho da Tarefa C4, passado a `ingestBatch` — que o chama SEM `await` só quando alguma
 * partida do lote ficou marcada `needs_company_review`. `.catch` aqui é essencial: sem ele,
 * uma falha do Vertex nesta promise desanexada vira um `unhandledRejection` do processo
 * inteiro, não um erro de uma partida.
 */
function triggerCanonicalizationSweep(dbRef: FirebaseFirestore.Firestore): void {
  runCanonicalizationSweep(dbRef, canonicalizeWithVertex, COMPANY_CATALOG).catch((err) => {
    console.error('[cloud-api] canonicalization sweep failed:', err);
  });
}

app.post('/v1/moderate', async (req: Request, res: Response) => {
  const body = req.body as { callsign?: unknown };
  if (typeof body?.callsign !== 'string' || !body.callsign.trim()) {
    res.status(400).json({ error: 'body must be { callsign: string }' });
    return;
  }
  const result = await moderateCallsign(body.callsign, moderateWithVertex, MODERATION_L2_TIMEOUT_MS);
  res.status(200).json(result);
});

app.post('/v1/canonicalize', async (req: Request, res: Response) => {
  const body = req.body as { items?: unknown };
  if (!Array.isArray(body?.items)) {
    res.status(400).json({ error: 'body must be { items: Array<{match_id, company_raw, local_guess}> }' });
    return;
  }
  const resolved = await resolveCompanies(
    body.items as CanonicalizeRequestItem[],
    canonicalizeWithVertex,
    COMPANY_CATALOG
  );
  res.status(200).json({ resolved });
});

app.get('/v1/aliases', async (req: Request, res: Response) => {
  const since = typeof req.query.since === 'string' ? req.query.since : '';
  if (!since || Number.isNaN(Date.parse(since))) {
    res.status(400).json({ error: 'query param "since" must be an ISO 8601 date' });
    return;
  }
  const aliases = await listAliasesSince(db, since);
  res.status(200).json({ aliases });
});

/* c8 ignore start -- bootstrap real de processo, não exercitado por teste unitário */
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`cloud-api listening on port ${PORT}`);
  });
}
/* c8 ignore stop */
