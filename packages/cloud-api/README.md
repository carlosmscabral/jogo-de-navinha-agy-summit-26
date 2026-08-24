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
- `POST /v1/moderate` — corpo `{ callsign: string }` →
  `{ verdict: 'allow' | 'block' | 'unavailable'; reason?: string }`. Camada 2 de moderação
  (Tarefa C4, Spec 05 §3.2): bloqueante, falha FECHADA (`block`) em qualquer dúvida do modelo
  (timeout, JSON malformado, forma inesperada). Revisão final Fase C (Crítico 4): `unavailable`
  é um terceiro veredito, distinto de `block` — cobre erro de infraestrutura/config (Vertex
  inalcançável, `GOOGLE_CLOUD_PROJECT` ausente, IAM, cota) em que a chamada NUNCA chegou a um
  julgamento do modelo. O daemon (`remote-moderation.ts`) já trata qualquer veredito fora de
  `allow`/`block` como "moderação indisponível" e segue com fail-open (camada 1 local basta).
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
- `POST /v1/admin/matches/bulk` (Tarefa C9) — corpo `{ match_ids: string[]; action: 'void' | 'delete'
  }`. Aplica `action` a cada `match_id` do lote, um de cada vez, isolando falhas por item (mesmo
  espírito de `ingestBatch`). Resposta `{ succeeded: string[]; failed: Array<{ match_id: string;
  reason: string }> }`. `action: 'void'` reusa `patchMatch({ voided: true })` — não-destrutivo, o
  documento continua existindo. **`action: 'delete'` é irreversível**: apaga de verdade o documento
  em `matches/{id}` (`tx.delete`) e recalcula do zero os agregados de `company_rankings` e `pilots`
  afetados, ao contrário de anular. Existe para limpar dados de teste (placares inconsistentes,
  empresas fictícias) sem deixá-los acumulados como "ANULADA" para sempre — não use em partidas de
  um evento real.
- `GET /v1/admin/health` — fila de sync por estação, rejeições recentes e taxa de preset de
  emergência. Limitação aceita e documentada no relatório da Tarefa C7: só a taxa de preset de
  emergência é calculada de verdade (a partir de `telemetry.fallback_used` em `matches`); a fila
  de sync por estação e as rejeições recentes não têm hoje nenhum registro do lado do Firestore
  (`CloudSyncService.status()` da Tarefa C5 é estado em processo de cada daemon, nunca reportado
  à nuvem; `ingestBatch`'s `rejected[]` volta síncrono na resposta HTTP e não é persistido) — o
  endpoint devolve listas vazias com uma nota explicando isso, em vez de inventar dado.

### Autenticação do painel de admin (Tarefas C7 e C10): IAP e senha HTTP Basic, um serviço só

`/admin` (o `admin-app` compilado) e `/v1/admin/*` (acima) devem ficar, em produção, atrás do
**Identity-Aware Proxy** do Cloud Run, configuração de deploy, não código — ver "Deploy" abaixo.
IAP autentica com a conta Google de quem opera, sem nenhum segredo novo no sistema.

O `BOOTH_INGEST_TOKEN` da Tarefa C3 **não serve para isto**: é um token de escopo único que vive
na máquina do estande — exatamente a máquina que não pode ter privilégio administrativo. Por isso
as rotas `/v1/admin/*` são montadas em `index.ts` ANTES do middleware que checa esse token, e
nunca o exigem.

Revisão final Fase C, achado crítico: `/v1/admin/*` não tinha nenhuma autenticação própria em
código, e IAP sozinho não convive bem com o token do estande no mesmo serviço Cloud Run (o IAP
intercepta toda a origem, inclusive `POST /v1/matches`, que a máquina do estande precisa alcançar
sem uma identidade Google). Decisão da Tarefa C10: manter **um serviço só** (nenhum serviço novo
para provisionar), IAP continua protegendo por identidade Google, e uma senha HTTP Basic simples
entra em código por cima, cobrindo tanto `/v1/admin/*` quanto o bloco estático de `/admin` —
`isAdminAuthorized` (`src/admin-auth.ts`), mesmo padrão de comparação em tempo constante de
`isAuthorized`, sem sessão, sem cookie, sem dependência nova. O navegador mostra o prompt nativo
de login sozinho; nenhuma mudança foi necessária no `admin-app` para isso (Basic Auth é resolvido
pelo navegador, que reenvia a credencial automaticamente depois do primeiro prompt).

Consequência para desenvolvimento local: sem IAP na frente (rodando contra o emulador, como nos
testes deste pacote), `/v1/admin/*` e `/admin` agora exigem `ADMIN_PANEL_PASSWORD` mesmo assim —
um servidor que sobe sem essa variável recusa toda requisição administrativa, mesmo padrão de
`isAuthorized`/`BOOTH_INGEST_TOKEN`. Isso é intencional: a senha não depende do IAP estar presente,
mas o serviço ainda nunca deve ser exposto publicamente sem o IAP configurado na frente dele — a
senha é uma segunda camada, não um substituto.

## Variáveis de ambiente

Ver `.env.example`. Em produção, `BOOTH_INGEST_TOKEN` vem do Secret Manager (nunca de um
arquivo commitado); `PORT` é injetada pelo Cloud Run. Desde a Tarefa C4: `GOOGLE_CLOUD_PROJECT`
(revisão final Fase C — Crítico 4: o servidor agora recusa subir sem isto configurado, fora de
`NODE_ENV=test` — falhar já na subida é preferível a descobrir a ausência da variável só quando
todo visitante do evento começa a ser recusado pela moderação), `VERTEX_LOCATION` (default
`global` — é a única região que serve `gemini-3.7-flash` hoje) e `MODERATION_L2_TIMEOUT_MS`
(default `1500`). Desde a Tarefa C10: `ADMIN_PANEL_PASSWORD`, também do Secret Manager em
produção — ver "Autenticação do painel de admin" acima.

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
`--source packages/cloud-api`), então os pacotes irmãos `@jogo/shared` e `@jogo/admin-app`
— resolvidos em desenvolvimento via workspace do npm — não estão visíveis para o Docker.
Antes de gerar a imagem (local ou via `gcloud run deploy`), materialize uma cópia local do
`dist` já compilado dos dois:

```bash
npm run build --workspace=packages/shared
npm run build --workspace=packages/admin-app
npm run vendor --workspace=packages/cloud-api
```

`npm run vendor` roda `vendor:shared` e depois `vendor:admin-app` (rodáveis também em
separado). Isso escreve em `packages/cloud-api/vendor/jogo-shared/` e
`packages/cloud-api/vendor/admin-app-dist/` (ambos gitignored, regenerados a cada build) o
material que o `Dockerfile` injeta na imagem: `jogo-shared/` vira
`node_modules/@jogo/shared` (ver os comentários no `Dockerfile` para o porquê disso e por
que `ajv`, `ajv-formats` e `zod` também estão em `dependencies` deste pacote);
`admin-app-dist/` vira `/app/admin-app-dist`, o diretório que `ADMIN_APP_DIST` (definida
pelo próprio `Dockerfile`) diz a `src/index.ts` para servir sob `/admin` — ver "Topologia de
`/admin`" abaixo. `admin-app/dist` já é build final (HTML/JS/CSS estáticos via `vite build`),
não código-fonte: o Docker só o copia, nunca o recompila.

## Deploy

Sem nenhuma chave de credencial: o Cloud Run usa a identidade da própria service account,
e o token de ingestão e a senha do painel vivem no Secret Manager — nunca em texto puro no
comando de deploy.

**Provisionamento completo, scriptado (2026-08-24):** `npm run deploy:gcp` (raiz do monorepo)
faz todos os passos abaixo do zero — habilita as APIs, cria o banco Firestore nomeado, publica
regras/índices, cria a service account e os segredos (gerando valores aleatórios na primeira
vez), builda e publica no Cloud Run. É idempotente: rodar de novo sobre um projeto já
provisionado só atualiza o que mudou, nunca recria ou sobrescreve um segredo já existente.
Aceita `PROJECT_ID=outro-projeto npm run deploy:gcp -- --yes` para reproduzir em outro projeto
sem editar nada versionado. `npm run undeploy:gcp` desfaz (Cloud Run, segredos, service
account — nunca o banco Firestore, a menos que `--delete-database` seja passado explicitamente
e o operador digite `EXCLUIR`). Ver `scripts/deploy.sh`/`scripts/undeploy.sh` para os passos
exatos e todas as variáveis de ambiente aceitas.

O comando manual abaixo é o que `deploy.sh` roda no passo 7 (Cloud Run) — documentado aqui
porque é o passo que o script sozinho não decide por você: se rodar com `--with-iap` ou deixar
o IAP para configurar depois pelo Console (ver "Autenticação do painel de admin" acima).

```bash
gcloud run deploy jogo-navinha-api \
  --source packages/cloud-api \
  --region southamerica-east1 \
  --service-account jogo-navinha-api@PROJETO.iam.gserviceaccount.com \
  --set-secrets BOOTH_INGEST_TOKEN=booth-ingest-token:latest \
  --set-secrets ADMIN_PANEL_PASSWORD=admin-panel-password:latest \
  --set-env-vars GOOGLE_CLOUD_PROJECT=PROJETO \
  --no-allow-unauthenticated
```

A service account precisa de `roles/datastore.user` e, a partir da Tarefa C4,
`roles/aiplatform.user`, **mais `roles/secretmanager.secretAccessor` em cada um dos dois
segredos** (`booth-ingest-token`, `admin-panel-password`) — sem isso o Cloud Run recusa a
revisão com "Permission denied on secret" ao tentar montar `--set-secrets` (achado ao vivo no
primeiro deploy real, 2026-08-24; `deploy.sh` já concede isso). **Nenhum arquivo de chave é
gerado.**

### Topologia de `/admin` (Tarefa C7)

O `admin-app` compilado é servido pelo MESMO serviço Cloud Run desta API, sob `/admin` — um
serviço a menos para provisionar, e o IAP (configurado no Cloud Run, não neste repositório)
protege a rota inteira de uma vez, tanto `/admin` (a UI) quanto `/v1/admin/*` (a API que ela
consome). Implementação, em `src/index.ts`:

- `express.static(ADMIN_APP_DIST)` montado em `/admin`, para os arquivos com hash
  (JS/CSS) do build do Vite.
- Uma rota de fallback (`app.get(/^\/admin(\/.*)?$/, ...)`) que devolve o mesmo
  `index.html` para qualquer coisa sob `/admin` que não seja um arquivo estático conhecido
  — mesmo padrão que `packages/daemon/src/index.ts` usa para servir o `player-app` (Spec 08
  §5), adaptado para ler o arquivo com `fs.readFileSync` + `res.type('html').send(...)` em
  vez de `res.sendFile` (o Express 5 deste pacote, diferente do Express 4 do `daemon`,
  tornou `sendFile` mais estrito sobre a resolução do caminho; a leitura direta do arquivo
  evita essa diferença de versão).
- `ADMIN_APP_DIST` default para `../../admin-app/dist` relativo a `dist/index.js` — funciona
  sem nenhuma variável de ambiente em desenvolvimento local no monorepo. O `Dockerfile`
  sobrescreve com `ADMIN_APP_DIST=/app/admin-app-dist` porque, dentro da imagem, o build do
  `admin-app` chega vendorizado (`vendor/admin-app-dist`, ver seção anterior), não no mesmo
  layout relativo do monorepo.
- Se o build não existir no caminho resolvido (`ADMIN_APP_DIST`/index.html ausente), o
  servidor sobe normalmente e só loga um aviso — `/v1/*` continua funcionando, só `/admin`
  fica indisponível. Isso é o que acontece se alguém rodar `node dist/index.js` sem antes
  rodar `npm run build --workspace=packages/admin-app` (ou o `vendor:admin-app` do Docker).

O IAP em si continua sendo configuração de deploy, não código — ver "Autenticação do painel
de admin" acima.

### Por que este pacote usa Express 5, e o `daemon` usa Express 4

Diferença de propósito, não descuido (revisão final Fase C, Minor 10): quase toda rota deste
pacote é um `async (req, res) => { ... }` que faz `await` em Firestore/Vertex sem `try/catch`
próprio. No Express 5, uma `Promise` rejeitada dentro de um handler é encaminhada automaticamente
para o error handler — no Express 4 (a versão do `daemon`), isso exigiria um `try/catch` manual
em cada rota async, ou um wrapper, para não virar um `unhandledRejection` silencioso. Mantido
como está: os dois pacotes têm razões independentes para a versão que usam, e não há nenhum
código compartilhado entre eles que dependa de uma versão específica do Express.
