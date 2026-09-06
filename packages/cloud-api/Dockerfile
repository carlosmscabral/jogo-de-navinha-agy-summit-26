# syntax=docker/dockerfile:1
#
# Multi-stage sobre node:22-slim (Spec 08 §6.4). O contexto de build é este diretório
# (`gcloud run deploy --source packages/cloud-api`, ver README.md) — por isso os pacotes
# irmãos `@jogo/shared` e `@jogo/admin-app` não estão visíveis ao Docker via workspace do
# npm. A pasta `vendor/jogo-shared`, gerada por `npm run vendor:shared` ANTES do deploy
# (ver README), é uma cópia local do `dist` já compilado de `@jogo/shared`; este Dockerfile
# a injeta direto em `node_modules` em vez de pedir ao npm para resolvê-la (o registro não a
# conhece — é um pacote privado do monorepo, nunca publicado). `ajv`, `ajv-formats` e
# `zod` estão em `dependencies` só por isso: `@jogo/shared` é um único barrel
# (`export * from './validator.js'` etc.) que os usa em tempo de execução mesmo quando
# só se importa `DATABASE_ID`/`SCHEMA_VERSION` daqui — sem o hoisting do workspace do
# npm para resolvê-los transitivamente, precisam estar declarados aqui também.
#
# `vendor/admin-app-dist` (gerado por `npm run vendor:admin-app`, mesmo README) é o
# mesmo truque aplicado ao `admin-app` (Tarefa C7): já é o BUILD FINAL (HTML/JS/CSS
# estáticos, produzido por `vite build` fora do Docker), não código-fonte a compilar
# aqui dentro — por isso entra só no estágio `runtime`, nunca no `builder`.

FROM node:22-slim AS builder
WORKDIR /app

COPY package.json ./
# Remove a dependência de workspace do grafo que o npm vai resolver: ela é injetada
# manualmente logo abaixo, a partir de vendor/, porque não existe no registro público.
RUN npm pkg delete dependencies.@jogo/shared
RUN npm install

COPY vendor/jogo-shared ./node_modules/@jogo/shared
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc
RUN npm prune --omit=dev
# `npm prune` acabou de apagar node_modules/@jogo/shared por não estar declarado em
# package.json (é "extraneous" do ponto de vista do npm) — repõe a cópia vendorizada.
COPY vendor/jogo-shared ./node_modules/@jogo/shared

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# admin-app (Tarefa C7, Passo 5): servido pelo MESMO container, sob /admin, atrás do IAP
# configurado no Cloud Run (não neste Dockerfile — ver README). `ADMIN_APP_DIST` diz a
# `src/index.ts` onde procurar o build; sem ele, o servidor sobe normalmente e só loga um
# aviso — `/admin` fica indisponível, mas `/v1/*` continua funcionando.
COPY vendor/admin-app-dist ./admin-app-dist
ENV ADMIN_APP_DIST=/app/admin-app-dist

# Catálogo de empresas: `canonicalize.ts` resolve o default como
# `<packageRoot>/../../config/companies.json`, que dentro do container vira
# `/config/companies.json` — um caminho que nunca existiu, porque o contexto de build é
# `packages/cloud-api` e o Docker não enxerga `../../config`. O efeito era silencioso e
# grave: `loadCompanyCatalog()` devolvia `[]`, o prompt de canonicalização ia com
# "Catálogo: []" e a instrução de nunca inventar nome fora dele, e o modelo só conseguia
# ecoar o palpite local — a canonicalização na nuvem era um no-op. `vendor/companies.json`
# (gerado por `npm run vendor:companies`) é a cópia que fecha esse buraco, e serve de
# semente/fallback para o catálogo do Firestore (company-catalog.ts).
COPY vendor/companies.json ./config/companies.json
ENV BOOTH_COMPANIES_FILE=/app/config/companies.json

# Cloud Run injeta PORT; o servidor lê process.env.PORT (src/index.ts).
EXPOSE 8080
CMD ["node", "dist/index.js"]
