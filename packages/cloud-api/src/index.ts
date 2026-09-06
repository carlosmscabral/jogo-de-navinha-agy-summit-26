/**
 * Bootstrap do serviço Cloud Run — Spec 08 §6. A máquina do estande nunca fala com o
 * Firestore diretamente; este processo é o único lugar onde a credencial privilegiada
 * (a identidade da service account do Cloud Run, sem arquivo de chave) existe.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { DATABASE_ID, type MatchDocument } from '@jogo/shared';
import { isAuthorized } from './auth.js';
import { generateShipCard, matchIdFromSubject } from './cardgen.js';
import { isAdminAuthorized } from './admin-auth.js';
import { ingestBatch } from './ingest.js';
import {
  patchMatch,
  bulkPatchOrDelete,
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
const ADMIN_PANEL_PASSWORD = process.env.ADMIN_PANEL_PASSWORD;

// Tarefa C4 — moderação de camada 2 (bloqueante) e canonicalização (assíncrona). Ver
// vertex.ts para a pesquisa de parâmetros do Passo 1 e moderation-l2.ts/canonicalize.ts
// para a distinção fail-closed vs fail-open que rege este arquivo.
// O default era 1500ms e era curto demais: medido ao vivo no Gate M3 (2026-08-24), um POST
// /v1/moderate contra o projeto real devolveu "não respondeu a tempo" em 1.6s — o gemini-3.7-flash
// no endpoint `global` não cabe em 1,5s saindo de southamerica-east1, nem com thinkingLevel 'low'.
// O efeito era pior que lentidão: TODA moderação semântica do evento caía no fail-closed por
// timeout, sem o modelo ter opinado uma única vez.
//
// O custo de errar para baixo é assimétrico: estourar o teto aqui é fail-closed, ou seja, um
// visitante INOCENTE perde o codinome. Um teto largo só é pago no caso raro; um teto curto é pago
// por quem não fez nada. Este valor tem que ser MENOR que o do daemon
// (BOOTH_MODERATION_L2_TIMEOUT_MS, hoje 25000) — ver o comentário em packages/daemon/src/index.ts.
//
// A escala mudou duas vezes em 2026-08-24, e o segundo motivo é o interessante. Primeiro 8000,
// escolhido quando o visitante ESPERAVA por esta resposta na tela de cadastro: ali o teto era um
// orçamento de paciência, e uma bateria de 100 callsigns confirmou que 8s cobria 96% dos casos.
// Depois 20000, quando a moderação saiu do caminho crítico do visitante
// (packages/daemon/src/services/pending-moderation.ts) e o teto deixou de ser pago por alguém
// olhando a tela. O que decidiu o número novo foi o log de resposta tardia introduzido logo
// abaixo: as chamadas que o teto de 8s abandonava terminavam BEM, em 8,3s / 11,5s / 14,8s /
// 16,2s / 47,8s / 78,0s. Com 20s, as quatro primeiras viram veredito de verdade em vez de
// fail-closed por lentidão. As duas últimas continuam estourando, e tudo bem: são SIEG_HEIL e
// VOLKISCH, cujo desfecho correto é bloqueio de qualquer forma.
//
// Detalhe que os números acima revelam e que vale ter em mente ao mexer neste valor: a latência
// acompanha o quanto a ENTRADA é ofensiva — os dois dog-whistles nazistas foram os dois mais
// lentos por uma margem enorme. O provável mecanismo é a maquinaria de segurança do próprio
// Vertex reagindo ao conteúdo do prompt, que por definição carrega o texto ofensivo. Ou seja: o
// serviço fica mais lento exatamente nos casos em que mais precisamos dele, e é por isso que o
// fail-closed neste teto é a política certa.
const MODERATION_L2_TIMEOUT_MS = Number(process.env.MODERATION_L2_TIMEOUT_MS) || 20_000;
const COMPANY_CATALOG = loadCompanyCatalog();

// Revisão final Fase C — Crítico 4: falhar JÁ NA SUBIDA, não só na primeira chamada real de
// moderação, quando falta a variável de que `vertex.ts` depende (`requireEnv('GOOGLE_CLOUD_PROJECT')`).
// Sem isto, a primeira pista de que a variável está ausente seria TODO visitante do evento sendo
// recusado com `block` — `moderation-l2.ts` agora distingue "infraestrutura quebrada" (`unavailable`,
// fail-open no daemon) de "o modelo respondeu em dúvida" (`block`, fail-closed de verdade), mas um
// serviço que nunca sobe corretamente é preferível a um que sobe e falha fechado silenciosamente
// para todo mundo. `NODE_ENV !== 'test'` mesma guarda que o bloco de `app.listen` mais abaixo usa;
// nenhum teste deste pacote importa este módulo, então isto nunca roda em `npm test`.
if (process.env.NODE_ENV !== 'test' && !process.env.GOOGLE_CLOUD_PROJECT) {
  console.error(
    '[cloud-api] GOOGLE_CLOUD_PROJECT is not set. Layer-2 moderation and canonicalization ' +
      '(Vertex AI, Task C4) will fail for EVERY visitor as soon as the first registration ' +
      'comes in. Configure the variable before starting the service — see .env.example and ' +
      'the README ("Variáveis de ambiente" section).'
  );
  process.exit(1);
}

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

// --- Serviço `cardgen` (Tarefa 3): mesma imagem, papel diferente ---
// O gatilho Eventarc de `matches/{matchId}` chama `POST /internal/cardgen` no serviço Cloud Run
// `jogo-navinha-cardgen`, que roda ESTA imagem com `CARDGEN_ENABLED=1`. A flag é a única coisa
// que separa os dois serviços, então ela também é a fronteira de segurança: ligada, este processo
// monta APENAS `/v1/health` (acima) e `/internal/cardgen` — nada de `/v1/matches`, nada de
// `/v1/admin/*`, nada do bundle estático do painel. O serviço `cardgen` sobe com
// `--no-allow-unauthenticated` e só a service account do gatilho tem `run.invoker`, então nada
// mais o alcança de qualquer forma; mas uma imagem que carrega o painel DESMONTADO é melhor que
// uma que o carrega montado atrás de uma senha.
//
// Nada disto está no caminho síncrono de `POST /v1/matches`: o estande considera a partida
// sincronizada quando a ingestão responde, e o cartão chega depois, sem ninguém esperando.
if (process.env.CARDGEN_ENABLED === '1') {
  // O Eventarc/Pub/Sub REENTREGA qualquer resposta que não seja 2xx. Por isso só erro
  // TRANSIENTE (Firestore fora do ar) devolve 500: tudo que é permanente — subject malformado,
  // documento apagado entre o evento e a leitura, spec sem `visuals` — sai 204 e encerra a
  // entrega, senão o evento fica girando para sempre sem chance de sucesso.
  app.post('/internal/cardgen', async (req: Request, res: Response) => {
    const matchId = matchIdFromSubject(req.header('ce-subject'));
    if (!matchId) {
      console.warn(
        '[cardgen] ce-subject ausente ou fora do formato "documents/matches/{matchId}": ' +
          `${JSON.stringify(req.header('ce-subject'))}. Cabeçalhos ce-*: ` +
          JSON.stringify(
            Object.fromEntries(
              Object.entries(req.headers).filter(([k]) => k.startsWith('ce-'))
            )
          )
      );
      res.status(204).end();
      return;
    }

    try {
      const outcome = await generateShipCard(db, matchId);
      if (outcome === 'written' || outcome === 'up_to_date') {
        console.log(`[cardgen] ${matchId}: ${outcome}`);
        res.status(200).json({ match_id: matchId, outcome });
        return;
      }
      console.warn(`[cardgen] ${matchId}: ${outcome} — falha permanente, não reentregar.`);
      res.status(204).end();
    } catch (err) {
      // Transiente por eliminação: as falhas permanentes já saíram acima. Queremos a retentativa.
      console.error(`[cardgen] ${matchId}: falha ao gravar o cartão:`, err);
      res.status(500).json({ error: 'cardgen failed' });
    }
  });
} else {
  // Tarefa C10 — senha do painel. Esta senha HTTP Basic (ver admin-auth.ts) é a ÚNICA camada de
  // autenticação do painel, tanto para as rotas abaixo quanto para o bloco estático de /admin mais
  // adiante neste arquivo. 401 com WWW-Authenticate para o navegador mostrar o prompt nativo.
  //
  // NÃO há IAP nesta topologia, e não é por preferência: o IAP do Cloud Run protege o SERVIÇO
  // inteiro, não um caminho. Não existe configuração que exija identidade Google em /v1/admin/*
  // e ainda deixe /v1/matches acessível ao estande, que só tem um token Bearer, no mesmo serviço.
  // Verificado ao vivo no Gate M3 (2026-08-24): com `--no-allow-unauthenticated`, o IAM da própria
  // plataforma devolvia 403 antes de qualquer código nosso rodar, inclusive para requisições com a
  // senha correta. Uma segunda camada de identidade Google exigiria um serviço Cloud Run separado
  // só para o painel — questão de arquitetura em aberto, não flag de deploy. `deploy.sh --with-iap`
  // recusa com essa explicação. Ver packages/cloud-api/README.md, "Autenticação do painel de admin".
  function requireAdminAuth(req: Request, res: Response, next: NextFunction): void {
    if (!isAdminAuthorized(req.header('authorization'), ADMIN_PANEL_PASSWORD)) {
      res.status(401).set('WWW-Authenticate', 'Basic realm="admin"').json({ error: 'unauthorized' });
      return;
    }
    next();
  }

  // Tarefa C7 — /v1/admin/*. Este bloco fica ANTES do middleware do token de ingestão (logo
  // abaixo) de propósito: o token de escopo único da Tarefa C3 vive na máquina do estande e
  // não pode abrir a porta administrativa — são privilégios diferentes. Em produção, o
  // Cloud Run serve /v1/admin/* atrás do Identity-Aware Proxy (configuração de deploy, ver
  // README, não código aqui). Sem IAP na frente (localmente, contra o emulador), estas rotas
  // dependiam só do IAP e ficavam sem nenhuma autenticação própria — por isso a Tarefa C10
  // acrescenta `requireAdminAuth` logo abaixo, cobrindo todo `/v1/admin/*` de uma vez via
  // `app.use`, antes de qualquer rota individual. Ver admin.ts para o resto do raciocínio de
  // autorização (não autenticação) destas rotas.
  app.use('/v1/admin', requireAdminAuth);

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

  // Tarefa C9 — ações em lote (anular ou apagar de verdade) para limpeza de dados de teste
  // no painel, sem travar o lote inteiro por causa de um `match_id` problemático. Mesmo
  // espírito de partial-failure de `POST /v1/matches` (`ingest.ts`) — ver `bulkPatchOrDelete`
  // em `admin.ts` para o loop item a item.
  app.post('/v1/admin/matches/bulk', async (req: Request, res: Response) => {
    const body = req.body as { match_ids?: unknown; action?: unknown };
    if (!Array.isArray(body?.match_ids) || body.match_ids.length === 0 || body.match_ids.some((id) => typeof id !== 'string')) {
      res.status(400).json({ error: 'body must be { match_ids: string[]; action: "void" | "delete" }' });
      return;
    }
    if (body.action !== 'void' && body.action !== 'delete') {
      res.status(400).json({ error: 'action must be "void" or "delete"' });
      return;
    }
    const result = await bulkPatchOrDelete(db, body.match_ids as string[], body.action);
    res.status(200).json(result);
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
    // A latência é o dado de operação que faltava no Gate M3: sem ela, um teto curto demais é
    // indistinguível de um modelo que reprova todo mundo — os dois aparecem como `block`. Com o
    // número no log do Cloud Run dá para ver, no meio do evento, se o teto acima ainda tem folga.
    const startedAt = Date.now();
    const result = await moderateCallsign(
      body.callsign,
      moderateWithVertex,
      MODERATION_L2_TIMEOUT_MS,
      // Só dispara quando o teto vence. Este log é o que responde, no meio do evento, se os
      // estouros são teto curto ou chamada travada — sem ele os dois são a mesma linha.
      (late) => {
        void late.settle.then(({ ms, settled, detail }) => {
          console.warn(
            `[cloud-api] moderate: ESTOURO do teto (${late.timeoutMs}ms) em "${late.callsign}" — ` +
            `a chamada abandonada terminou em ${ms}ms com "${settled}"${detail ? `: ${detail}` : ''}. ` +
            'Se este número ficar logo acima do teto, o teto está curto; se for muito maior ou ' +
            '"error", o problema é a chamada, e aumentar o teto não resolve.'
          );
        });
      }
    );
    console.log(
      `[cloud-api] moderate: verdict=${result.verdict} em ${Date.now() - startedAt}ms ` +
      `(teto ${MODERATION_L2_TIMEOUT_MS}ms)`
    );
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

  // --- Estáticos do admin-app (Tarefa C7, Passo 5 do brief) ---
  // "Servir o admin-app pelo MESMO container Cloud Run da API, sob /admin, atrás do IAP.
  // Um serviço a menos para provisionar, e o IAP protege a rota inteira de uma vez." O IAP em
  // si é configuração de deploy (ver README, seção de autenticação) — este bloco só serve os
  // estáticos já compilados, mesmo padrão de `packages/daemon/src/index.ts` para o player-app
  // (Spec 08 §5): `express.static` para os arquivos com hash (JS/CSS), e uma rota de fallback
  // de SPA para qualquer outra coisa sob `/admin` que não seja um arquivo estático conhecido.
  // A checagem por `/admin` explícito (não um catch-all de toda a origem) garante que isto
  // nunca compete com nenhuma rota de `/v1/*` acima, em nenhuma ordem de registro.
  // Default funciona sem nenhuma variável de ambiente em dev local (monorepo: dist/ está em
  // packages/cloud-api/dist, então '../../admin-app/dist' é packages/admin-app/dist). No
  // container Docker o Dockerfile define ADMIN_APP_DIST=/app/admin-app-dist explicitamente,
  // porque lá o build do admin-app chega vendorizado (vendor/admin-app-dist), não no mesmo
  // layout relativo do monorepo — ver Dockerfile e README ("vendor:admin-app").
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const adminAppDist = process.env.ADMIN_APP_DIST || path.resolve(__dirname, '../../admin-app/dist');

  const adminAppIndexHtml = path.join(adminAppDist, 'index.html');

  if (fs.existsSync(adminAppIndexHtml)) {
    // Tarefa C10 — mesma senha de `/v1/admin/*` acima, aplicada ANTES do `express.static`:
    // sem isto, o painel serviria o bundle HTML/JS/CSS sem senha nenhuma e só a API ficaria
    // protegida. `requireAdminAuth` cobre este `app.use` e o fallback de SPA logo abaixo, já
    // que ambos são registrados depois dele para o mesmo prefixo `/admin`.
    app.use('/admin', requireAdminAuth);
    app.use('/admin', express.static(adminAppDist));
    // Fallback de SPA: qualquer coisa sob /admin que o `express.static` acima não achou como
    // arquivo (isto é, qualquer coisa que não seja um asset com hash) devolve o mesmo
    // index.html. `res.type(...).send(...)` em vez de `res.sendFile` — mais simples de
    // raciocinar entre versões do Express do que a validação de caminho absoluto do `sendFile`.
    app.get(/^\/admin(\/.*)?$/, (_req: Request, res: Response) => {
      res.type('html').send(fs.readFileSync(adminAppIndexHtml, 'utf8'));
    });
    console.log(`[cloud-api] Serving admin-app from ${adminAppDist}`);
  } else {
    console.warn(
      `[cloud-api] admin-app build not found at ${adminAppDist}. ` +
        'Run "npm run build --workspace=packages/admin-app" before deploying.'
    );
  }
}

/* c8 ignore start -- bootstrap real de processo, não exercitado por teste unitário */
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`cloud-api listening on port ${PORT}`);
  });
}
/* c8 ignore stop */
