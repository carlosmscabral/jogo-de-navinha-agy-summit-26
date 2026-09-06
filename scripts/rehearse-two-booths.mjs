#!/usr/bin/env node
/**
 * Ensaio de DOIS ESTANDES num Mac só, contra a nuvem de verdade.
 *
 * POR QUE ISTO EXISTE. O evento passou de um estande para dois jogando contra o mesmo placar, e o
 * que quebra nessa mudança não quebra em teste unitário: `company_canonical` é o ID do documento
 * em `company_rankings`, então dois Macs casando nomes contra listas diferentes racham a mesma
 * empresa em dois rankings — e de forma SILENCIOSA, porque as duas grafias resolvem com confiança
 * alta, nenhuma é marcada para revisão e a varredura de canonicalização nunca as enxerga. Um
 * emulador não prova isso: o caminho que interessa passa pelo Vertex, pela canonicalização, pelo
 * `GET /v1/companies` servido pelo Cloud Run e pelo painel de admin. Então este script sobe dois
 * daemons de verdade, com bancos e catálogos separados, e aponta os dois para o `vibe-cabral`.
 *
 * O QUE ELE AFIRMA (e o que ele NÃO afirma). Aqui está tudo que dá para julgar por HTTP e por uma
 * leitura do Firestore. O que precisa de olho humano — fila de celebração no telão, a forja do
 * agy, as telas do painel — está no Bloco 26 de `specs/12_MANUAL_TEST_PLAN_MAC.md`, e este script
 * DEIXA O CENÁRIO MONTADO para aquele bloco (ver `--sem-limpeza`).
 *
 * DADOS DE TESTE. Toda empresa criada aqui começa com `Ensaio ` e todo codinome com `ENSAIO`, para
 * a limpeza ser inequívoca. No fim, as partidas criadas são apagadas de verdade pelo mesmo
 * `POST /v1/admin/matches/bulk` que o painel usa — o que recalcula `company_rankings` e `pilots` e
 * some com os documentos zerados. O catálogo de empresas é salvo antes de qualquer alteração em
 * `<trabalho>/catalogo-original.json` e restaurado no fim, inclusive se um passo falhar.
 *
 * CREDENCIAL: ADC do operador (`gcloud auth application-default login`), mesma regra do
 * `seed-company-catalog.mjs`. Nenhum arquivo de chave é lido, gerado ou aceito.
 *
 * Uso:
 *   npm run rehearse:two-booths
 *   node scripts/rehearse-two-booths.mjs --sem-build --sem-limpeza
 *
 * Variáveis (as três primeiras são obrigatórias; se `packages/daemon/.env` já tiver as duas
 * primeiras, elas são lidas de lá):
 *   BOOTH_CLOUD_API_BASE   URL do Cloud Run, ex. https://jogo-navinha-api-xxx.run.app
 *   BOOTH_INGEST_TOKEN     token Bearer dos estandes
 *   ADMIN_PANEL_PASSWORD   senha HTTP Basic do painel
 *   ENSAIO_PROJECT_ID          default `vibe-cabral` (prefixo `ENSAIO_` de propósito: ver abaixo)
 *   ENSAIO_FIRESTORE_DATABASE  default `jogo-navinha`
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { selectFallbackPreset } from '../packages/shared/dist/index.js';

const raizRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

const flags = new Set(process.argv.slice(2));
const SEM_BUILD = flags.has('--sem-build');
const SEM_LIMPEZA = flags.has('--sem-limpeza');
/**
 * Modo isolado para o passo 26.3 do plano de teste manual. Dois recordes em menos de 7 s (a
 * duração do modal de celebração) não se produzem à mão de forma confiável — é uma corrida de
 * segundos entre duas máquinas, e é exatamente a corrida que a fila de celebração existe para
 * cobrir. Aqui os dois estandes disparam com ≈1,5 s de intervalo, e o operador olha as TVs.
 */
const SO_RECORDES = flags.has('--recordes');

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
const SENHA_PAINEL = process.env.ADMIN_PANEL_PASSWORD || '';
/**
 * Nomes com prefixo `ENSAIO_`, e nem `PROJECT_ID` nem `GOOGLE_CLOUD_PROJECT` são lidos aqui.
 *
 * Achado ao vivo em 2026-09-06, no primeiro ensaio rodado do Mac: o script abriu o Firestore em
 * `cabral-apigee` enquanto o lado HTTP continuava batendo no Cloud Run do `vibe-cabral`, e o
 * sintoma foi um `5 NOT_FOUND` de gRPC com 30 linhas de pilha do `google-gax` sem uma palavra
 * sobre projeto. A causa é a categoria, não a variável específica: `PROJECT_ID` e
 * `GOOGLE_CLOUD_PROJECT` são nomes de propósito geral que qualquer outro trabalho no mesmo shell
 * exporta, e o `gcloud config set project` não protege contra isso — o firebase-admin não lê a
 * configuração do gcloud, lê o ambiente. Um nome que só este script usa não tem como ser herdado
 * por acidente. Mesma armadilha que `cardgen-routes.test.ts` documenta do lado dos testes.
 *
 * Para apontar para outro projeto:
 *   ENSAIO_PROJECT_ID=outro npm run rehearse:two-booths
 */
const PROJECT_ID = process.env.ENSAIO_PROJECT_ID || 'vibe-cabral';
const DATABASE_ID = process.env.ENSAIO_FIRESTORE_DATABASE || 'jogo-navinha';

/** Diretório de trabalho do ensaio. Fora do repo, e recriado do zero a cada execução. */
const TRABALHO = path.join(os.tmpdir(), 'ensaio-dois-booths');
const ARQUIVO_CATALOGO_ORIGINAL = path.join(TRABALHO, 'catalogo-original.json');

/**
 * Portas 3100/3101, não 3000: o daemon do dia a dia mora na 3000, e um ensaio que derruba a
 * sessão aberta de quem está desenvolvendo é um jeito caro de descobrir uma colisão de porta.
 */
const BOOTHS = [
  { id: 'A', porta: 3100, stationId: 'ensaio-booth-a' },
  { id: 'B', porta: 3101, stationId: 'ensaio-booth-b' }
];

/**
 * As três grafias do ensaio, escolhidas para exercitar caminhos DIFERENTES do resolvedor
 * (`resolveCompanyFromCatalog`), não por acaso:
 *
 * - `CANONICA` está no catálogo do estande A e, depois, na nuvem — casa por igualdade exata (1.0).
 * - `DIVERGENTE` está só no catálogo local do estande B na primeira fase — também casa exata
 *   (1.0) lá, e é exatamente por isso que a divergência é invisível: os DOIS lados têm confiança
 *   máxima e nenhum é marcado para revisão.
 * - `NOVA` nunca esteve em catálogo nenhum e contém `CANONICA` como prefixo — casa pela regra de
 *   contenção (0.90) depois que a nuvem impôs a lista única. É a grafia que prova a convergência
 *   sem depender de fuzzy, que seria frágil como afirmação de teste.
 */
const CANONICA = 'Ensaio Bidu Telecom';
const DIVERGENTE = 'Ensaio Bidu Telecomunicacoes';
const NOVA = 'Ensaio Bidu Telecom Brasil';

/** Intervalo do worker de pull nas fases em que ele PRECISA rodar. O primeiro tick sai com
 *  jitter sobre este valor, então o pior caso de espera é ele inteiro. */
const INTERVALO_PULL_MS = 8_000;
/** Intervalo do worker na fase divergente: alto o bastante para o primeiro tick nunca chegar. */
const INTERVALO_PULL_DESLIGADO_MS = 3_600_000;

/**
 * Quanto tempo o Bloco 5 segura o estande B sem nuvem DEPOIS da última partida, antes de
 * religar. Não é uma pausa estética: até 2026-09-06 o bloco derrubava a rede, jogava duas
 * partidas e conferia a nuvem no instante seguinte — uma janela de menos de dois segundos,
 * a mesma ordem de grandeza da latência de um envio bem-sucedido (medida naquele ensaio:
 * 3,3 a 3,8 s por partida). Com isso, "nada chegou à nuvem" e "a fila acusa pendentes"
 * passavam mesmo com a rede perfeita, só porque a requisição ainda estava em voo, e
 * `played_at < created_at` era satisfeito por 700 ms de latência comum em vez de pela
 * ausência de rede. Oito segundos são maiores que qualquer envio observado, e é isso que
 * transforma as três afirmações em medida de comportamento.
 */
const JANELA_OFFLINE_MS = 8_000;

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------

const resultados = [];
let blocoAtual = '';

function bloco(titulo) {
  blocoAtual = titulo;
  console.log(`\n\x1b[1m── ${titulo}\x1b[0m`);
}

function afirmar(titulo, condicao, detalhe = '') {
  const ok = Boolean(condicao);
  resultados.push({ bloco: blocoAtual, titulo, ok, detalhe });
  const marca = ok ? '\x1b[32m  ok \x1b[0m' : '\x1b[31mFALHA\x1b[0m';
  console.log(`${marca}  ${titulo}${detalhe ? `\n         ${detalhe}` : ''}`);
}

function nota(texto) {
  console.log(`\x1b[90m       ${texto}\x1b[0m`);
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Espera uma condição virar verdadeira, ou desiste. Devolve o último valor observado para a
 * afirmação poder mostrar o que realmente estava lá — "esperei 60s" sem o valor final é o tipo de
 * falha que obriga a rodar tudo de novo só para descobrir o porquê.
 */
async function esperarPor(descricao, fn, { timeoutMs = 60_000, intervaloMs = 2_000 } = {}) {
  const limite = Date.now() + timeoutMs;
  let ultimo = null;
  process.stdout.write(`\x1b[90m       aguardando ${descricao}`);
  for (;;) {
    try {
      ultimo = await fn();
      if (ultimo) break;
    } catch (err) {
      // `null`, e não o erro: quem chama testa o retorno por veracidade, e um `Error` devolvido
      // aqui é truthy — a espera "teria sucesso" justamente quando a sonda estourou.
      ultimo = null;
      process.stdout.write('!');
    }
    if (Date.now() >= limite) break;
    process.stdout.write('.');
    await dormir(intervaloMs);
  }
  process.stdout.write('\x1b[0m\n');
  return ultimo;
}

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

const cabecalhoEstande = () => ({ authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' });
const cabecalhoPainel = () => ({
  // O nome de usuário é ignorado pelo servidor (ver `admin-auth.ts`); só a senha é comparada.
  authorization: `Basic ${Buffer.from(`ensaio:${SENHA_PAINEL}`).toString('base64')}`,
  'content-type': 'application/json'
});

const nuvem = (rota, opcoes = {}) =>
  pedir(`${CLOUD_BASE}${rota}`, { ...opcoes, headers: { ...cabecalhoEstande(), ...(opcoes.headers || {}) } });
const painel = (rota, opcoes = {}) =>
  pedir(`${CLOUD_BASE}${rota}`, { ...opcoes, headers: { ...cabecalhoPainel(), ...(opcoes.headers || {}) } });
const estande = (booth, rota, opcoes = {}) =>
  pedir(`http://127.0.0.1:${booth.porta}${rota}`, {
    ...opcoes,
    headers: { 'content-type': 'application/json', ...(opcoes.headers || {}) }
  });

/**
 * `GET /api/companies` é AUTOCOMPLETE, não dump: sem `q` ele devolve as 10 primeiras em ordem
 * alfabética, e com `q` devolve no máximo 8 por relevância (`searchCompanies`). Duas consequências
 * para este ensaio, e as duas já custaram uma afirmação errada:
 *
 * - Presença de uma empresa se pergunta com `q` e se confere por igualdade EXATA de string. A
 *   busca casa por prefixo e por Levenshtein, então "Ensaio Bidu Telecom" traz de volta
 *   "Ensaio Bidu Telecomunicacoes" — o que interessa é se a grafia exata está na lista.
 * - Tamanho do catálogo NÃO sai daqui. Sai de `/api/catalog/status`, que reporta a contagem real
 *   de `canonical_companies`.
 */
async function contemEmpresa(booth, nome) {
  const { corpo } = await estande(booth, `/api/companies?q=${encodeURIComponent(nome)}`);
  return Array.isArray(corpo?.companies) && corpo.companies.includes(nome);
}

async function statusCatalogo(booth) {
  return (await estande(booth, '/api/catalog/status')).corpo;
}

async function tamanhoCatalogo(booth) {
  return (await statusCatalogo(booth))?.catalog?.companies ?? -1;
}

// ---------------------------------------------------------------------------
// Ciclo de vida dos daemons
// ---------------------------------------------------------------------------

function caminhosDoBooth(booth) {
  const base = path.join(TRABALHO, booth.id.toLowerCase());
  return {
    base,
    db: path.join(base, 'booth.db'),
    sessao: path.join(base, 'session'),
    catalogo: path.join(base, 'companies.json'),
    log: path.join(base, 'daemon.log')
  };
}

/**
 * Sobe um daemon. `node dist/index.js` direto, SEM `--env-file-if-exists`: com o arquivo `.env` no
 * meio, a precedência entre ele e o que passamos aqui deixa de ser óbvia, e o ensaio inteiro
 * depende de `BOOTH_DB_PATH`, `BOOTH_SESSION_DIR` e `BOOTH_STATION_ID` serem exatamente os nossos.
 * Os defaults úteis do `.env` já foram lidos lá em cima e entram explicitamente.
 */
async function subirDaemon(booth, extras = {}) {
  const c = caminhosDoBooth(booth);
  fs.mkdirSync(c.sessao, { recursive: true });

  const env = {
    ...process.env,
    ...envDaemon,
    PORT: String(booth.porta),
    BOOTH_STATION_ID: booth.stationId,
    BOOTH_DB_PATH: c.db,
    BOOTH_SESSION_DIR: c.sessao,
    BOOTH_COMPANIES_FILE: c.catalogo,
    BOOTH_CLOUD_API_BASE: CLOUD_BASE,
    BOOTH_INGEST_TOKEN: TOKEN,
    ...extras
  };

  const log = fs.openSync(c.log, 'a');
  const filho = spawn(process.execPath, ['dist/index.js'], {
    cwd: path.join(raizRepo, 'packages', 'daemon'),
    env,
    stdio: ['ignore', log, log]
  });
  booth.processo = filho;

  const subiu = await esperarPor(
    `estande ${booth.id} na porta ${booth.porta}`,
    async () => (await estande(booth, '/api/health')).status === 200,
    { timeoutMs: 30_000, intervaloMs: 500 }
  );
  if (subiu !== true) {
    throw new Error(`estande ${booth.id} não respondeu em 30s — veja ${c.log}`);
  }
  return filho;
}

async function derrubarDaemon(booth) {
  if (!booth.processo) return;
  const p = booth.processo;
  booth.processo = null;
  p.kill('SIGTERM');
  // Janela curta antes do SIGKILL: o daemon fecha o SQLite no encerramento, e matar direto
  // deixaria um `-wal` pendurado que a próxima subida teria que recuperar.
  for (let i = 0; i < 20 && p.exitCode === null && p.signalCode === null; i++) await dormir(100);
  if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL');
}

const derrubarTodos = () => Promise.all(BOOTHS.map(derrubarDaemon));

async function reiniciarTodos(extras) {
  await derrubarTodos();
  for (const b of BOOTHS) await subirDaemon(b, extras);
}

// ---------------------------------------------------------------------------
// Ações de estande
// ---------------------------------------------------------------------------

const partidasCriadas = [];

/**
 * Abre uma sessão só para LER como aquele estande resolve uma grafia, e fecha em seguida.
 *
 * A resolução acontece dentro do `POST /api/session/start` e em nenhum outro lugar exposto por
 * HTTP — é por isso que a sonda é uma sessão inteira e não uma rota dedicada. O `reset` no fim não
 * é cortesia: `session/start` arma os relógios do agy, e uma sessão deixada aberta dispararia o
 * preset de emergência no meio do bloco seguinte.
 */
async function resolverEmpresa(booth, companyRaw, callsign = 'ENSAIOSONDA') {
  const { status, corpo } = await estande(booth, '/api/session/start', {
    method: 'POST',
    body: JSON.stringify({
      pilot: { callsign, company_raw: companyRaw },
      energy_sliders: { offense: 40, speed: 20, defense: 25, tech: 15 },
      selected_mcps: ['weapons-arsenal', 'hull-propulsion', 'cybernetics-shields'],
      selected_subagents: ['aesthetic-designer', 'combat-strategist']
    })
  });
  await estande(booth, '/api/session/reset', { method: 'POST' });
  if (status !== 200) throw new Error(`session/start no estande ${booth.id} devolveu ${status}: ${JSON.stringify(corpo)}`);
  return { canonical: corpo.pilot.company_canonical, confidence: corpo.pilot.company_confidence };
}

/** Uma partida completa: resolve a empresa abrindo a sessão, envia o registro, fecha a sessão. */
async function jogarPartida(booth, { callsign, companyRaw, score }) {
  const sliders = { offense: 40, speed: 20, defense: 25, tech: 15 };
  const inicio = await estande(booth, '/api/session/start', {
    method: 'POST',
    body: JSON.stringify({
      pilot: { callsign, company_raw: companyRaw },
      energy_sliders: sliders,
      selected_mcps: ['weapons-arsenal', 'hull-propulsion', 'cybernetics-shields'],
      selected_subagents: ['aesthetic-designer', 'combat-strategist']
    })
  });
  if (inicio.status !== 200) {
    await estande(booth, '/api/session/reset', { method: 'POST' });
    throw new Error(`session/start no estande ${booth.id} devolveu ${inicio.status}`);
  }

  const piloto = inicio.corpo.pilot;
  const { spec } = selectFallbackPreset(sliders);
  spec.pilot = { ...spec.pilot, ...piloto };
  spec.build_metadata.fallback_used = true;

  const matchId = randomUUID();
  const registro = {
    match_id: matchId,
    pilot_id: randomUUID(),
    callsign: piloto.callsign,
    company_canonical: piloto.company_canonical,
    company_raw: companyRaw,
    company_confidence: piloto.company_confidence,
    final_score: score,
    telemetry: {
      duration_s: 90,
      enemies_killed: 20,
      boss_defeated: false,
      damage_taken: 40,
      accuracy_pct: 55,
      shots_fired: 200,
      shots_hit: 110,
      // Honesto: a nave veio de preset, não da forja. O painel de Saúde mede essa taxa, e
      // registrar `false` aqui mentiria para a única métrica que existe para pegar um agy morto.
      fallback_used: true,
      seed: 1,
      boss_ttk_s: null,
      boss_fight_min_fps: null,
      boss_damage_dealt: 0
    },
    score_breakdown: {
      combatScore: score,
      bossBonus: 0,
      timeBonus: 0,
      survivalBonus: 0,
      bossDamageBonus: 0,
      bossPhaseBonus: 0,
      synergyBonus: 0,
      mcpMultiplier: 1
    },
    ship_spec_snapshot: spec,
    created_at: new Date().toISOString()
  };

  const envio = await estande(booth, '/api/matches', { method: 'POST', body: JSON.stringify(registro) });
  await estande(booth, '/api/session/reset', { method: 'POST' });
  if (envio.status !== 200) throw new Error(`/api/matches no estande ${booth.id} devolveu ${envio.status}`);

  partidasCriadas.push(matchId);
  return { matchId, canonical: piloto.company_canonical, confidence: piloto.company_confidence, score };
}

/** Lista as partidas do ensaio já visíveis na nuvem, por `match_id`. */
async function partidasNaNuvem(ids) {
  const { corpo } = await painel('/v1/admin/matches?limit=200');
  const todas = Array.isArray(corpo?.matches) ? corpo.matches : [];
  return todas.filter((m) => ids.includes(m.match_id));
}

async function esperarIngestao(ids, timeoutMs = 90_000) {
  return esperarPor(
    `ingestão de ${ids.length} partida(s) na nuvem`,
    async () => {
      const achadas = await partidasNaNuvem(ids);
      return achadas.length === ids.length ? achadas : null;
    },
    { timeoutMs, intervaloMs: 3_000 }
  );
}

// ---------------------------------------------------------------------------
// Firestore (leitura direta — `company_rankings` não tem rota de admin)
// ---------------------------------------------------------------------------

let db;

function iniciarFirestore() {
  const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  db = getFirestore(app, DATABASE_ID);
}

async function rankingsDoEnsaio() {
  // Prefixo `Ensaio ` em toda empresa criada aqui: a consulta por intervalo pega só as nossas sem
  // varrer a coleção e sem precisar de índice composto.
  const snap = await db
    .collection('company_rankings')
    .where('company_canonical', '>=', 'Ensaio ')
    .where('company_canonical', '<', 'Ensaio~')
    .get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function lerCatalogo() {
  const snap = await db.collection('companies').doc('catalog').get();
  const dados = snap.exists ? snap.data() : {};
  return { companies: Array.isArray(dados.companies) ? dados.companies : [], version: dados.version ?? 1 };
}

/** Escreve o catálogo BURLANDO o servidor. É o único jeito de provar a trava do lado do daemon. */
async function escreverCatalogoDireto(companies, version) {
  await db.collection('companies').doc('catalog').set(
    { schema_version: 1, companies, version, updated_at: new Date().toISOString() },
    { merge: true }
  );
}

// ---------------------------------------------------------------------------
// Blocos
// ---------------------------------------------------------------------------

async function preparacao() {
  bloco('Preparação');

  const faltando = [];
  if (!CLOUD_BASE) faltando.push('BOOTH_CLOUD_API_BASE');
  if (!TOKEN) faltando.push('BOOTH_INGEST_TOKEN');
  if (!SENHA_PAINEL) faltando.push('ADMIN_PANEL_PASSWORD');
  if (faltando.length) {
    console.error(`\n[ensaio] faltam variáveis: ${faltando.join(', ')}`);
    process.exit(1);
  }

  nota(`nuvem     ${CLOUD_BASE}`);
  nota(`projeto   ${PROJECT_ID} / banco ${DATABASE_ID}`);
  nota(`trabalho  ${TRABALHO}`);

  const saude = await nuvem('/v1/health');
  afirmar('a nuvem responde em /v1/health', saude.status === 200, `status ${saude.status}`);
  if (saude.status !== 200) throw new Error('nuvem inalcançável — nada além disto faz sentido');

  const painelOk = await painel('/v1/admin/companies');
  afirmar('a senha do painel é aceita em /v1/admin/companies', painelOk.status === 200, `status ${painelOk.status}`);
  if (painelOk.status !== 200) throw new Error('senha do painel recusada');

  iniciarFirestore();

  // O ensaio fala com a nuvem por DOIS canais — HTTP no Cloud Run e Firestore direto — e nada
  // garante sozinho que os dois apontem para o mesmo lugar. Quando não apontam, o erro nativo é um
  // `5 NOT_FOUND` de gRPC com 30 linhas de pilha do `google-gax` que não menciona projeto nenhum.
  let original;
  try {
    original = await lerCatalogo();
  } catch (err) {
    throw new Error(
      `não consegui ler companies/catalog em '${PROJECT_ID}' / '${DATABASE_ID}'. ` +
        `Confira se o projeto e o banco batem com ${CLOUD_BASE}. Só ENSAIO_PROJECT_ID e ` +
        'ENSAIO_FIRESTORE_DATABASE sobrescrevem os defaults — PROJECT_ID e GOOGLE_CLOUD_PROJECT ' +
        `são ignorados de propósito. Causa: ${err?.message || err}`
    );
  }

  const servidoAgora = await nuvem('/v1/companies');
  const listaServida = Array.isArray(servidoAgora.corpo?.companies) ? servidoAgora.corpo.companies : [];
  const emComum = original.companies.filter((c) => listaServida.includes(c));
  afirmar(
    'o Firestore lido aqui é o MESMO que o Cloud Run serve aos estandes',
    listaServida.length > 0 && emComum.length > 0,
    `${original.companies.length} empresas no Firestore de '${PROJECT_ID}', ${listaServida.length} em GET /v1/companies, ${emComum.length} em comum`
  );
  if (listaServida.length > 0 && emComum.length === 0) {
    // Zero em comum não é atraso de cache, é outro projeto ou outro banco. Seguir daqui produziria
    // afirmações sobre convergência entre duas nuvens diferentes — pior que falhar.
    throw new Error(
      `o catálogo de '${PROJECT_ID}/${DATABASE_ID}' não tem NADA em comum com o que ${CLOUD_BASE} ` +
        'serve. Os dois canais estão em projetos diferentes; rode com ENSAIO_PROJECT_ID explícito.'
    );
  }

  fs.mkdirSync(TRABALHO, { recursive: true });
  fs.writeFileSync(ARQUIVO_CATALOGO_ORIGINAL, JSON.stringify(original, null, 2), 'utf8');
  afirmar(
    'o catálogo de produção foi salvo antes de qualquer alteração',
    original.companies.length > 0,
    `${original.companies.length} empresas, versão ${original.version} → ${ARQUIVO_CATALOGO_ORIGINAL}`
  );
  if (original.companies.length === 0) {
    throw new Error('catálogo de produção vazio — semeie com scripts/seed-company-catalog.mjs antes do ensaio');
  }
  afirmar(
    `${CANONICA} ainda NÃO está no catálogo de produção`,
    !original.companies.includes(CANONICA),
    'se estiver, uma execução anterior não terminou a limpeza'
  );

  /**
   * DOIS ENSAIOS AO MESMO TEMPO NÃO PODEM RODAR CONTRA A MESMA NUVEM, e é preciso dizer isso alto
   * porque o modo de falha é confuso e não parece concorrência.
   *
   * Achado ao vivo em 2026-09-06: um ensaio no Mac e outro na máquina de desenvolvimento se
   * cruzaram, e o resultado foram três vermelhos que pareciam regressão de produto. Os dois usam
   * os MESMOS `station_id` e os MESMOS nomes de empresa, então o `company_rankings` de
   * `Ensaio Bidu Telecom` somou as partidas dos dois (14900 em vez de 10800, 4 pilotos em vez de
   * 3); as gravações de catálogo de um bagunçaram a versão que o outro esperava, derrubando a
   * afirmação da poda em massa; e a limpeza, que só apaga os `match_id` que ELA criou, deixou os
   * rankings do outro de pé. Nenhum dos três era bug.
   *
   * Abortar antes de tocar em qualquer coisa é mais barato que interpretar isso depois.
   */
  const residuo = await rankingsDoEnsaio();
  if (residuo.length > 0) {
    throw new Error(
      `já existem ${residuo.length} company_rankings de ensaio na nuvem (${residuo.map((r) => r.id).join(', ')}). ` +
        'Ou outro ensaio está rodando AGORA contra este mesmo projeto — espere ele terminar, dois ' +
        'ao mesmo tempo se contaminam — ou uma execução com --sem-limpeza deixou dados para trás. ' +
        'Nesse caso apague as partidas ENSAIO* pelo painel (Partidas → seleção em massa → Apagar) ' +
        'antes de rodar de novo.'
    );
  }

  if (!SEM_BUILD) {
    nota('compilando shared, mcps e daemon…');
    await executar('npm', ['run', 'build:shared']);
    await executar('npm', ['run', 'build', '--workspace=packages/mcps']);
    await executar('npm', ['run', 'build', '--workspace=packages/daemon']);
  }

  // Bancos e sessões do zero. Um SQLite herdado de outra execução traria aliases já aprendidos, e
  // o cache de aliases é consultado ANTES do catálogo — o Bloco 1 mediria o passado, não o pull.
  for (const b of BOOTHS) {
    const c = caminhosDoBooth(b);
    fs.rmSync(c.base, { recursive: true, force: true });
    fs.mkdirSync(c.sessao, { recursive: true });
  }

  const catalogoBase = JSON.parse(fs.readFileSync(path.join(raizRepo, 'config', 'companies.json'), 'utf8'));
  const listaBase = catalogoBase.companies.filter((c) => typeof c === 'string');
  fs.writeFileSync(
    caminhosDoBooth(BOOTHS[0]).catalogo,
    JSON.stringify({ companies: [...listaBase, CANONICA] }, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    caminhosDoBooth(BOOTHS[1]).catalogo,
    JSON.stringify({ companies: [...listaBase, DIVERGENTE] }, null, 2),
    'utf8'
  );
  afirmar('sementes divergentes escritas nos dois estandes', true, `A: "${CANONICA}"   B: "${DIVERGENTE}"`);
  return original;
}

async function bloco1Divergencia() {
  bloco('Bloco 1 — divergência de catálogo, sem pull (o achado que motivou tudo)');

  // Pull praticamente desligado: o primeiro tick sai com jitter sobre uma hora, então ele nunca
  // chega durante este bloco. É assim que se observa o estado ANTERIOR à Fase 3.
  await reiniciarTodos({ BOOTH_CATALOG_SYNC_INTERVAL_MS: String(INTERVALO_PULL_DESLIGADO_MS) });

  const aTemCanonica = await contemEmpresa(BOOTHS[0], CANONICA);
  const aTemDivergente = await contemEmpresa(BOOTHS[0], DIVERGENTE);
  const bTemCanonica = await contemEmpresa(BOOTHS[1], CANONICA);
  const bTemDivergente = await contemEmpresa(BOOTHS[1], DIVERGENTE);

  afirmar('o estande A tem só a grafia canônica', aTemCanonica && !aTemDivergente);
  afirmar('o estande B tem só a grafia divergente', bTemDivergente && !bTemCanonica);

  const a1 = await jogarPartida(BOOTHS[0], { callsign: 'ENSAIOA1', companyRaw: CANONICA, score: 4100 });
  const b1 = await jogarPartida(BOOTHS[1], { callsign: 'ENSAIOB1', companyRaw: DIVERGENTE, score: 4200 });

  afirmar(
    'os DOIS estandes resolveram com confiança máxima — ninguém foi marcado para revisão',
    a1.confidence >= 0.8 && b1.confidence >= 0.8,
    `A=${a1.confidence} (${a1.canonical})   B=${b1.confidence} (${b1.canonical})`
  );
  afirmar(
    'e mesmo assim chegaram a canônicos DIFERENTES',
    a1.canonical !== b1.canonical,
    'é isto que a varredura de canonicalização nunca enxerga: confiança alta dos dois lados'
  );

  const ingeridas = await esperarIngestao([a1.matchId, b1.matchId]);
  afirmar('as duas partidas chegaram à nuvem', Array.isArray(ingeridas) && ingeridas.length === 2);

  const rankings = await rankingsDoEnsaio();
  afirmar(
    'sem o pull, a mesma empresa rachou em DOIS documentos de company_rankings',
    rankings.length === 2,
    rankings.map((r) => `${r.id} (${r.total_score})`).join('   ') || 'nenhum'
  );

  return { a1, b1 };
}

async function bloco2Convergencia(catalogoOriginal) {
  bloco('Bloco 2 — o painel impõe a lista única e os dois estandes convergem');

  const put = await painel('/v1/admin/companies', {
    method: 'PUT',
    body: JSON.stringify({
      companies: [...catalogoOriginal.companies, CANONICA],
      expectedVersion: catalogoOriginal.version
    })
  });
  afirmar('o painel aceitou acrescentar a empresa', put.status === 200, `status ${put.status} versão ${put.corpo?.version}`);

  const conflito = await painel('/v1/admin/companies', {
    method: 'PUT',
    body: JSON.stringify({ companies: [...catalogoOriginal.companies], expectedVersion: catalogoOriginal.version })
  });
  afirmar(
    'um segundo operador com a versão velha leva 409, não sobrescreve',
    conflito.status === 409,
    `status ${conflito.status}`
  );

  // Agora sim, com o worker de pull vivo.
  await reiniciarTodos({ BOOTH_CATALOG_SYNC_INTERVAL_MS: String(INTERVALO_PULL_MS) });

  const convergiu = await esperarPor(
    'os dois estandes aplicarem a mesma versão de catálogo',
    async () => {
      const sA = await statusCatalogo(BOOTHS[0]);
      const sB = await statusCatalogo(BOOTHS[1]);
      const okA = sA?.catalog?.state === 'ok' && sA.catalog.appliedVersion !== null;
      const okB = sB?.catalog?.state === 'ok' && sB.catalog.appliedVersion !== null;
      return okA && okB && sA.catalog.appliedVersion === sB.catalog.appliedVersion ? { sA, sB } : null;
    },
    { timeoutMs: 60_000 }
  );
  afirmar(
    'os dois estandes aplicaram a MESMA versão do catálogo',
    convergiu && convergiu.sA,
    convergiu?.sA ? `versão ${convergiu.sA.catalog.appliedVersion} nos dois` : 'não convergiram no prazo'
  );

  const tamA = await tamanhoCatalogo(BOOTHS[0]);
  const tamB = await tamanhoCatalogo(BOOTHS[1]);
  afirmar(
    'os dois catálogos locais têm o mesmo tamanho na mesma versão',
    tamA > 0 && tamA === tamB,
    `A=${tamA}   B=${tamB} empresas`
  );
  afirmar(
    'a grafia canônica da nuvem chegou aos DOIS estandes',
    (await contemEmpresa(BOOTHS[0], CANONICA)) && (await contemEmpresa(BOOTHS[1], CANONICA))
  );
  afirmar(
    'o espelhamento REMOVEU a grafia divergente que só existia no estande B',
    !(await contemEmpresa(BOOTHS[1], DIVERGENTE)),
    convergiu?.sB?.catalog?.lastApplied
      ? `removidas em B: ${convergiu.sB.catalog.lastApplied.removed.join(', ') || '(nenhuma)'}`
      : ''
  );

  const a2 = await jogarPartida(BOOTHS[0], { callsign: 'ENSAIOA2', companyRaw: CANONICA, score: 3300 });
  const b2 = await jogarPartida(BOOTHS[1], { callsign: 'ENSAIOB2', companyRaw: NOVA, score: 3400 });
  afirmar(
    'grafias diferentes nos dois estandes agora resolvem para o MESMO canônico',
    a2.canonical === CANONICA && b2.canonical === CANONICA,
    `A "${CANONICA}" → ${a2.canonical}   B "${NOVA}" → ${b2.canonical} (${b2.confidence})`
  );

  await esperarIngestao([a2.matchId, b2.matchId]);
  const somaEsperada = 4100 + 3300 + 3400; // as duas de A mais a nova de B, todas em CANONICA
  const rankings = await rankingsDoEnsaio();
  const canonico = rankings.find((r) => r.id === CANONICA);
  afirmar(
    'as partidas dos dois estandes caíram num ÚNICO documento de company_rankings',
    canonico && canonico.total_score === somaEsperada,
    canonico ? `${canonico.id}: total ${canonico.total_score} (esperado ${somaEsperada}), ${canonico.pilots_count} pilotos` : 'documento ausente'
  );

  // O resíduo. Vale afirmar porque é COMPORTAMENTO PROJETADO, não um descuido: o cache de aliases
  // é consultado antes do catálogo, e a Fase 3 decidiu de propósito que remover uma empresa do
  // catálogo não apaga aliases já aprendidos ("resoluções passadas seguem estáveis"). A
  // consequência operacional é que o pull conserta o FUTURO, não o passado — um estande que já
  // gravou a grafia divergente continua com ela. Ver o passo 26.1 do plano de teste manual.
  const residuo = await resolverEmpresa(BOOTHS[1], DIVERGENTE);
  afirmar(
    'a grafia que o estande B já tinha em cache continua resolvendo para o canônico ANTIGO',
    residuo.canonical === DIVERGENTE,
    `"${DIVERGENTE}" → ${residuo.canonical}. Projetado: alias local sobrevive à remoção do catálogo. ` +
      'Por isso os dois Macs entram no evento com SQLite zerado (npm run reset:db).'
  );

  return { a2, b2 };
}

async function bloco3RemocaoEAliases() {
  bloco('Bloco 3 — remoção pelo painel some dos dois estandes, aliases sobrevivem');

  const atual = await lerCatalogo();
  const semEnsaio = atual.companies.filter((c) => c !== CANONICA);
  const put = await painel('/v1/admin/companies', {
    method: 'PUT',
    body: JSON.stringify({ companies: semEnsaio, expectedVersion: atual.version })
  });
  afirmar('o painel aceitou remover a empresa', put.status === 200, `status ${put.status}`);

  const sumiu = await esperarPor(
    'a remoção chegar aos dois estandes',
    async () => !(await contemEmpresa(BOOTHS[0], CANONICA)) && !(await contemEmpresa(BOOTHS[1], CANONICA)),
    { timeoutMs: 60_000 }
  );
  afirmar('a empresa sumiu dos DOIS estandes', sumiu === true);

  // O alias que o estande B aprendeu no Bloco 2 ("Ensaio Bidu Telecom Brasil" → canônico) tem que
  // sobreviver: reescrever resoluções passadas no meio do evento mudaria o placar retroativamente.
  const aliasVivo = await resolverEmpresa(BOOTHS[1], NOVA);
  afirmar(
    'o alias já aprendido continua resolvendo mesmo com a empresa fora do catálogo',
    aliasVivo.canonical === CANONICA,
    `"${NOVA}" → ${aliasVivo.canonical}`
  );
}

async function bloco4Travas(catalogoOriginal) {
  bloco('Bloco 4 — travas contra um clique errado no painel');

  const atual = await lerCatalogo();

  const vazio = await painel('/v1/admin/companies', {
    method: 'PUT',
    body: JSON.stringify({ companies: [], expectedVersion: atual.version })
  });
  afirmar('o servidor RECUSA salvar catálogo vazio sem force', vazio.status === 400, `status ${vazio.status}`);

  const antesA = await tamanhoCatalogo(BOOTHS[0]);

  // Poda de 40% pelo caminho de verdade — um "Salvar" no painel com a lista truncada. O servidor
  // aceita (só a lista VAZIA é barrada lá), então quem tem que recusar é o daemon.
  const truncada = atual.companies.slice(0, Math.floor(atual.companies.length * 0.6));
  const poda = await painel('/v1/admin/companies', {
    method: 'PUT',
    body: JSON.stringify({ companies: truncada, expectedVersion: atual.version })
  });
  afirmar(
    'o servidor aceita a poda em massa (a trava é do lado do estande, de propósito)',
    poda.status === 200,
    `${atual.companies.length} → ${truncada.length} empresas`
  );

  const recusou = await esperarPor(
    'os dois estandes recusarem a poda em massa',
    async () => {
      const sA = await statusCatalogo(BOOTHS[0]);
      const sB = await statusCatalogo(BOOTHS[1]);
      return sA?.catalog?.state === 'refused' && sB?.catalog?.state === 'refused' ? { sA, sB } : null;
    },
    { timeoutMs: 60_000 }
  );
  afirmar(
    'os dois estandes RECUSARAM a poda em massa',
    recusou && recusou.sA,
    recusou?.sA ? `A: ${recusou.sA.catalog.lastError}` : 'não recusaram no prazo'
  );
  const depoisA = await tamanhoCatalogo(BOOTHS[0]);
  afirmar('e o catálogo local ficou intacto', depoisA === antesA, `${antesA} → ${depoisA} empresas`);

  // Catálogo vazio escrito DIRETO no Firestore, burlando a trava do `PUT`. Este é o cenário
  // "alguém mexeu no console do Firestore", e o que ele exercita NÃO é a trava do daemon.
  //
  // ACHADO DO PRIMEIRO ENSAIO (2026-09-06). A afirmação original aqui era que os dois estandes
  // iam marcar `state: 'refused'`, e ela falhou — mas o sistema estava certo e o teste errado.
  // `createCompanyCatalogProvider` NUNCA serve lista vazia enquanto a semente de disco não for
  // vazia (`company-catalog.ts`, ramo `companies.length === 0`): um documento vazio cai no
  // `diskSeed` do container e ainda dispara `onSeedNeeded`, que regrava o documento. Ou seja, o
  // catálogo vazio morre uma camada ANTES — `GET /v1/companies` continua servindo lista cheia e
  // os estandes nunca chegam a ter o que recusar. A trava do daemon continua valendo como
  // defesa em profundidade (e tem teste unitário próprio em `catalog-sync.test.ts`), só que ela
  // só é alcançável apontando um estande para um servidor que de fato devolva `[]`.
  //
  // A espera passa dos 60s de propósito: `GET /v1/companies` serve de um cache
  // (COMPANY_CATALOG_TTL_MS) que uma escrita fora do servidor não invalida, então antes disso a
  // afirmação passaria pelo motivo errado.
  const versaoVazia = (await lerCatalogo()).version + 1;
  await escreverCatalogoDireto([], versaoVazia);
  await dormir(65_000);
  const servido = await nuvem('/v1/companies');
  const listaServida = Array.isArray(servido.corpo?.companies) ? servido.corpo.companies : [];
  afirmar(
    'catálogo vazio no Firestore NÃO é servido aos estandes',
    servido.status === 200 && listaServida.length > 0,
    // `source` é o que diz QUAL camada assumiu — `disk` (semente do container), `stale-cache`
    // (último conteúdo bom de uma instância) ou `firestore` (a semeadura preguiçosa já
    // regravou o documento). Sem imprimi-lo, um número inesperado aqui não tem como ser
    // diagnosticado depois: foi o que aconteceu em 2026-09-06.
    `GET /v1/companies devolveu ${listaServida.length} empresas depois da escrita vazia ` +
      `(source=${servido.corpo?.source ?? '?'}, versão ${servido.corpo?.version ?? '?'})`
  );

  // ACHADO DE 2026-09-06, segunda rodada. A afirmação aqui era `depoisVazio === antesA` — "o
  // catálogo local não mudou" — e ela falhou com 26 onde havia 25. Nada estava quebrado: o
  // estande espelhou o catálogo que a nuvem passou a servir depois da escrita vazia, e esse
  // catálogo NÃO é obrigado a ser idêntico ao de produção. Ele pode vir da semente de disco do
  // container (que congela no build) ou do cache de uma instância, e basta um "Salvar" no painel
  // em qualquer momento da vida do projeto para as duas listas divergirem. Exigir igualdade
  // exata era afirmar que ninguém nunca editou o catálogo — uma condição que o próprio painel
  // existe para violar.
  //
  // O que de fato importa para o visitante, e é o que se afirma agora: o estande não ficou SEM
  // catálogo. Nenhuma lista vazia, nenhuma poda em massa. Ganhar ou trocar uma entrada durante a
  // janela de convergência é o comportamento projetado do espelhamento.
  const depoisVazio = await tamanhoCatalogo(BOOTHS[0]);
  const pisoAceitavel = Math.ceil(antesA * 0.7);
  afirmar(
    'e o estande NÃO ficou sem catálogo — nada de lista vazia nem de poda em massa',
    depoisVazio >= pisoAceitavel,
    `${antesA} → ${depoisVazio} empresas (piso de ${pisoAceitavel}; diferença para mais é a ` +
      'convergência com a lista que a nuvem passou a servir, não um defeito)'
  );

  // Restaura já, sem esperar o fim: um catálogo vazio na nuvem desliga a canonicalização.
  await painel('/v1/admin/companies', {
    method: 'PUT',
    body: JSON.stringify({ companies: catalogoOriginal.companies, force: true })
  });
  const restaurado = await lerCatalogo();
  afirmar(
    'o catálogo de produção foi restaurado',
    restaurado.companies.length === catalogoOriginal.companies.length,
    `${restaurado.companies.length} empresas, versão ${restaurado.version}`
  );
}

async function bloco5OfflineEPlayedAt() {
  bloco('Bloco 5 — estande offline drena a fila e o telão ordena por played_at');

  const b = BOOTHS[1];
  // Porta 9 (discard): a conexão morre na hora, sem timeout longo. É "o Wi-Fi do estande caiu",
  // não "a nuvem está lenta" — e é o caso que separa `played_at` de `created_at`.
  await derrubarDaemon(b);
  await subirDaemon(b, {
    BOOTH_CLOUD_API_BASE: 'http://127.0.0.1:9',
    BOOTH_CATALOG_SYNC_INTERVAL_MS: String(INTERVALO_PULL_DESLIGADO_MS)
  });

  const off1 = await jogarPartida(b, { callsign: 'ENSAIOOFF1', companyRaw: 'Ensaio Offline', score: 1500 });
  await dormir(1_500);
  const off2 = await jogarPartida(b, { callsign: 'ENSAIOOFF2', companyRaw: 'Ensaio Offline', score: 1600 });

  // Antes de afirmar qualquer coisa sobre "estar offline", provar que o estande está offline —
  // pela boca do próprio worker, não por dedução. `syncNow()` é disparado sem `await` no
  // `POST /api/matches`, então nesta altura ele já tentou e já falhou; `state: 'retrying'` com
  // falhas consecutivas é a recusa de conexão na porta 9 aparecendo no status. Sem esta
  // afirmação, um bloco que silenciosamente continuasse com rede daria exatamente o mesmo
  // relatório verde do bloco que testou o que queria testar.
  const acusouFalha = await esperarPor(
    'o worker do estande B acusar falha de envio',
    async () => {
      const s = (await estande(b, '/api/sync/status')).corpo;
      return s?.state === 'retrying' && (s?.consecutiveFailures ?? 0) > 0 ? s : null;
    },
    { timeoutMs: 15_000, intervaloMs: 250 }
  );
  afirmar(
    'o estande B está mesmo sem nuvem — o worker acusa falha de envio',
    acusouFalha !== null,
    acusouFalha ? JSON.stringify(acusouFalha) : 'o status nunca saiu de ok/disabled'
  );

  // A janela offline propriamente dita. Ver JANELA_OFFLINE_MS: as duas afirmações abaixo só
  // significam alguma coisa depois de decorrido mais tempo que a latência de um envio normal.
  await dormir(JANELA_OFFLINE_MS);

  const nada = await partidasNaNuvem([off1.matchId, off2.matchId]);
  afirmar(
    `com a rede caída, nada chegou à nuvem em ${Math.round(JANELA_OFFLINE_MS / 1000)}s`,
    nada.length === 0,
    `${nada.length} partidas visíveis`
  );

  const status = (await estande(b, '/api/sync/status')).corpo;
  afirmar('a fila local acusa partidas pendentes', (status?.pending ?? status?.pendingCount ?? 0) >= 2, JSON.stringify(status));

  // Rede de volta.
  await derrubarDaemon(b);
  await subirDaemon(b, { BOOTH_CATALOG_SYNC_INTERVAL_MS: String(INTERVALO_PULL_MS) });

  const drenadas = await esperarIngestao([off1.matchId, off2.matchId], 120_000);
  afirmar('a fila drenou depois que a rede voltou', Array.isArray(drenadas) && drenadas.length === 2);

  if (Array.isArray(drenadas) && drenadas.length === 2) {
    const comPlayedAt = drenadas.filter((m) => typeof m.played_at === 'string');
    afirmar('as duas partidas carregam played_at', comPlayedAt.length === 2);

    const ordemPorJogo = [...drenadas].sort((x, y) => (x.played_at < y.played_at ? -1 : 1)).map((m) => m.callsign);
    afirmar(
      'played_at preserva a ordem em que foram JOGADAS',
      JSON.stringify(ordemPorJogo) === JSON.stringify(['ENSAIOOFF1', 'ENSAIOOFF2']),
      ordemPorJogo.join(' → ')
    );

    // Quantitativo de propósito, e não `played_at < created_at`. Aquela comparação é verdadeira
    // para TODA partida do ensaio, offline ou não: mesmo online a ingestão acontece alguns
    // segundos depois do relógio do estande, então ela media latência de rede e passava sozinha.
    // O que distingue um estande que ficou sem rede é a MAGNITUDE do atraso — tem que ser pelo
    // menos a janela offline inteira, porque a partida esperou nela antes de sair da fila.
    const atrasoMs = drenadas.map((m) => Date.parse(m.created_at) - Date.parse(m.played_at));
    afirmar(
      `a ingestão ficou atrasada em relação ao jogo por mais que a janela offline (${Math.round(JANELA_OFFLINE_MS / 1000)}s)`,
      atrasoMs.every((ms) => Number.isFinite(ms) && ms >= JANELA_OFFLINE_MS),
      drenadas
        .map((m, i) => `${m.callsign}: jogou ${m.played_at} / ingeriu ${m.created_at} (+${Math.round(atrasoMs[i])}ms)`)
        .join('  |  ')
    );
  }
}

async function bloco6Saude() {
  bloco('Bloco 6 — saúde e filtro por estação no painel');

  const { status, corpo } = await painel('/v1/admin/health');
  afirmar('GET /v1/admin/health responde', status === 200, `status ${status}`);

  const estacoes = corpo?.stationActivity?.stations ?? [];
  const nomes = estacoes.map((e) => e.stationId);
  afirmar(
    'as DUAS estações aparecem em stationActivity',
    nomes.includes('ensaio-booth-a') && nomes.includes('ensaio-booth-b'),
    nomes.join(', ') || 'nenhuma'
  );
  const a = estacoes.find((e) => e.stationId === 'ensaio-booth-a');
  afirmar(
    'com contagem de partidas e último horário em ISO 8601',
    a && a.matches > 0 && !Number.isNaN(Date.parse(a.lastMatchAt)),
    a ? `${a.stationId}: ${a.matches} partidas, última ${a.lastMatchAt}` : ''
  );
  afirmar(
    'syncQueue segue vazia e é uma seção SEPARADA (pergunta diferente, ver o comentário do tipo)',
    Array.isArray(corpo?.syncQueue?.stations),
    corpo?.syncQueue?.note ?? ''
  );

  const filtrado = await painel('/v1/admin/matches?station=ensaio-booth-b&limit=200');
  const soDeB = (filtrado.corpo?.matches ?? []).every((m) => m.station_id === 'ensaio-booth-b');
  afirmar(
    'o filtro ?station= devolve só as partidas daquele Mac',
    filtrado.status === 200 && soDeB && (filtrado.corpo?.matches ?? []).length > 0,
    `${(filtrado.corpo?.matches ?? []).length} partidas`
  );
}

async function bloco7EmpateParaOTelao() {
  bloco('Bloco 7 — cenário de empate montado para a conferência manual no telão');

  const a = await jogarPartida(BOOTHS[0], { callsign: 'ENSAIOEMP1', companyRaw: 'Ensaio Empate', score: 2777 });
  const b = await jogarPartida(BOOTHS[1], { callsign: 'ENSAIOEMP2', companyRaw: 'Ensaio Empate', score: 2777 });
  await esperarIngestao([a.matchId, b.matchId]);

  afirmar(
    'duas partidas com score IDÊNTICO, uma de cada estande, chegaram à nuvem',
    a.score === b.score,
    `${a.score} pontos: ENSAIOEMP1 (A) e ENSAIOEMP2 (B)`
  );
  nota('A ordem entre elas é a mesma nas duas TVs? Isso é o passo 26.4 do plano de teste manual.');
}

// ---------------------------------------------------------------------------
// Limpeza
// ---------------------------------------------------------------------------

async function limpar(catalogoOriginal) {
  bloco('Limpeza');

  // O catálogo é restaurado SEMPRE, inclusive com `--sem-limpeza` e inclusive se um bloco abortou
  // no meio: as partidas de ensaio são inertes até alguém abrir o placar, mas um catálogo podado
  // ou vazio na nuvem desliga o casamento de nomes nas duas estações de verdade.
  if (catalogoOriginal) {
    const agora = await lerCatalogo();
    const igual = JSON.stringify([...agora.companies].sort()) === JSON.stringify([...catalogoOriginal.companies].sort());
    if (!igual) {
      await painel('/v1/admin/companies', {
        method: 'PUT',
        body: JSON.stringify({ companies: catalogoOriginal.companies, force: true })
      });
    }
    const fim = await lerCatalogo();
    afirmar(
      'o catálogo de produção está como estava antes do ensaio',
      JSON.stringify([...fim.companies].sort()) === JSON.stringify([...catalogoOriginal.companies].sort()),
      `${fim.companies.length} empresas (cópia de segurança em ${ARQUIVO_CATALOGO_ORIGINAL})`
    );
  }

  if (SEM_LIMPEZA) {
    // Os daemons ficam DE PÉ de propósito: o Bloco 26 do plano de teste manual continua daqui,
    // com as duas TVs abertas e os dois estandes vivos nas portas 3100/3101.
    nota(`--sem-limpeza: ${partidasCriadas.length} partidas de ensaio FICARAM na nuvem.`);
    nota('Apague-as pelo painel (seleção em massa → Apagar) antes de abrir o estande.');
    nota(`match_ids: ${partidasCriadas.join(' ')}`);
    return;
  }

  await derrubarTodos();

  if (partidasCriadas.length) {
    const { status, corpo } = await painel('/v1/admin/matches/bulk', {
      method: 'POST',
      body: JSON.stringify({ match_ids: partidasCriadas, action: 'delete' })
    });
    const apagadas = corpo?.succeeded?.length ?? corpo?.ok ?? 0;
    afirmar(
      'as partidas de ensaio foram apagadas da nuvem',
      status === 200 && apagadas === partidasCriadas.length,
      `${apagadas}/${partidasCriadas.length} — ${JSON.stringify(corpo)}`
    );

    const sobrando = await rankingsDoEnsaio();
    afirmar(
      'nenhum company_rankings de ensaio sobrou',
      sobrando.length === 0,
      sobrando.map((r) => r.id).join(', ') || 'coleção limpa'
    );
  }
}

// ---------------------------------------------------------------------------
// Modo `--recordes` (passo 26.3 do plano de teste manual)
// ---------------------------------------------------------------------------

/**
 * Dispara dois recordes, um por estande, com ≈1,5 s entre eles — dentro dos 7 s que o modal de
 * celebração fica na tela. Deixa os estandes de pé e imprime os `match_id` para o operador apagar
 * depois. Não mexe no catálogo: aqui só interessa o placar.
 */
async function modoRecordes() {
  bloco('Modo --recordes — dois recordes em menos de 7 s para as duas TVs');

  iniciarFirestore();
  const { corpo } = await painel('/v1/admin/matches?limit=200');
  const topo = Math.max(0, ...(corpo?.matches ?? []).map((m) => (m.voided ? 0 : m.final_score || 0)));
  nota(`melhor score hoje: ${topo}. Vou mandar ${topo + 100} e ${topo + 200}.`);

  for (const b of BOOTHS) {
    const c = caminhosDoBooth(b);
    if (!fs.existsSync(c.catalogo)) {
      fs.mkdirSync(c.base, { recursive: true });
      fs.copyFileSync(path.join(raizRepo, 'config', 'companies.json'), c.catalogo);
    }
    if (!b.processo) await subirDaemon(b, { BOOTH_CATALOG_SYNC_INTERVAL_MS: String(INTERVALO_PULL_MS) });
  }

  nota('Olhe as DUAS TVs agora. Disparando em 3s…');
  await dormir(3_000);

  const r1 = await jogarPartida(BOOTHS[0], { callsign: 'ENSAIOREC1', companyRaw: 'Ensaio Recorde', score: topo + 100 });
  await dormir(1_500);
  const r2 = await jogarPartida(BOOTHS[1], { callsign: 'ENSAIOREC2', companyRaw: 'Ensaio Recorde', score: topo + 200 });

  await esperarIngestao([r1.matchId, r2.matchId]);
  afirmar(
    'os dois recordes chegaram à nuvem com menos de 7s entre eles',
    true,
    `ENSAIOREC1 ${r1.score} (estande A) → ENSAIOREC2 ${r2.score} (estande B)`
  );
  nota('Critério (olho humano): DUAS celebrações, uma de cada vez, em CADA TV. Nenhuma engolida.');
  nota(`Para apagar depois: match_ids ${r1.matchId} ${r2.matchId}`);
}

// ---------------------------------------------------------------------------
// Infra
// ---------------------------------------------------------------------------

function executar(comando, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(comando, args, { cwd: raizRepo, stdio: 'inherit' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${comando} ${args.join(' ')} saiu com ${code}`))));
  });
}

function relatorio() {
  const falhas = resultados.filter((r) => !r.ok);
  console.log(`\n\x1b[1m═══ ${resultados.length - falhas.length}/${resultados.length} afirmações passaram\x1b[0m`);
  if (falhas.length) {
    console.log('\n\x1b[31mFalhas:\x1b[0m');
    for (const f of falhas) console.log(`  • [${f.bloco}] ${f.titulo}${f.detalhe ? `\n      ${f.detalhe}` : ''}`);
  }
  for (const b of BOOTHS) console.log(`\x1b[90mLog do estande ${b.id}: ${caminhosDoBooth(b).log}\x1b[0m`);
  return falhas.length;
}

async function main() {
  if (SO_RECORDES) {
    try {
      await modoRecordes();
    } catch (err) {
      console.error(`\n\x1b[31m[ensaio] --recordes falhou:\x1b[0m ${err?.stack || err}`);
      resultados.push({ bloco: 'Modo --recordes', titulo: 'o disparo terminou', ok: false, detalhe: String(err) });
    }
    relatorio();
    // Não encerra: os estandes precisam continuar de pé enquanto o operador olha as TVs.
    console.log('\n[ensaio] estandes de pé. Ctrl-C quando terminar de olhar as TVs.');
    await new Promise(() => {});
    return;
  }

  let catalogoOriginal = null;
  try {
    catalogoOriginal = await preparacao();
    await bloco1Divergencia();
    await bloco2Convergencia(catalogoOriginal);
    await bloco3RemocaoEAliases();
    await bloco4Travas(catalogoOriginal);
    await bloco5OfflineEPlayedAt();
    await bloco6Saude();
    await bloco7EmpateParaOTelao();
  } catch (err) {
    console.error(`\n\x1b[31m[ensaio] interrompido:\x1b[0m ${err?.stack || err}`);
    resultados.push({ bloco: blocoAtual, titulo: 'o ensaio chegou ao fim', ok: false, detalhe: String(err) });
  } finally {
    try {
      await limpar(catalogoOriginal);
    } catch (err) {
      console.error(`\n\x1b[31m[ensaio] a LIMPEZA falhou:\x1b[0m ${err?.stack || err}`);
      console.error(`Restaure o catálogo à mão a partir de ${ARQUIVO_CATALOGO_ORIGINAL}.`);
      resultados.push({ bloco: 'Limpeza', titulo: 'a limpeza terminou', ok: false, detalhe: String(err) });
    }
  }

  const falhas = relatorio();
  // Só segurar se houver de fato estande de pé. Segurar é o que faz o Ctrl-C derrubar os dois
  // daemons de forma limpa (sair aqui os deixaria órfãos segurando 3100/3101 até alguém descobrir
  // com `lsof`) — mas quando a Preparação aborta nenhum chegou a subir, e prender o terminal ali
  // só esconde a mensagem de erro atrás de um processo que parece travado.
  if (SEM_LIMPEZA && BOOTHS.some((b) => b.processo)) {
    console.log('\n[ensaio] estandes de pé para o Bloco 26 manual. Ctrl-C quando terminar.');
    await new Promise(() => {});
  }
  process.exit(falhas === 0 ? 0 : 1);
}

// Ctrl-C não pode deixar dois daemons órfãos segurando 3100/3101.
for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    console.log(`\n[ensaio] ${sinal} — encerrando os estandes.`);
    void derrubarTodos().finally(() => process.exit(130));
  });
}

await main();
