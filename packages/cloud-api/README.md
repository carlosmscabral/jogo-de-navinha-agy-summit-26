# @jogo/cloud-api

API de ingestão em Cloud Run (Tarefa C3, Spec 08 §6). É o único ponto onde a credencial
privilegiada do Firestore existe, onde a idempotência por `match_id` é aplicada e onde os
agregados (`pilots`, `company_rankings`) são atualizados por transação. A máquina do
estande nunca fala com o Firestore diretamente — só com este serviço, via HTTPS.

## Endpoints

- `POST /v1/matches` — corpo `{ matches: MatchDocument[] }` (até 50), cabeçalho
  `Authorization: Bearer <BOOTH_INGEST_TOKEN>`. Resposta:
  `{ accepted: string[]; rejected: Array<{ match_id: string; reason: string }> }`.
- `GET /v1/health` — sem autenticação; usado pelo `self_test.sh` (Tarefa D3).

## Variáveis de ambiente

Ver `.env.example`. Em produção, `BOOTH_INGEST_TOKEN` vem do Secret Manager (nunca de um
arquivo commitado); `PORT` é injetada pelo Cloud Run.

## Testes locais

```bash
npx firebase emulators:start --only firestore
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run test --workspace=packages/cloud-api
```

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
