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

/** POST /v1/matches aceita no máximo isso por chamada (Spec 08 §6.1). */
const MAX_BATCH_SIZE = 50;

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const BOOTH_INGEST_TOKEN = process.env.BOOTH_INGEST_TOKEN;

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

// Tudo em /v1/* a partir daqui exige o token de ingestão. Um servidor que sobe sem
// BOOTH_INGEST_TOKEN configurado recusa tudo — ver auth.ts.
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

  const result = await ingestBatch(db, body.matches as MatchDocument[]);
  res.status(200).json(result);
});

/* c8 ignore start -- bootstrap real de processo, não exercitado por teste unitário */
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`cloud-api listening on port ${PORT}`);
  });
}
/* c8 ignore stop */
