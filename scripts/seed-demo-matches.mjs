#!/usr/bin/env node
/**
 * Semeia partidas de DEMONSTRAÇÃO na nuvem de verdade, para poder testar o telão com dados.
 *
 * POR QUE ISTO EXISTE. Metade do Bloco 27 de `specs/12_MANUAL_TEST_PLAN_MAC.md` é inexecutável
 * com o placar vazio: contar 20 pilotos e 15 empresas (27.1), cronometrar o vai-e-volta da
 * rolagem (27.2), ver o corte para o placar quando entra um recorde (27.7), deixar 15 minutos
 * rodando sem deriva (27.9). Nada disso se produz à mão — são dezenas de registros cujas
 * pontuações precisam formar um pódio plausível, senão a rolagem e o pódio não são testados,
 * só olhados.
 *
 * POR QUE NÃO PELO DAEMON, ao contrário de `rehearse-two-booths.mjs`. Aquele script sobe dois
 * daemons de verdade porque a pergunta DELE é a resolução de empresa dentro do
 * `POST /api/session/start` — o caminho é o objeto do teste. Aqui a pergunta é só "o telão
 * desenha bem N partidas", e cada daemon no caminho seria uma fonte de falha sem relação
 * nenhuma com ela. Este script fala direto com `POST /v1/matches` no Cloud Run, que é o mesmo
 * endpoint para onde o daemon envia.
 *
 * COMO APAGAR DEPOIS — o ponto mais importante deste cabeçalho. Toda partida sai com o mesmo
 * `station_id` (`--estacao`, default `demo-telao`), e o painel de admin tem busca EXATA por esse
 * campo:
 *
 *     Partidas → campo "Estação" → demo-telao → Buscar → selecionar tudo → Apagar
 *
 * O `POST /v1/admin/matches/bulk` com `action: 'delete'` recalcula `company_rankings` e
 * `pilots`, então as empresas voltam a zero e as cascas zeradas somem sozinhas. Rotular pela
 * estação é melhor que um prefixo no nome (o caminho que o ensaio usa) porque o painel já tem
 * um filtro de verdade para esse campo — um prefixo obrigaria a conferir as linhas a olho, e
 * basta errar uma para o placar do evento começar sujo.
 *
 * AS EMPRESAS SÃO AS DE VERDADE, lidas de `GET /v1/companies`. Uma "Empresa Fictícia 7" não
 * provaria nada sobre o que a TV faz com "Magazine Luiza" ou "Mercado Livre": o comprimento do
 * nome é justamente uma das coisas que o passo 27.1 manda conferir do fundo do estande.
 *
 * `fallback_used: true` EM TODAS. As naves aqui vêm de preset, não da forja do agy. O painel de
 * Saúde mede essa taxa para pegar um agy morto, e marcar `false` mentiria para a única métrica
 * que existe com esse fim. A consequência é que, enquanto estes dados estiverem no ar, o painel
 * de Saúde vai acusar 100% de fallback — é honesto, e some junto com as partidas.
 *
 * CREDENCIAL: `BOOTH_INGEST_TOKEN` no ambiente, o mesmo token dos estandes. Nenhum arquivo de
 * chave é lido, gerado ou aceito.
 *
 * Uso:
 *   BOOTH_CLOUD_API_BASE=https://... BOOTH_INGEST_TOKEN=... node scripts/seed-demo-matches.mjs
 *   node scripts/seed-demo-matches.mjs --n=25
 *   node scripts/seed-demo-matches.mjs --seco            # mostra o que faria, sem enviar
 *   node scripts/seed-demo-matches.mjs --devagar=3000    # uma a cada 3s, para ver chegando
 *   node scripts/seed-demo-matches.mjs --recorde         # UMA partida de topo (o modal de recorde)
 *   node scripts/seed-demo-matches.mjs --recorde --score=120000
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { selectFallbackPreset } from '../packages/shared/dist/index.js';

const raizRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (nome) => argv.includes(`--${nome}`);
const valor = (nome, padrao) => {
  const achado = argv.find((a) => a.startsWith(`--${nome}=`));
  return achado === undefined ? padrao : achado.slice(nome.length + 3);
};

const QUANTAS = Number(valor('n', '25'));
const ESTACAO = valor('estacao', 'demo-telao');
const SEMENTE = Number(valor('seed', '20260907'));
const SECO = flag('seco');
const RECORDE = flag('recorde');
const DEVAGAR_MS = Number(valor('devagar', '0'));

/**
 * Pontuação do `--recorde` quando não vem `--score=`. Confortavelmente acima do topo que este
 * script gera (ver PERFIS) e uma ordem de grandeza abaixo do `MAX_PLAUSIBLE_SCORE` de 500000 que
 * a ingestão recusa. Se o placar já tiver algo mais alto — porque alguém jogou de verdade —,
 * passe `--score=` com um número maior; este script não consulta o topo atual de propósito,
 * porque isso exigiria a senha do painel só para escolher um número.
 */
const SCORE_RECORDE = Number(valor('score', '92000'));

/** Lê `packages/daemon/.env` só como fonte de DEFAULTS — o ambiente do shell sempre vence. */
function lerEnvDoDaemon() {
  const arquivo = path.join(raizRepo, 'packages', 'daemon', '.env');
  if (!fs.existsSync(arquivo)) return {};
  const out = {};
  for (const linha of fs.readFileSync(arquivo, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(linha);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const envDaemon = lerEnvDoDaemon();
const CLOUD_BASE = (process.env.BOOTH_CLOUD_API_BASE || envDaemon.BOOTH_CLOUD_API_BASE || '').replace(/\/+$/, '');
const TOKEN = process.env.BOOTH_INGEST_TOKEN || envDaemon.BOOTH_INGEST_TOKEN || '';

/** Teto do lote em `POST /v1/matches` (MAX_BATCH_SIZE em cloud-api/src/index.ts). */
const MAX_LOTE = 50;

// ---------------------------------------------------------------------------
// Aleatoriedade determinística
// ---------------------------------------------------------------------------

/**
 * PRNG semeado (mulberry32), e não `Math.random()`: com a mesma `--seed` o placar sai idêntico.
 * Isso importa para o Bloco 27 — cronometrar a rolagem (27.2) e conferir a legibilidade do
 * primeiro e do último item (27.1) são medidas que só se comparam entre execuções se a lista
 * for a mesma. Os `match_id` continuam sendo UUID novo a cada execução; o que é reprodutível é
 * o CONTEÚDO, não a identidade.
 */
function criarRng(semente) {
  let a = semente >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = criarRng(SEMENTE);
const inteiroEntre = (min, max) => min + Math.floor(rng() * (max - min + 1));
const escolher = (lista) => lista[Math.floor(rng() * lista.length)];

function embaralhar(lista) {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

// ---------------------------------------------------------------------------
// Perfis de partida
// ---------------------------------------------------------------------------

/**
 * As três faixas de pontuação, calibradas em `BALANCE.score` (packages/shared) para o placar
 * parecer um evento e não um sorteio uniforme.
 *
 * O degrau entre `veterano` e `campeao` é de propósito e é a parte que importa: matar o boss
 * soma `points.boss` (10000) MAIS `boss_bonus` (10000) MAIS o tempo e a vida que sobraram,
 * enquanto quem só chega perto para no teto de `boss_damage_bonus_max` (3000). O placar real
 * tem essa descontinuidade, e um pódio gerado por faixa uniforme esconderia justamente o caso
 * em que o top 3 se destaca do resto — que é o que o modal de celebração existe para mostrar.
 */
const PERFIS = [
  {
    nome: 'novato',
    peso: 13,
    score: [3_500, 11_000],
    bossDefeated: false,
    duracao: [55, 95],
    abates: [8, 26],
    precisao: [28, 52]
  },
  {
    nome: 'veterano',
    peso: 9,
    score: [14_000, 29_000],
    bossDefeated: false,
    duracao: [110, 150],
    abates: [30, 58],
    precisao: [45, 68]
  },
  {
    nome: 'campeao',
    peso: 3,
    score: [46_000, 86_000],
    bossDefeated: true,
    duracao: [150, 205],
    abates: [55, 84],
    precisao: [58, 82]
  }
];

/** Alocações de energia distintas o bastante para os três presets de emergência aparecerem. */
const ALOCACOES = [
  { offense: 55, speed: 20, defense: 15, tech: 10 }, // striker
  { offense: 20, speed: 50, defense: 15, tech: 15 }, // interceptor
  { offense: 20, speed: 15, defense: 50, tech: 15 }, // vanguard
  { offense: 40, speed: 25, defense: 20, tech: 15 },
  { offense: 25, speed: 25, defense: 35, tech: 15 }
];

/**
 * Codinomes de demonstração. Curtos e em caixa alta como os de verdade — o painel do telão os
 * mostra em fonte monoespaçada e um nome comprido demais quebraria a linha, que é exatamente o
 * tipo de coisa que se quer ver na TV antes do evento e não durante.
 */
const CODINOMES = [
  'VIPER', 'NEBULA', 'ORION', 'KRAKEN', 'ZENITE', 'FALCAO', 'TEMPESTA', 'CORVO',
  'ARGO', 'PULSAR', 'LYNX', 'GAROA', 'TITAN', 'SIRIUS', 'JAGUAR', 'VORTEX',
  'ATLAS', 'CIGARRA', 'DRACO', 'MIRIM', 'QUASAR', 'PANTERA', 'HELIO', 'BOIUNA'
];

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function pedir(url, opcoes = {}) {
  const res = await fetch(url, opcoes);
  const texto = await res.text();
  let corpo;
  try {
    corpo = texto ? JSON.parse(texto) : null;
  } catch {
    corpo = texto;
  }
  return { status: res.status, corpo };
}

const nuvem = (rota, opcoes = {}) =>
  pedir(`${CLOUD_BASE}${rota}`, {
    ...opcoes,
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', ...(opcoes.headers || {}) }
  });

/**
 * Catálogo real da nuvem, com a lista de disco como rede de segurança. O fallback existe porque
 * o script continua útil sem rede de saída para o Cloud Run (modo `--seco`), e porque uma falha
 * de catálogo não deveria impedir a semeadura — mas ele é anunciado, já que os nomes de disco
 * podem estar defasados em relação ao que os estandes vão ver no dia.
 */
async function empresasDisponiveis() {
  if (CLOUD_BASE && TOKEN) {
    const { status, corpo } = await nuvem('/v1/companies');
    const lista = Array.isArray(corpo?.companies) ? corpo.companies.filter((c) => typeof c === 'string') : [];
    if (status === 200 && lista.length > 0) return { lista, origem: 'GET /v1/companies' };
  }
  const disco = JSON.parse(fs.readFileSync(path.join(raizRepo, 'config', 'companies.json'), 'utf8'));
  return { lista: disco.companies.filter((c) => typeof c === 'string'), origem: 'config/companies.json (disco)' };
}

// ---------------------------------------------------------------------------
// Geração
// ---------------------------------------------------------------------------

function perfilPara(indice, total) {
  // Distribui os perfis pelos pesos, e não por sorteio: com 25 partidas um sorteio ponderado
  // produz de zero a seis campeões dependendo da semente, e "zero campeões" é um placar sem
  // pódio destacado — justamente o que não serve para testar o Bloco 27.
  const pesoTotal = PERFIS.reduce((s, p) => s + p.peso, 0);
  const posicao = ((indice + 0.5) / total) * pesoTotal;
  let acumulado = 0;
  for (const p of PERFIS) {
    acumulado += p.peso;
    if (posicao <= acumulado) return p;
  }
  return PERFIS[PERFIS.length - 1];
}

/**
 * Monta uma partida coerente consigo mesma. A telemetria não é enfeite: o painel de admin
 * mostra esses campos, e um `boss_defeated: true` com 90 s de duração e 8 abates é o tipo de
 * incoerência que faz perder tempo investigando o produto durante um teste do produto.
 */
function montarPartida({ callsign, empresa, perfil, score, playedAt, pilotId }) {
  const sliders = escolher(ALOCACOES);
  const { spec } = selectFallbackPreset(sliders);

  const duracao = inteiroEntre(...perfil.duracao);
  const abates = inteiroEntre(...perfil.abates);
  const precisao = inteiroEntre(...perfil.precisao);
  const disparos = abates * inteiroEntre(6, 12) + inteiroEntre(20, 90);
  const acertos = Math.round((disparos * precisao) / 100);

  spec.pilot = { ...spec.pilot, callsign, company_canonical: empresa, company_raw: empresa, company_confidence: 1 };
  spec.build_metadata = { ...spec.build_metadata, fallback_used: true };

  // O detalhamento tem que somar o `final_score`, senão o painel de admin mostra um total que
  // não fecha com as parcelas. O combate absorve a diferença — é a parcela que de fato varia.
  const bossBonus = perfil.bossDefeated ? 10_000 : 0;
  const bossDamageBonus = perfil.bossDefeated ? 0 : perfil.nome === 'veterano' ? inteiroEntre(600, 3_000) : 0;
  const bossPhaseBonus = perfil.bossDefeated ? 1_500 : perfil.nome === 'veterano' ? inteiroEntre(0, 1_500) : 0;
  const timeBonus = perfil.bossDefeated ? inteiroEntre(1_000, 5_000) : 0;
  const survivalBonus = perfil.bossDefeated ? inteiroEntre(0, 6_000) : 0;
  const synergyBonus = rng() < 0.35 ? 2_000 : 0;
  const somaBonus = bossBonus + bossDamageBonus + bossPhaseBonus + timeBonus + survivalBonus + synergyBonus;
  const combatScore = Math.max(0, score - somaBonus);

  return {
    schema_version: 1,
    match_id: randomUUID(),
    pilot_id: pilotId,
    callsign,
    company_raw: empresa,
    company_canonical: empresa,
    company_confidence: 1,
    final_score: score,
    score_breakdown: {
      combatScore,
      bossBonus,
      timeBonus,
      survivalBonus,
      bossDamageBonus,
      bossPhaseBonus,
      synergyBonus,
      mcpMultiplier: 1
    },
    telemetry: {
      duration_s: duracao,
      enemies_killed: abates,
      boss_defeated: perfil.bossDefeated,
      damage_taken: inteiroEntre(10, 120),
      accuracy_pct: precisao,
      shots_fired: disparos,
      shots_hit: acertos,
      fallback_used: true,
      seed: inteiroEntre(1, 999_999),
      boss_ttk_s: perfil.bossDefeated ? inteiroEntre(25, 70) : null,
      boss_fight_min_fps: perfil.bossDefeated ? inteiroEntre(48, 60) : null,
      boss_damage_dealt: perfil.bossDefeated ? inteiroEntre(9_000, 12_000) : inteiroEntre(0, 7_000)
    },
    ship_spec_snapshot: spec,
    played_at: playedAt,
    created_at: playedAt,
    station_id: ESTACAO
  };
}

/**
 * O elenco: quantos pilotos, quantas empresas e quem joga onde.
 *
 * Duas propriedades são deliberadas, e as duas existem porque o telão as expõe:
 *
 * - Alguns pilotos jogam MAIS DE UMA VEZ. `pilots.matches_played` e `best_score` só acumulam
 *   nesse caso, e `pilots_count` da empresa só é testado contra dupla contagem nesse caso —
 *   `ingestOne` tem um ramo inteiro (`pilotIsNewToCompany`) que 25 pilotos distintos nunca
 *   tocariam.
 * - Algumas empresas têm três pilotos e outras têm um. O card do painel corporativo mostra a
 *   contagem, e uma lista onde todas têm 1 não mostra nada sobre o alinhamento do número.
 */
function montarElenco(empresas, quantas) {
  const empresasSorteadas = embaralhar(empresas).slice(0, Math.min(15, empresas.length));
  const codinomes = embaralhar(CODINOMES);

  // Um piloto a cada partida até faltar codinome, e daí em diante repete alguém já sorteado.
  const distintos = Math.min(codinomes.length, Math.max(1, quantas - 4));
  const pilotos = codinomes.slice(0, distintos).map((callsign, i) => ({
    callsign,
    pilotId: randomUUID(),
    empresa: empresasSorteadas[i % empresasSorteadas.length]
  }));

  const escalacao = [];
  for (let i = 0; i < quantas; i++) {
    escalacao.push(i < pilotos.length ? pilotos[i] : escolher(pilotos));
  }
  return { escalacao, empresasSorteadas, pilotos };
}

function gerarPartidas(empresas, quantas) {
  const { escalacao, empresasSorteadas, pilotos } = montarElenco(empresas, quantas);

  // `played_at` espalhado nas últimas 3 horas, em ordem crescente: o ticker LIVE FEED ordena por
  // este campo, e 25 partidas com o mesmo horário deixariam a ordem do rodapé indefinida.
  const agora = Date.now();
  const janelaMs = 3 * 60 * 60 * 1000;

  const partidas = escalacao.map((piloto, i) => {
    const perfil = perfilPara(i, quantas);
    const score = inteiroEntre(...perfil.score);
    const playedAt = new Date(agora - janelaMs + Math.round(((i + 1) / quantas) * janelaMs)).toISOString();
    return montarPartida({ ...piloto, perfil, score, playedAt });
  });

  return { partidas, empresasSorteadas, pilotos };
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function enviarLote(partidas) {
  const { status, corpo } = await nuvem('/v1/matches', {
    method: 'POST',
    body: JSON.stringify({ matches: partidas })
  });
  if (status !== 200) {
    throw new Error(`POST /v1/matches devolveu ${status}: ${JSON.stringify(corpo)}`);
  }
  return corpo;
}

/** `accepted` vem como LISTA de `match_id`, não como contagem — ver `IngestResult` em ingest.ts. */
const contarAceitas = (corpo) => (Array.isArray(corpo?.accepted) ? corpo.accepted.length : (corpo?.accepted ?? 0));

function relatarResultado(corpo) {
  const aceitas = contarAceitas(corpo);
  const recusadas = Array.isArray(corpo?.rejected) ? corpo.rejected : [];
  console.log(`\n  \x1b[32maceitas:\x1b[0m ${aceitas}`);
  if (recusadas.length > 0) {
    console.log(`  \x1b[31mrecusadas:\x1b[0m ${recusadas.length}`);
    for (const r of recusadas) console.log(`    ${r.match_id}: ${r.reason}`);
  }
  return recusadas.length === 0;
}

// ---------------------------------------------------------------------------
// Principal
// ---------------------------------------------------------------------------

async function principal() {
  if (!SECO) {
    const faltando = [];
    if (!CLOUD_BASE) faltando.push('BOOTH_CLOUD_API_BASE');
    if (!TOKEN) faltando.push('BOOTH_INGEST_TOKEN');
    if (faltando.length) {
      console.error(`\n[semear] faltam variáveis: ${faltando.join(', ')}`);
      console.error('[semear] use --seco para ver o que seria enviado sem precisar delas.');
      process.exit(1);
    }
  }

  const { lista: empresas, origem } = await empresasDisponiveis();

  console.log(`\n\x1b[1m── Semeadura de partidas de demonstração\x1b[0m`);
  console.log(`   nuvem     ${CLOUD_BASE || '(nenhuma — modo seco)'}`);
  console.log(`   estação   ${ESTACAO}   \x1b[90m(é por aqui que se apaga depois)\x1b[0m`);
  console.log(`   catálogo  ${empresas.length} empresas de ${origem}`);
  console.log(`   semente   ${SEMENTE}`);

  if (RECORDE) {
    const empresa = escolher(embaralhar(empresas).slice(0, 15));
    const partida = montarPartida({
      callsign: 'RECORDE',
      empresa,
      perfil: PERFIS[PERFIS.length - 1],
      score: SCORE_RECORDE,
      playedAt: new Date().toISOString(),
      pilotId: randomUUID()
    });
    console.log(`\n   uma partida de topo: RECORDE / ${empresa} / ${SCORE_RECORDE.toLocaleString('pt-BR')} pts`);
    console.log(`   \x1b[90mse o placar já tiver algo acima disso, rode de novo com --score=<maior>\x1b[0m`);
    if (SECO) {
      console.log('\n   [seco] nada enviado.');
      return;
    }
    relatarResultado(await enviarLote([partida]));
    console.log('\n   Olhe o telão: o modal de celebração deve subir e, se o painel do Antigravity');
    console.log('   estiver no ar e segurado, ele deve CORTAR para o placar (passo 27.7).');
    return;
  }

  if (QUANTAS > MAX_LOTE && DEVAGAR_MS === 0) {
    console.error(`\n[semear] ${QUANTAS} passa do lote máximo de ${MAX_LOTE}. Use --devagar= para enviar uma a uma.`);
    process.exit(1);
  }

  const { partidas, empresasSorteadas, pilotos } = gerarPartidas(empresas, QUANTAS);
  const porScore = [...partidas].sort((a, b) => b.final_score - a.final_score);

  console.log(`\n   ${partidas.length} partidas · ${pilotos.length} pilotos distintos · ${empresasSorteadas.length} empresas`);
  console.log(`   pódio    ${porScore.slice(0, 3).map((m) => `${m.callsign} ${m.final_score.toLocaleString('pt-BR')}`).join('  ·  ')}`);
  console.log(`   lanterna ${porScore[porScore.length - 1].callsign} ${porScore[porScore.length - 1].final_score.toLocaleString('pt-BR')}`);

  if (SECO) {
    console.log('\n   \x1b[1mprévia\x1b[0m');
    for (const m of porScore) {
      console.log(`   ${String(m.final_score).padStart(6)}  ${m.callsign.padEnd(9)} ${m.company_canonical}`);
    }
    console.log('\n   [seco] nada enviado.');
    return;
  }

  if (DEVAGAR_MS > 0) {
    console.log(`\n   enviando uma a cada ${DEVAGAR_MS}ms — o telão vai celebrar cada nova entrada no top 3.`);
    let aceitas = 0;
    for (const [i, m] of partidas.entries()) {
      const corpo = await enviarLote([m]);
      aceitas += contarAceitas(corpo);
      process.stdout.write(`\r   ${i + 1}/${partidas.length}  ${m.callsign.padEnd(9)} ${String(m.final_score).padStart(6)}   `);
      if (i < partidas.length - 1) await dormir(DEVAGAR_MS);
    }
    console.log(`\n\n  \x1b[32maceitas:\x1b[0m ${aceitas}`);
  } else {
    console.log(`\n   \x1b[33mAVISO:\x1b[0m em lote único, um telão JÁ ABERTO recebe as ${partidas.length} de uma vez e`);
    console.log('   enfileira uma celebração para cada uma que passar pelo top 3 — vários minutos de modal.');
    console.log('   Semeie com o telão fechado e recarregue depois, ou use --devagar= para ver chegando.\n');
    relatarResultado(await enviarLote(partidas));
  }

  console.log('\n   \x1b[1mPara apagar tudo depois\x1b[0m');
  console.log(`   Painel → Partidas → Estação: ${ESTACAO} → Buscar → selecionar tudo → Apagar`);
  console.log('   Isso recalcula company_rankings e pilots; as empresas voltam a zero e somem do telão.');
}

principal().catch((err) => {
  console.error(`\n[semear] ${err?.message || err}`);
  process.exit(1);
});
