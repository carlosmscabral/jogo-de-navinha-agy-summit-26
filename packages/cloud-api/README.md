# @jogo/cloud-api

API de ingestão em Cloud Run (Tarefa C3, Spec 08 §6). É o único ponto onde a credencial
privilegiada do Firestore existe, onde a idempotência por `match_id` é aplicada e onde os
agregados (`pilots`, `company_rankings`) são atualizados por transação. A máquina do
estande nunca fala com o Firestore diretamente — só com este serviço, via HTTPS.

## Endpoints

- `POST /v1/matches` — corpo `{ matches: MatchDocument[] }` (até 50), cabeçalho
  `Authorization: Bearer <BOOTH_INGEST_TOKEN>`. Resposta:
  `{ accepted: string[]; rejected: Array<{ match_id: string; reason: string }> }`. Ao final,
  se algum item aceito ficou marcado `needs_company_review`, dispara (sem `await`, nunca no
  caminho de resposta) a varredura de canonicalização da Tarefa C4.
- `GET /v1/health` — sem autenticação; usado pelo `self_test.sh` (Tarefa D3).
- `POST /v1/moderate` — corpo `{ callsign: string }` → `{ verdict: 'allow' | 'block'; reason?: string }`.
  Camada 2 de moderação (Tarefa C4, Spec 05 §3.2): bloqueante, falha FECHADA em qualquer dúvida
  do modelo (timeout, JSON malformado, forma inesperada).
- `POST /v1/canonicalize` — corpo `{ items: Array<{ match_id, company_raw, local_guess }> }` →
  `{ resolved: Array<{ match_id, company_canonical, confidence }> }`. Não escreve no Firestore —
  só resolve contra o modelo; quem aplica a correção é a varredura interna disparada por
  `POST /v1/matches`.
- `GET /v1/aliases?since=<ISO 8601>` — aliases de empresa resolvidos pela canonicalização desde
  `since`, para o daemon cachear localmente em `company_aliases` (Spec 05 §3.1).

### Endpoints administrativos (Tarefa C7) — `/v1/admin/*`

Servem o painel `packages/admin-app`. Ao contrário de todo o resto de `/v1/*`, estas rotas NÃO
passam pelo middleware do token de ingestão (`isAuthorized`) — ver "Autenticação do painel" abaixo
para o porquê.

- `GET /v1/admin/matches?q=&company=&limit=` — busca por callsign ou empresa (substring,
  case-insensitive) e/ou empresa exata; varre uma janela das partidas mais recentes em memória
  (Firestore não faz OR de texto entre dois campos numa consulta indexada). Resposta:
  `{ matches: MatchDocument[] }`.
- `PATCH /v1/admin/matches/{match_id}` — corpo `{ callsign?, company_canonical?, final_score?,
  voided? }`. Corrige a partida numa transação e recalcula do zero (`total_score`, `pilots_count`,
  `top_individual_score`) os agregados de toda empresa afetada — a antiga e a nova, quando a
  empresa muda. `voided: true` exclui a partida dos agregados sem apagar o documento. 404 se o
  `match_id` não existir; 400 se a correção violar a faixa plausível de score
  (`MAX_PLAUSIBLE_SCORE`, mesma de `ingest.ts`).
- `GET|PUT /v1/admin/companies` — o documento `companies/catalog`
  (`{ schema_version, companies: string[], updated_at }`). `PUT` é a única escrita deste
  catálogo pelo Firestore; `config/companies.json` do estande (Tarefa C0b) continua sendo a fonte
  local e offline, e a reconciliação entre os dois é manual (botão "exportar para o estande" no
  painel, puramente client-side).
- `GET /v1/admin/health` — fila de sync por estação, rejeições recentes e taxa de preset de
  emergência. Limitação aceita e documentada no relatório da Tarefa C7: só a taxa de preset de
  emergência é calculada de verdade (a partir de `telemetry.fallback_used` em `matches`); a fila
  de sync por estação e as rejeições recentes não têm hoje nenhum registro do lado do Firestore
  (`CloudSyncService.status()` da Tarefa C5 é estado em processo de cada daemon, nunca reportado
  à nuvem; `ingestBatch`'s `rejected[]` volta síncrono na resposta HTTP e não é persistido) — o
  endpoint devolve listas vazias com uma nota explicando isso, em vez de inventar dado.

### Autenticação do painel de admin (Tarefa C7): IAP, não um token de aplicação

`/admin` (o `admin-app` compilado) e `/v1/admin/*` (acima) devem ficar, em produção, atrás do
**Identity-Aware Proxy** do Cloud Run — não atrás de uma senha em variável de ambiente. O painel
escreve no banco de produção durante um evento público, com o navegador aberto no estande; uma
senha digitada ali é a solução que vaza. IAP autentica com a conta Google de quem opera, sem
nenhum segredo novo no sistema, e é configuração de deploy, não código.

O `BOOTH_INGEST_TOKEN` da Tarefa C3 **não serve para isto**: é um token de escopo único que vive
na máquina do estande — exatamente a máquina que não pode ter privilégio administrativo. Por isso
as rotas `/v1/admin/*` são montadas em `index.ts` ANTES do middleware que checa esse token, e
nunca o exigem.

Consequência para desenvolvimento local: sem IAP na frente (rodando contra o emulador, como nos
testes deste pacote), `/v1/admin/*` fica **sem nenhuma autenticação própria**. Isso é esperado
nesta camada — o código não tenta reimplementar o que o IAP resolve — mas significa que este
serviço nunca deve ser exposto publicamente sem o IAP configurado na frente dele.

## Variáveis de ambiente

Ver `.env.example`. Em produção, `BOOTH_INGEST_TOKEN` vem do Secret Manager (nunca de um
arquivo commitado); `PORT` é injetada pelo Cloud Run. Desde a Tarefa C4: `GOOGLE_CLOUD_PROJECT`
(obrigatória só na primeira chamada real ao Vertex — nunca nos testes, que injetam `generate`),
`VERTEX_LOCATION` (default `global` — é a única região que serve `gemini-3.7-flash` hoje) e
`MODERATION_L2_TIMEOUT_MS` (default `1500`).

## Testes locais

```bash
npx firebase emulators:start --only firestore
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run test --workspace=packages/cloud-api
```

`ingest.test.ts` e `canonicalize.test.ts` compartilham o mesmo projeto/banco do emulador via
`test-helpers.ts` (`testDb`/`clearFirestore`) — por isso o script `test` roda os arquivos com
`--test-concurrency=1`: em paralelo, um `clearFirestore()` de um arquivo apaga dados que o outro
ainda estava verificando, e os agregados de `company_rankings` saem errados de forma
intermitente. `moderation-l2.test.ts` não precisa do emulador (o `generate` é sempre injetado).

## Build para deploy (monorepo)

O contexto do build do Docker é `packages/cloud-api` (o comando de deploy abaixo usa
`--source packages/cloud-api`), então o pacote irmão `@jogo/shared` — resolvido em
desenvolvimento via workspace do npm — não está visível para o Docker. Antes de gerar a
imagem (local ou via `gcloud run deploy`), materialize uma cópia local do `dist` já
compilado de `@jogo/shared`:

```bash
npm run build --workspace=packages/shared
npm run vendor:shared --workspace=packages/cloud-api
```

Isso escreve em `packages/cloud-api/vendor/jogo-shared/` (gitignored, regenerado a cada
build) o material que o `Dockerfile` injeta em `node_modules/@jogo/shared` durante a
imagem — ver os comentários no `Dockerfile` para o porquê disso e por que `ajv`,
`ajv-formats` e `zod` também estão em `dependencies` deste pacote.

## Deploy

Sem nenhuma chave de credencial: o Cloud Run usa a identidade da própria service account,
e o token de ingestão vive no Secret Manager.

```bash
gcloud run deploy jogo-navinha-api \
  --source packages/cloud-api \
  --region southamerica-east1 \
  --service-account jogo-navinha-api@PROJETO.iam.gserviceaccount.com \
  --set-secrets BOOTH_INGEST_TOKEN=booth-ingest-token:latest \
  --no-allow-unauthenticated=false
```

A service account precisa de `roles/datastore.user` e, a partir da Tarefa C4,
`roles/aiplatform.user`. **Nenhum arquivo de chave é gerado.**

### Topologia pretendida para `/admin` (Tarefa C7)

O brief pede que `packages/admin-app` compilado seja servido pelo MESMO serviço Cloud Run desta
API, sob `/admin`, atrás do IAP — um serviço a menos para provisionar, e o IAP protege a rota
inteira de uma vez. Este `Dockerfile`/`index.ts` **ainda não fazem isso**: o arquivo lista só
`packages/admin-app`, `packages/cloud-api/src/*`, `firestore.rules` e
`packages/shared/src/types/cloud.ts` como escopo desta tarefa, e não inclui o `Dockerfile`. Servir
os estáticos do `admin-app` (build multi-stage incluindo `packages/admin-app/dist` no contexto,
mais um `express.static('/admin', ...)` em `index.ts`) fica registrado aqui como o próximo passo
concreto de deploy, não implementado nesta tarefa.
