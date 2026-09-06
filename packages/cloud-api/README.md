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

- `GET /v1/admin/matches?q=&company=&limit=` — busca por callsign, empresa ou `match_id`
  (substring, case-insensitive) e/ou empresa exata; varre uma janela das partidas mais recentes
  em memória (Firestore não faz OR de texto entre campos numa consulta indexada). Um `q` que seja
  um `match_id` inteiro é resolvido também por leitura direta, porque `match_id` é o ID do
  documento — isso acha a partida mesmo quando ela já saiu da janela de varredura, que é
  justamente o caso de um ID colado de um log. Resposta: `{ matches: MatchDocument[] }`.
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

### Autenticação do painel de admin (Tarefas C7 e C10): senha HTTP Basic, sem IAP

**Corrigido ao vivo em 2026-08-24, no primeiro deploy real** — a versão anterior desta seção dizia
que o IAP protegeria o painel por cima da senha, "um serviço só". Isso está **errado**: IAP no
Cloud Run é por **serviço inteiro**, não por rota. Ligá-lo bloquearia `/v1/admin/*` **e**
`/v1/matches` juntos, porque não existe forma de isentar uma rota específica — exatamente o
problema que motivou a Tarefa C10 em primeiro lugar (a máquina do estande não tem identidade
Google, só o token Bearer da Tarefa C3). A "solução" documentada antes não resolvia esse problema,
só o escondia atrás de uma frase — descoberto quando `gcloud run deploy` real, com
`--no-allow-unauthenticated`, rejeitava com 403 **tudo**, inclusive requisições com a senha certa,
porque a checagem da plataforma acontece antes do código do serviço rodar.

**A topologia real, de serviço único:** o Cloud Run sobe com `--allow-unauthenticated` — a
plataforma deixa todo o tráfego HTTP chegar ao código, e a autenticação é inteiramente de
**aplicação**:
- `/v1/matches` (e as demais rotas não-administrativas) exigem o `BOOTH_INGEST_TOKEN` via
  `Authorization: Bearer` (`isAuthorized`, Tarefa C3).
- `/v1/admin/*` e o bloco estático de `/admin` exigem `ADMIN_PANEL_PASSWORD` via HTTP Basic
  (`isAdminAuthorized`, `src/admin-auth.ts`, Tarefa C10) — comparação em tempo constante, sem
  sessão, sem cookie, sem dependência nova. O navegador mostra o prompt nativo de login sozinho;
  nenhuma mudança foi necessária no `admin-app` para isso.

**IAP não é usado nesta topologia**, e `scripts/deploy.sh --with-iap` recusa com essa explicação em
vez de ligar algo que quebraria o estande. Se o painel precisar um dia de uma segunda camada de
identidade Google, a única forma correta é um **segundo serviço Cloud Run**, separado do de
ingestão — decisão de arquitetura em aberto, não algo que uma flag de script resolve.

A senha (`ADMIN_PANEL_PASSWORD`) é, portanto, a **única** camada de autenticação do painel — gerada
por `deploy.sh` com `openssl rand -base64 32` (entropia suficiente para não depender de uma segunda
camada). Um servidor que sobe sem essa variável recusa toda requisição administrativa, mesmo padrão
de `isAuthorized`/`BOOTH_INGEST_TOKEN`.

## Variáveis de ambiente

Ver `.env.example`. Em produção, `BOOTH_INGEST_TOKEN` vem do Secret Manager (nunca de um
arquivo commitado); `PORT` é injetada pelo Cloud Run. Desde a Tarefa C4: `GOOGLE_CLOUD_PROJECT`
(revisão final Fase C — Crítico 4: o servidor agora recusa subir sem isto configurado, fora de
`NODE_ENV=test` — falhar já na subida é preferível a descobrir a ausência da variável só quando
todo visitante do evento começa a ser recusado pela moderação), `VERTEX_LOCATION` (default
`global` — é a única região que serve `gemini-3.7-flash` hoje) e `MODERATION_L2_TIMEOUT_MS`
(default `20000`, e tem que ser **menor** que o `BOOTH_MODERATION_L2_TIMEOUT_MS` do daemon, hoje
`25000` — senão o abort local vence sempre e o fail-closed do servidor nunca chega lá).
Desde a Tarefa C10: `ADMIN_PANEL_PASSWORD`, também do Secret Manager em
produção — ver "Autenticação do painel de admin" acima. `CARDGEN_ENABLED=1` troca o papel do
processo inteiro — ver "Serviço `cardgen`" abaixo; **não a ligue** no serviço de ingestão.

## Testes locais

```bash
npx firebase emulators:start --only firestore --project vibe-cabral
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run test --workspace=packages/cloud-api
```

**Se a 8080 já estiver ocupada** — um `code-server`, por exemplo — os testes batem no processo
errado e saem ≈20 falhas com cara de bug real (`405` em `clearFirestore`). Confira antes
(`lsof -ti :8080`) e, se estiver tomada, rode o emulador noutra porta. Não existe flag de porta na
CLI: a porta vem do `firebase.json`, então use uma cópia temporária dele, na raiz do repositório
(caminhos relativos como `firestore.rules` são resolvidos a partir do diretório do arquivo):

```bash
jq '.emulators.firestore.port = 8085' firebase.json > firebase.emulator.json
npx firebase emulators:start --only firestore --project vibe-cabral --config firebase.emulator.json
FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npm run test --workspace=packages/cloud-api
rm firebase.emulator.json   # é arquivo descartável, não commitar
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

`npm run vendor` roda `vendor:shared`, `vendor:admin-app` e `vendor:companies` (rodáveis
também em separado). Isso escreve em `packages/cloud-api/vendor/jogo-shared/`,
`packages/cloud-api/vendor/admin-app-dist/` e `packages/cloud-api/vendor/companies.json`
(todos gitignored, regenerados a cada build) o
material que o `Dockerfile` injeta na imagem: `jogo-shared/` vira
`node_modules/@jogo/shared` (ver os comentários no `Dockerfile` para o porquê disso e por
que `ajv`, `ajv-formats` e `zod` também estão em `dependencies` deste pacote);
`admin-app-dist/` vira `/app/admin-app-dist`, o diretório que `ADMIN_APP_DIST` (definida
pelo próprio `Dockerfile`) diz a `src/index.ts` para servir sob `/admin` — ver "Topologia de
`/admin`" abaixo. `admin-app/dist` já é build final (HTML/JS/CSS estáticos via `vite build`),
não código-fonte: o Docker só o copia, nunca o recompila. `companies.json` é a cópia de
`config/companies.json` da raiz do repositório, que vira `/app/config/companies.json` na
imagem e é apontada por `BOOTH_COMPANIES_FILE` — sem ela o catálogo de empresas resolvia
para um caminho inexistente e a canonicalização virava um no-op silencioso (ver comentário
no `Dockerfile`).

## Deploy

Sem nenhuma chave de credencial: o Cloud Run usa a identidade da própria service account,
e o token de ingestão e a senha do painel vivem no Secret Manager — nunca em texto puro no
comando de deploy.

**Provisionamento completo, scriptado (2026-08-24):** `npm run deploy:gcp` (raiz do monorepo)
faz todos os passos abaixo do zero — habilita as APIs, cria o banco Firestore nomeado, publica
regras/índices, cria a service account e os segredos (gerando valores aleatórios na primeira
vez), registra um app Web no Firebase e injeta a config dele (`VITE_FIREBASE_*`) no build do
admin-app — sem isso a tela Rankings falha com "is not configured", achado ao vivo no primeiro
deploy real — e builda e publica no Cloud Run. É idempotente: rodar de novo sobre um projeto já
provisionado só atualiza o que mudou, nunca recria ou sobrescreve um segredo já existente.
Aceita `PROJECT_ID=outro-projeto npm run deploy:gcp -- --yes` para reproduzir em outro projeto
sem editar nada versionado. `npm run undeploy:gcp` desfaz (os dois serviços Cloud Run, o gatilho
Eventarc, os segredos e as duas service accounts — nunca o banco Firestore, a menos que
`--delete-database` seja passado explicitamente e o operador digite `EXCLUIR`). Ver
`scripts/deploy.sh`/`scripts/undeploy.sh` para os passos exatos e todas as variáveis de ambiente
aceitas.

O comando manual abaixo é o que `deploy.sh` roda no passo 8/11 (Cloud Run) — documentado aqui para
referência. **`--allow-unauthenticated`, não `--no-allow-unauthenticated`** — ver "Autenticação do
painel de admin" acima para o porquê (a plataforma precisa deixar o tráfego passar; o código faz a
autenticação real).

```bash
gcloud run deploy jogo-navinha-api \
  --source packages/cloud-api \
  --region southamerica-east1 \
  --service-account jogo-navinha-api@PROJETO.iam.gserviceaccount.com \
  --set-secrets BOOTH_INGEST_TOKEN=booth-ingest-token:latest \
  --set-secrets ADMIN_PANEL_PASSWORD=admin-panel-password:latest \
  --set-env-vars GOOGLE_CLOUD_PROJECT=PROJETO \
  --allow-unauthenticated
```

A service account precisa de `roles/datastore.user` e, a partir da Tarefa C4,
`roles/aiplatform.user`, **mais `roles/secretmanager.secretAccessor` em cada um dos dois
segredos** (`booth-ingest-token`, `admin-panel-password`) — sem isso o Cloud Run recusa a
revisão com "Permission denied on secret" ao tentar montar `--set-secrets` (achado ao vivo no
primeiro deploy real, 2026-08-24; `deploy.sh` já concede isso). **Nenhum arquivo de chave é
gerado.**

### Topologia de `/admin` (Tarefa C7)

O `admin-app` compilado é servido pelo MESMO serviço Cloud Run desta API, sob `/admin` — um
serviço a menos para provisionar. A senha HTTP Basic (`isAdminAuthorized`, ver "Autenticação do
painel de admin" acima) protege a rota inteira de uma vez, tanto `/admin` (a UI) quanto
`/v1/admin/*` (a API que ela consome). Implementação, em `src/index.ts`:

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

Ver "Autenticação do painel de admin" acima para por que não há IAP nesta topologia.

### Serviço `cardgen`: o cartão SVG da nave, fora do fluxo do jogo

`jogo-navinha-cardgen` é um **segundo serviço Cloud Run rodando a mesma imagem deste pacote**, com
`CARDGEN_ENABLED=1`. A criação de um documento em `matches/{match_id}` dispara um gatilho Eventarc
(`google.cloud.firestore.document.v1.created`, filtrado por `database=jogo-navinha` e
`document=matches/{matchId}`) que chama `POST /internal/cardgen`; o serviço relê o documento,
renderiza `ship_card_svg` a partir de `ship_spec_snapshot` e grava de volta. `src/cardgen.ts`.

- **Nada disto está no caminho síncrono de `POST /v1/matches`.** O estande considera a partida
  sincronizada sem esperar cartão nenhum, e uma falha de desenho nunca rejeita uma partida.
- **A flag é a fronteira de segurança.** Com `CARDGEN_ENABLED=1` o processo monta **apenas**
  `/v1/health` e `/internal/cardgen`: a ingestão e o painel não existem ali. Isso é defesa em
  profundidade — o serviço já sobe com `--no-allow-unauthenticated` e só a SA do gatilho tem
  `run.invoker` —, e está provado por `src/cardgen-routes.test.ts`, que sobe o `app` de verdade
  com a flag ligada e exige **404** (não 401) em `/admin` e em `/v1/matches`.
- **O evento não é decodificado.** O corpo do CloudEvent do Firestore é protobuf; o cabeçalho
  `ce-subject` traz `documents/matches/{matchId}`, e reler o documento é melhor que confiar no
  payload — o que se renderiza é sempre o estado atual, mesmo com evento fora de ordem.
- **Sem laço:** o gatilho escuta só `created`, e a gravação de volta é um `update`. Como segunda
  camada, o serviço sai sem escrever quando `ship_card_version` já é a corrente.
- **Retentativa:** o Eventarc reentrega qualquer resposta não-2xx. Por isso `204` (não 4xx/5xx)
  para falha permanente — subject malformado, documento apagado, spec ilegível — e `500` apenas
  para erro de Firestore, que é transiente e onde a retentativa é justamente o que se quer.
- **Índices:** `firestore.indexes.json` isenta (`indexes: []`) `ship_card_svg` e
  `ship_spec_snapshot.visuals.svg_path_data`. São dois blobs de até ≈4 KB que ninguém vai
  consultar e que o Firestore indexaria sozinho — custo de escrita e de armazenamento sem
  contrapartida. Publicar isso **antes** do primeiro backfill (`scripts/backfill-ship-cards.mjs`)
  evita gerar índice que seria apagado em seguida.
- **Partidas anteriores ao gatilho** não têm cartão, e nenhum evento as reprocessa:
  `npm run backfill:cards` (dry-run, não escreve nada) e `npm run backfill:cards -- --apply`
  cobrem o passado, com o mesmo renderizador do serviço. Serve de novo, inteiro, quando
  `SHIP_CARD_VERSION` subir. Usa ADC do operador (`gcloud auth application-default login`) e
  **recusa rodar** se `GOOGLE_APPLICATION_CREDENTIALS` estiver definida.

### Por que este pacote usa Express 5, e o `daemon` usa Express 4

Diferença de propósito, não descuido (revisão final Fase C, Minor 10): quase toda rota deste
pacote é um `async (req, res) => { ... }` que faz `await` em Firestore/Vertex sem `try/catch`
próprio. No Express 5, uma `Promise` rejeitada dentro de um handler é encaminhada automaticamente
para o error handler — no Express 4 (a versão do `daemon`), isso exigiria um `try/catch` manual
em cada rota async, ou um wrapper, para não virar um `unhandledRejection` silencioso. Mantido
como está: os dois pacotes têm razões independentes para a versão que usam, e não há nenhum
código compartilhado entre eles que dependa de uma versão específica do Express.
