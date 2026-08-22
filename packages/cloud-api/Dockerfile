# syntax=docker/dockerfile:1
#
# Multi-stage sobre node:22-slim (Spec 08 §6.4). O contexto de build é este diretório
# (`gcloud run deploy --source packages/cloud-api`, ver README.md) — por isso o pacote
# irmão `@jogo/shared` não está visível ao Docker via workspace do npm. A pasta
# `vendor/jogo-shared`, gerada por `npm run vendor:shared` ANTES do deploy (ver README),
# é uma cópia local do `dist` já compilado de `@jogo/shared`; este Dockerfile a injeta
# direto em `node_modules` em vez de pedir ao npm para resolvê-la (o registro não a
# conhece — é um pacote privado do monorepo, nunca publicado). `ajv`, `ajv-formats` e
# `zod` estão em `dependencies` só por isso: `@jogo/shared` é um único barrel
# (`export * from './validator.js'` etc.) que os usa em tempo de execução mesmo quando
# só se importa `DATABASE_ID`/`SCHEMA_VERSION` daqui — sem o hoisting do workspace do
# npm para resolvê-los transitivamente, precisam estar declarados aqui também.

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

# Cloud Run injeta PORT; o servidor lê process.env.PORT (src/index.ts).
EXPOSE 8080
CMD ["node", "dist/index.js"]
