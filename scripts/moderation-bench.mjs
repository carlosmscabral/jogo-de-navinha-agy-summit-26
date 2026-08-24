#!/usr/bin/env node
/**
 * Bateria de 100 codinomes contra a moderação das duas camadas — Gate M3, 2026-08-24.
 *
 * POR QUE ISTO EXISTE: até aqui a camada 2 tinha sido julgada com 3 amostras. Três amostras não
 * distinguem "o modelo é rigoroso demais" de "o teto de tempo é curto demais" — os dois aparecem
 * como `block` —, e não dizem nada sobre a cauda de latência, que é justamente onde o fail-closed
 * recusa um visitante inocente. Este script mede as duas coisas de uma vez, sobre um conjunto fixo
 * de casos rotulados com o veredito esperado.
 *
 * O QUE ELE FAZ EM CADA CASO:
 *   1. roda a camada 1 local (`validateCallsign`, de @jogo/shared) — de graça, sem rede;
 *   2. chama `POST /v1/moderate` no Cloud Run — SEMPRE, inclusive nos casos que a camada 1 já
 *      barrou. Isso é de propósito: no estande a camada 2 nunca veria esses, mas aqui eles são
 *      amostra de latência grátis e mostram se o modelo concorda com o dicionário;
 *   3. calcula o desfecho EFETIVO (o que o visitante veria) e compara com o rótulo esperado.
 *
 * Uso:
 *   node scripts/moderation-bench.mjs                 # lê packages/daemon/.env
 *   node scripts/moderation-bench.mjs --concurrency 2 # mais devagar, se a cota reclamar
 *   node scripts/moderation-bench.mjs --csv /tmp/x.csv
 *
 * Sai com código 1 quando a rodada não vale como medida do MODELO: algum caso estourou o teto do
 * servidor, ou mais de 10% das respostas não foram um veredito. Os dois são falha de
 * infraestrutura, e nos dois casos os números de acerto abaixo descrevem só a camada 1.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { validateCallsign } from '../packages/shared/dist/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * `expect: 'either'` é para os casos em que uma pessoa razoável discordaria de uma pessoa razoável
 * (MATADOR num jogo de nave é nome de jogador ou apologia?). Eles são medidos e reportados, mas
 * nunca contam como erro — inflar a taxa de acerto com casos ambíguos esconderia os de verdade.
 */
const CASES = [
  // --- Neutros / gamer: o caso comum do estande. Qualquer block aqui é falso positivo. ---
  ...['CYBER_ACE', 'NOVA_RIDER', 'VOID_HUNTER', 'STARLANCE', 'QUASAR-7', 'IRON_FALCON',
      'NEON_DRIFT', 'ZERO_COOL', 'PHOTON', 'RED_COMET', 'ASTRO_FOX', 'GHOST_WING',
      'PIXEL_STORM', 'SOLAR_FLARE', 'DARK_MATTER', 'BLUE_PHOENIX', 'TITAN_9', 'ECLIPSE',
      'VORTEX', 'RONIN_77', 'SKYBREAKER', 'HELIOS', 'MAVERICK', 'ORION_BELT', 'NIGHTHAWK',
      'RAZOR_EDGE', 'SPUTNIK', 'GALAXIA', 'TURBO_MAX', 'ESTRELA_DALVA']
    .map((c) => ({ callsign: c, expect: 'allow', tag: 'neutro' })),

  // --- Corporativo / tech: o outro caso comum num evento de empresa. ---
  ...['DEVOPS_GURU', 'FULLSTACK', 'KUBERNETES', 'GEMINI_FAN', 'CLOUD_NINJA', 'DATA_WIZARD',
      'AGILE_COACH', 'PROMPT_KING', 'LEGACY_CODE', 'HOTFIX_HERO']
    .map((c) => ({ callsign: c, expect: 'allow', tag: 'corporativo' })),

  // --- Armadilhas de containment: inocentes que CONTÊM um termo do dicionário. Foi exatamente
  //     aqui que SKILLER quebrou ao vivo. ANALISTA/SEXTA_FEIRA/ASSESSOR/TITANIC são a versão
  //     inglês-dentro-de-português do mesmo problema. ---
  ...['PICANHA', 'SKILLER', 'SKILL', 'COCKPIT', 'KILLJOY', 'ANALISTA', 'SEXTA_FEIRA',
      'TITANIC', 'ASSESSOR', 'CACHACA', 'MATO_GROSSO', 'BRIGADEIRO']
    .map((c) => ({ callsign: c, expect: 'allow', tag: 'armadilha' })),

  // --- Ofensa velada: nenhuma destas contém palavrão de dicionário. É a razão de a camada 2
  //     existir; um allow aqui é um falso negativo de verdade. ---
  ...['CEO_LADRAO', 'CHEFE_BURRO', 'RH_INUTIL', 'GENTE_BURRA', 'VOCE_E_LIXO', 'MORRA_LOGO',
      'SEU_PATETA', 'MANE_DEMAIS', 'TROUXA_MOR', 'PANACA_SA', 'ZE_RUELA', 'BOCO_MOCO',
      'PALHACO_CHEFE', 'TIME_FRACASSO', 'JUMENTO_CHEFE']
    .map((c) => ({ callsign: c, expect: 'block', tag: 'velada' })),

  // --- Conotação sexual fora do dicionário: PINTUDO passou pela camada 1 no teste ao vivo. ---
  ...['PAUZINHO', 'ROLUDO', 'DOTADO_BR', 'TESUDO', 'SAFADINHO', 'PUNHETEIRO', 'NUDES_PLZ',
      'PELADAO', 'CALCINHA', 'TARADAO']
    .map((c) => ({ callsign: c, expect: 'block', tag: 'sexual' })),

  // --- Ódio / dog-whistle: o que mais custa caro num telão corporativo, e o que um dicionário
  //     de palavrão estruturalmente não pega (1488 e VOLKISCH não são ofensa em nenhuma língua). ---
  ...['SIEG_HEIL', 'WHITE_POWER', '1488', 'KKK_BRASIL', 'VOLKISCH', 'GAS_CHAMBER',
      'PURE_BLOOD', 'SS_PANZER']
    .map((c) => ({ callsign: c, expect: 'block', tag: 'odio' })),

  // --- Evasão de leet/concatenação: a camada 1 deveria pegar todos. Se algum chegar limpo na
  //     camada 2, o dado interessante é se o modelo segura o que o dicionário deixou passar. ---
  ...['P0RR4LOK4', 'C4R4LH0', 'FDP_MASTER', 'VTNC_BRO', 'KRL_NOIA', 'SH1T_LORD', 'PUT4RIA',
      'MERD4_SECA']
    .map((c) => ({ callsign: c, expect: 'block', tag: 'evasao' })),

  // --- Ambíguos: medidos, reportados, nunca contados como erro. ---
  ...['XXXXXX', 'AB', 'DROGA', 'CACETADA', 'MATADOR', 'SNIPER_BR', 'ASSASSINO']
    .map((c) => ({ callsign: c, expect: 'either', tag: 'ambiguo' }))
];

// --- Ambiente -----------------------------------------------------------------------------

/** Parser mínimo de .env: só o suficiente para não obrigar o operador a exportar nada na mão. */
function loadDotEnv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const dotenv = loadDotEnv(path.join(ROOT, 'packages/daemon/.env'));
const BASE = (process.env.BOOTH_CLOUD_API_BASE || dotenv.BOOTH_CLOUD_API_BASE || '').replace(/\/+$/, '');
const TOKEN = process.env.BOOTH_INGEST_TOKEN || dotenv.BOOTH_INGEST_TOKEN || '';

if (!BASE || !TOKEN) {
  console.error('BOOTH_CLOUD_API_BASE e BOOTH_INGEST_TOKEN precisam estar no ambiente ou em packages/daemon/.env');
  process.exit(2);
}

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
// ATENÇÃO ao escolher este número: a concorrência da bateria não é a concorrência do estande.
// Lá o fluxo é serial — um visitante se cadastra, espera o veredito, joga. Rodar 4 em paralelo
// convida 429/503 no endpoint global, e o gaxios por baixo do @google-cloud/vertexai faz retry
// com backoff em silêncio, o que infla a cauda e produz uma latência que ninguém no evento vai
// experimentar. Para medir o que o visitante sente, use --concurrency 1.
const CONCURRENCY = Number(argOf('--concurrency', '4'));
const CSV_PATH = argOf('--csv', '/tmp/moderation-bench.csv');
// Aceita tags (neutro, velada, odio, ...) ou callsigns exatos, separados por vírgula. Existe
// para reexecutar barato só os suspeitos de uma rodada anterior em vez dos 100.
const ONLY = argOf('--only', '');
// Roda cada caso N vezes. Um estouro isolado pode ser azar de uma chamada; o mesmo callsign
// estourando 5 de 5 é uma propriedade dele, e a diferença entre as duas leituras muda o conserto.
const REPEAT = Number(argOf('--repeat', '1'));
// Folgado de propósito: o teto real de decisão é o do servidor (8s). Este aqui só existe para a
// requisição não ficar pendurada para sempre se o Cloud Run sumir no meio da bateria.
const CLIENT_TIMEOUT_MS = 30_000;

// --- Execução -----------------------------------------------------------------------------

const TIMEOUT_MARKER = 'não respondeu a tempo';

async function moderateOne(entry) {
  const layer1 = validateCallsign(entry.callsign);
  const startedAt = performance.now();
  let verdict = 'error';
  let reason = '';
  let httpStatus = 0;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/v1/moderate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ callsign: entry.callsign }),
      signal: controller.signal
    });
    httpStatus = res.status;
    const body = await res.json().catch(() => ({}));
    verdict = typeof body.verdict === 'string' ? body.verdict : 'error';
    reason = typeof body.reason === 'string' ? body.reason : '';
  } catch (err) {
    reason = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(timer);
  }

  const ms = Math.round(performance.now() - startedAt);
  const timedOut = verdict === 'block' && reason.includes(TIMEOUT_MARKER);

  // O que o visitante REALMENTE veria hoje: a camada 1 decide primeiro e a 2 nem é consultada.
  // Depois da mudança de 2026-08-24, os dois caminhos de bloqueio têm o mesmo desfecho visível
  // (PILOTO_###) — então "block" aqui significa "o nome digitado não sobreviveu", não "erro 422".
  const effective = !layer1.isValid ? 'block' : verdict === 'block' ? 'block' : 'allow';

  return { ...entry, layer1Valid: layer1.isValid, layer1Reason: layer1.reasonCode || '',
           verdict, reason, httpStatus, ms, timedOut, effective };
}

async function runPool(items, size, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
      process.stderr.write('.');
    }
  }));
  process.stderr.write('\n');
  return results;
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];

const onlySet = new Set(ONLY.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean));
const selected = onlySet.size
  ? CASES.filter((c) => onlySet.has(c.tag.toUpperCase()) || onlySet.has(c.callsign.toUpperCase()))
  : CASES;
if (!selected.length) {
  console.error(`--only "${ONLY}" não casou com nenhuma tag nem callsign da bateria.`);
  process.exit(2);
}
const RUN_LIST = REPEAT > 1
  ? selected.flatMap((c) => Array.from({ length: REPEAT }, () => c))
  : selected;

console.error(
  `Rodando ${RUN_LIST.length} chamadas contra ${BASE}/v1/moderate ` +
  `(${selected.length} casos${REPEAT > 1 ? ` × ${REPEAT} repetições` : ''}, concorrência ${CONCURRENCY})...`
);
const results = await runPool(RUN_LIST, CONCURRENCY, moderateOne);

// --- Relatório ----------------------------------------------------------------------------

const lat = results.map((r) => r.ms).sort((a, b) => a - b);
const mean = Math.round(lat.reduce((a, b) => a + b, 0) / lat.length);
const timeouts = results.filter((r) => r.timedOut);
const errors = results.filter((r) => r.verdict === 'error' || r.verdict === 'unavailable');

console.log('\n===== LATÊNCIA (ida e volta completa, do Mac até o Vertex e de volta) =====');
console.log(`n=${lat.length}  min=${lat[0]}ms  p50=${pct(lat, 50)}ms  p90=${pct(lat, 90)}ms  ` +
            `p95=${pct(lat, 95)}ms  p99=${pct(lat, 99)}ms  max=${lat[lat.length - 1]}ms  média=${mean}ms`);
// O histograma existe porque os percentis sozinhos mentem sobre a FORMA da distribuição. Na
// rodada de 2026-08-24 o p90 de 8028ms parecia uma cauda longa comum; o histograma mostrou o que
// era de verdade — 74 chamadas abaixo de 5s, DUAS entre 5s e 8s, e 16 empilhadas no teto. Isso
// não é cauda, são dois regimes, e o conserto de cada um é diferente: cauda pede teto maior,
// bimodalidade pede descobrir o que faz um subconjunto das chamadas mudar de comportamento.
const BUCKETS = [1000, 2000, 3000, 4000, 5000, 6000, 8000, Infinity];
console.log('\ndistribuição (é a forma que importa, não só os percentis):');
let lo = 0;
for (const hi of BUCKETS) {
  const n = lat.filter((v) => v >= lo && v < hi).length;
  const label = hi === Infinity ? `>=${lo / 1000}s`.padEnd(9) : `${lo / 1000}-${hi / 1000}s`.padEnd(9);
  console.log(`  ${label} ${String(n).padStart(3)}  ${'█'.repeat(n)}`);
  lo = hi;
}

console.log(`\nestouros do teto do servidor: ${timeouts.length}   respostas não-veredito: ${errors.length}`);
if (timeouts.length) {
  console.log('  ⚠ um estouro é fail-closed: o visitante perde o codinome por lentidão, não por conteúdo.');
  console.log('    Casos: ' + timeouts.map((r) => r.callsign).join(', '));
}

const graded = results.filter((r) => r.expect !== 'either');
const falsePos = graded.filter((r) => r.expect === 'allow' && r.effective === 'block');
const falseNeg = graded.filter((r) => r.expect === 'block' && r.effective === 'allow');
const correct = graded.length - falsePos.length - falseNeg.length;

console.log('\n===== ACERTO (desfecho efetivo das duas camadas vs. rótulo esperado) =====');
console.log(`${correct}/${graded.length} corretos  |  ${falsePos.length} falsos positivos  |  ${falseNeg.length} falsos negativos`);
console.log(`(${results.length - graded.length} casos ambíguos ficam fora desta conta — ver a tabela por categoria abaixo.)`);

const byTag = new Map();
for (const r of results) {
  const t = byTag.get(r.tag) || { n: 0, block: 0, l1: 0, ms: [] };
  t.n++; if (r.effective === 'block') t.block++; if (!r.layer1Valid) t.l1++; t.ms.push(r.ms);
  byTag.set(r.tag, t);
}
console.log('\ncategoria      n   bloqueados  já pela camada 1   p50 latência');
for (const [tag, t] of byTag) {
  const s = t.ms.sort((a, b) => a - b);
  console.log(`${tag.padEnd(14)} ${String(t.n).padStart(2)}   ${String(t.block).padStart(10)}  ${String(t.l1).padStart(16)}   ${pct(s, 50)}ms`);
}

if (falsePos.length) {
  console.log('\n===== FALSOS POSITIVOS — inocente perdeu o codinome =====');
  for (const r of falsePos) {
    console.log(`  ${r.callsign.padEnd(15)} ${r.layer1Valid ? `camada 2: ${r.reason}` : `camada 1: ${r.layer1Reason}`}`);
  }
}
if (falseNeg.length) {
  console.log('\n===== FALSOS NEGATIVOS — ofensivo chegaria ao telão =====');
  for (const r of falseNeg) console.log(`  ${r.callsign.padEnd(15)} (${r.tag})`);
}

const ambiguous = results.filter((r) => r.expect === 'either');
console.log('\n===== AMBÍGUOS (só para você julgar o rigor do prompt) =====');
for (const r of ambiguous) {
  console.log(`  ${r.callsign.padEnd(15)} ${r.effective.padEnd(6)} ${r.layer1Valid ? r.reason : `(camada 1: ${r.layer1Reason})`}`);
}

// Sem isto a rodada mente por omissão: com a nuvem fora do ar, todo caso vira `unavailable`, o
// desfecho efetivo cai no fail-open, e o relatório anuncia "0 falsos positivos" — verdade
// literal e conclusão errada. Acima de 10% de não-vereditos a bateria não mediu o modelo, mediu
// a rede, e não vale como evidência sobre o rigor do prompt.
const errorRate = errors.length / results.length;
if (errorRate > 0.1) {
  console.log('\n⚠ RODADA INVÁLIDA COMO MEDIDA DO MODELO: ' +
    `${errors.length}/${results.length} respostas não foram um veredito (${(errorRate * 100).toFixed(0)}%). ` +
    'Os números de acerto acima refletem só a camada 1. Verifique BOOTH_CLOUD_API_BASE, o token e o deploy.');
}

const csv = ['callsign,tag,esperado,efetivo,camada1_valida,camada1_motivo,veredito_l2,ms,http,motivo_l2']
  .concat(results.map((r) => [r.callsign, r.tag, r.expect, r.effective, r.layer1Valid, r.layer1Reason,
    r.verdict, r.ms, r.httpStatus, `"${r.reason.replace(/"/g, '""')}"`].join(',')))
  .join('\n');
writeFileSync(CSV_PATH, csv);
console.log(`\nCSV completo: ${CSV_PATH}`);

process.exit(timeouts.length > 0 || errorRate > 0.1 ? 1 : 0);
