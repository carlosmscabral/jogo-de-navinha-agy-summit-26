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
 * NUNCA SOBRESCREVE POR PADRÃO. Se o documento já existe com pelo menos uma empresa, este script
 * não toca em nada e sai com sucesso. Um deploy na véspera do evento que apagasse as empresas
 * cadastradas pelo operador seria muito pior que um deploy que não semeia — por isso a leitura e
 * a escrita ficam na mesma transação, e não num `set` com merge. É esse o caminho que o
 * `deploy.sh` usa, e ele continua sem nenhuma forma de destruir o catálogo do operador.
 *
 * `--replace` é a saída de emergência para o caso oposto: o catálogo do arquivo foi curado (como
 * nas ≈1000 empresas levantadas do CRM do evento) e precisa substituir o que já está na nuvem.
 * Ela não é silenciosa — imprime o diff, LISTA nome por nome o que sai, avisa quais nomes
 * removidos já têm pontos em `company_rankings`, e aborta se o documento mudou entre a prévia e
 * a escrita (mesma concorrência otimista do `expectedVersion` do painel). Use `--dry-run` para
 * ver o diff sem gravar nada.
 *
 * Um nome removido que já pontuou NÃO perde os pontos: `company_rankings/{nome}` continua lá e o
 * telão continua mostrando. O que muda é o futuro — quem digitar aquela empresa a partir de agora
 * cai no fallback e passa a somar numa entrada com outra grafia. Por isso o aviso.
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
 *   PROJECT_ID=... node scripts/seed-company-catalog.mjs --replace --dry-run
 *   PROJECT_ID=... node scripts/seed-company-catalog.mjs --replace
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

function flag(name) {
  return process.argv.includes(`--${name}`);
}

const projectId = process.env.PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
const databaseId = arg('database', process.env.FIRESTORE_DATABASE || 'jogo-navinha');
const catalogFile = arg('file', process.env.BOOTH_COMPANIES_FILE || path.join(repoRoot, 'config', 'companies.json'));
const replace = flag('replace');
const dryRun = flag('dry-run');

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

/** "Itaú" e "ITAÚ" são a mesma empresa para quem digita no estande — o diff não pode fingir que não. */
const chave = (s) => s.trim().toLowerCase();

function ler(snap) {
  const d = snap.exists ? snap.data() : null;
  return {
    companies: d && Array.isArray(d.companies) ? d.companies : [],
    version: d && typeof d.version === 'number' ? d.version : 0
  };
}

if (replace) {
  const previa = ler(await ref.get());
  const atuaisPorChave = new Set(previa.companies.map(chave));
  const novasPorChave = new Set(companies.map(chave));
  const entram = companies.filter((c) => !atuaisPorChave.has(chave(c)));
  const saem = previa.companies.filter((c) => !novasPorChave.has(chave(c)));

  console.log(`[seed-company-catalog] companies/catalog em ${projectId} / ${databaseId} (version ${previa.version})`);
  console.log(`  hoje na nuvem ......... ${previa.companies.length}`);
  console.log(`  no arquivo ............ ${companies.length}  (${catalogFile})`);
  console.log(`  entram ................ ${entram.length}`);
  console.log(`  saem .................. ${saem.length}`);

  if (entram.length === 0 && saem.length === 0) {
    // Sem diff não há o que gravar. Regravar assim mesmo incrementaria a `version` à toa e
    // invalidaria o `expectedVersion` de um painel de admin que estivesse aberto — derrubando o
    // "Salvar" do operador com um 409 causado por este script, e não por ele.
    console.log('\n[seed-company-catalog] a nuvem já está idêntica ao arquivo — nada a fazer.');
    process.exit(0);
  }

  if (saem.length > 0) {
    // Por extenso, nome a nome, e não um resumo: remover é a metade destrutiva da operação, e é
    // barato o suficiente conferir cada linha antes de autorizar.
    console.log('\n  SAEM do catálogo:');
    for (const c of saem) console.log(`    - ${c}`);

    // `company_rankings/{company_canonical}` usa o nome canônico como ID do documento. Um nome que
    // sai do catálogo mas já pontuou não perde o que tem — mas deixa de ser alcançável pelo
    // casamento, então as partidas seguintes vão para outra entrada. Esse é o único efeito
    // colateral de verdade de um `--replace`, e o operador tem de vê-lo antes, não depois.
    const saindoPorChave = new Set(saem.map(chave));
    const jaPontuaram = (await db.collection('company_rankings').listDocuments())
      .map((d) => d.id)
      .filter((id) => saindoPorChave.has(chave(id)));

    if (jaPontuaram.length > 0) {
      console.log(`\n  ATENÇÃO: ${jaPontuaram.length} nome(s) que saem JÁ TÊM pontos em company_rankings.`);
      console.log('  Os pontos continuam no telão; o que muda é que novas partidas não somam mais neles:');
      for (const id of jaPontuaram) console.log(`    ! ${id}`);
    }
  }

  if (dryRun) {
    console.log('\n[seed-company-catalog] --dry-run: nada foi gravado.');
    process.exit(0);
  }

  let gravada;
  try {
    gravada = await db.runTransaction(async (tx) => {
      const agora = ler(await tx.get(ref));
      // Concorrência otimista, a mesma do `expectedVersion` no PUT /v1/admin/companies: se alguém
      // salvou pelo painel entre a prévia impressa acima e este instante, o diff que o operador
      // leu não é mais o diff que seria aplicado. Abortar vale mais que gravar às cegas.
      if (agora.version !== previa.version) {
        throw new Error(
          `o documento mudou durante a operação (version ${previa.version} -> ${agora.version}) — rode de novo`
        );
      }
      tx.set(ref, {
        schema_version: 1,
        companies,
        updated_at: FieldValue.serverTimestamp(),
        version: agora.version + 1
      });
      return agora.version + 1;
    });
  } catch (err) {
    console.error(`[seed-company-catalog] ABORTADO: ${err.message}`);
    process.exit(1);
  }

  console.log(`\n[seed-company-catalog] companies/catalog substituído: ${companies.length} empresas, version ${gravada}.`);
  process.exit(0);
}

if (dryRun) {
  const previa = ler(await ref.get());
  if (previa.companies.length > 0) {
    console.log(
      `[seed-company-catalog] --dry-run: companies/catalog já tem ${previa.companies.length} empresas — ` +
        'seria preservado. Use --replace --dry-run para ver o diff da substituição.'
    );
  } else {
    console.log(`[seed-company-catalog] --dry-run: criaria companies/catalog com ${companies.length} empresas.`);
  }
  process.exit(0);
}

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
  console.log(
    '[seed-company-catalog] companies/catalog já existe e não está vazio — preservado como está. ' +
      '(Use --replace para substituí-lo de propósito.)'
  );
}

process.exit(0);
