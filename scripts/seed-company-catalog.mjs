#!/usr/bin/env node
/**
 * Semeia `companies/catalog` no Firestore a partir de `config/companies.json`.
 *
 * POR QUE ISTO EXISTE: `companies/catalog` virou a fonte única do catálogo de empresas — é o que
 * a canonicalização na nuvem consulta e o que `GET /v1/companies` serve aos dois estandes. Mas o
 * documento só nascia quando alguém clicava "Salvar" no painel de admin, e até lá a tela abria
 * com uma lista VAZIA. Um "Salvar" descuidado nesse estado gravava `[]`, o que desliga o
 * casamento de nomes nas duas estações e racha `company_rankings` em uma entrada por grafia
 * digitada. Semear no deploy faz o painel abrir com a lista certa desde o primeiro acesso.
 *
 * NUNCA SOBRESCREVE. Se o documento já existe com pelo menos uma empresa, este script não toca
 * em nada e sai com sucesso. Um deploy na véspera do evento que apagasse as empresas cadastradas
 * pelo operador seria muito pior que um deploy que não semeia — por isso a leitura e a escrita
 * ficam na mesma transação, e não num `set` com merge.
 *
 * Idempotente e seguro de rodar quantas vezes quiser. `deploy.sh` o chama logo depois de
 * provisionar as regras do Firestore.
 *
 * CREDENCIAL: ADC do operador (`gcloud auth application-default login`), mesma regra do
 * `backfill-ship-cards.mjs`. Nenhum arquivo de chave é lido, gerado ou aceito.
 *
 * Uso:
 *   node scripts/seed-company-catalog.mjs
 *   PROJECT_ID=outro node scripts/seed-company-catalog.mjs --database outro-banco
 *   node scripts/seed-company-catalog.mjs --file /caminho/para/companies.json
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const projectId = process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
const databaseId = arg('database', process.env.FIRESTORE_DATABASE || 'jogo-navinha');
const catalogFile = arg('file', process.env.BOOTH_COMPANIES_FILE || path.join(repoRoot, 'config', 'companies.json'));

if (!projectId) {
  console.error('[seed-company-catalog] defina PROJECT_ID (ou GOOGLE_CLOUD_PROJECT).');
  process.exit(1);
}

if (!fs.existsSync(catalogFile)) {
  console.error(`[seed-company-catalog] arquivo não encontrado: ${catalogFile}`);
  process.exit(1);
}

let companies;
try {
  const parsed = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
  companies = Array.isArray(parsed.companies)
    ? parsed.companies.filter((c) => typeof c === 'string' && c.trim())
    : [];
} catch (err) {
  console.error(`[seed-company-catalog] ${catalogFile} não é JSON válido:`, err.message);
  process.exit(1);
}

if (companies.length === 0) {
  // Sair com sucesso, não com erro: o deploy não deve falhar por causa disto, e semear uma lista
  // vazia é exatamente o estado que este script existe para evitar.
  console.warn(`[seed-company-catalog] ${catalogFile} não tem empresas — nada a semear.`);
  process.exit(0);
}

const app = initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore(app, databaseId);
const ref = db.collection('companies').doc('catalog');

const created = await db.runTransaction(async (tx) => {
  const snap = await tx.get(ref);
  const existing = snap.exists ? snap.data() : null;

  if (existing && Array.isArray(existing.companies) && existing.companies.length > 0) return false;

  tx.set(ref, {
    schema_version: 1,
    companies,
    updated_at: FieldValue.serverTimestamp(),
    version: (existing && typeof existing.version === 'number' ? existing.version : 0) + 1
  });
  return true;
});

if (created) {
  console.log(`[seed-company-catalog] companies/catalog criado com ${companies.length} empresas de ${catalogFile}.`);
} else {
  console.log('[seed-company-catalog] companies/catalog já existe e não está vazio — preservado como está.');
}

process.exit(0);
