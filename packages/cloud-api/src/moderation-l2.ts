/**
 * Moderação de camada 2 — Spec 05 §3.2, Spec 08 §6.2. A camada 1
 * (`validateCallsign`, em `@jogo/shared`) é local, síncrona, e pega lixo óbvio
 * (palavrão direto, leet-speak). Esta camada existe para o que a 1 não pega:
 * insulto velado, trocadilho ofensivo, referência a terceiro — coisas que só um
 * modelo com algum entendimento de linguagem detecta.
 *
 * `generate` é injetado (dependency injection) e nunca é o cliente Vertex real
 * dentro de teste — é isso que torna a POLÍTICA testável sem tocar rede.
 * `generateWithVertex`, exportado no fim do arquivo, é a única ponte real para
 * `vertex.ts`, usada pela rota /v1/moderate em `index.ts`.
 *
 * A regra de ouro deste arquivo: qualquer coisa que não seja EXATAMENTE
 * `{ safe: boolean, reason: string }` — JSON malformado, forma errada, ou
 * timeout — vira `block`. Falhar fechado aqui é intencional (Spec 05 §3.2): se
 * o modelo não conseguiu dizer com confiança "isso é seguro", o callsign não
 * vai para o telão público. Isso é o OPOSTO do fail-open do daemon
 * (`packages/daemon/src/services/remote-moderation.ts`), que devolve
 * "unavailable" (e deixa o registro seguir) quando o Vertex está inalcançável —
 * lá o cenário é "o estande está offline", não "o modelo respondeu em dúvida".
 *
 * Revisão final Fase C — Crítico 4: a regra de ouro acima tinha um furo. `generate` pode
 * lançar por dois motivos bem diferentes: (a) o modelo respondeu, mas em timeout ou em
 * forma inesperada — aí "block" é exatamente certo, é dúvida genuína sobre o veredito; ou
 * (b) a chamada NUNCA chegou a um julgamento do modelo — `GOOGLE_CLOUD_PROJECT` ausente,
 * IAM errado, cota estourada, DNS falhando, HTTP não-2xx do Vertex. (b) não é "o modelo
 * achou o nome inseguro", é "nossa infraestrutura está quebrada" — tratar os dois como
 * `block` faz QUALQUER problema de configuração do Vertex bloquear TODO cadastro do evento,
 * indistinguível de o modelo reprovar todo mundo. `verdict: 'unavailable'` cobre só o caso
 * (b); quem chama esta função (a rota `/v1/moderate` em `index.ts`) devolve isso ao daemon,
 * que já trata "unavailable" como fail-open (camada 1 local basta) — ver
 * `remote-moderation.ts`. Timeout e forma inesperada continuam `block`: o modelo respondeu
 * ou está em voo, só não com confiança suficiente.
 */
import { generateJson } from './vertex.js';

export type GenerateFn = (prompt: string) => Promise<string>;

export interface ModerationVerdict {
  verdict: 'allow' | 'block' | 'unavailable';
  reason?: string;
}

/**
 * Entregue a quem chama quando o teto vence a corrida. `settle` só resolve quando a chamada
 * abandonada realmente termina — ela é o dado interessante, e é por isso que isto é uma promise
 * e não um número: no instante do estouro a resposta ainda não existe.
 */
export interface LateResponse {
  callsign: string;
  timeoutMs: number;
  settle: Promise<{ ms: number; settled: 'ok' | 'error'; detail: string }>;
}

/** Schema de saída forçada — ver Passo 1 em vertex.ts sobre por que isso substitui temperature=0. */
const MODERATION_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    safe: { type: 'boolean' },
    reason: { type: 'string' }
  },
  required: ['safe', 'reason']
};

function buildModerationPrompt(callsign: string): string {
  return [
    'Você modera codinomes ("callsigns") escolhidos por visitantes de um estande',
    'de evento corporativo, exibidos publicamente num telão. O jogo é um shoot-em-up',
    'espacial. Um filtro local já bloqueou palavrão óbvio e leet-speak; sua tarefa é',
    'o que esse filtro simples não pega: insulto velado, trocadilho ofensivo,',
    'referência degradante a terceiros, dog-whistle.',
    '',
    'Duas regras que decidem casos que você tende a julgar de forma inconsistente:',
    '',
    '1. Gíria depreciativa dirigida a pessoa é insulto mesmo em tom de brincadeira, e',
    '   mesmo quando o alvo é um cargo ou um grupo em vez de um indivíduo. "Palhaço",',
    '   "mané", "panaca", "jumento", "boçal", "trouxa", "pateta" e semelhantes contam,',
    '   sozinhos ou colados a CHEFE, RH, CEO, TIME, DIRETORIA. Num telão de evento',
    '   corporativo o alvo dessas piadas está sempre na sala.',
    '2. Conteúdo sexual conta mesmo deformado, e deformar é justamente a manobra usada',
    '   para escapar do filtro simples. Diminutivo, aumentativo e eufemismo valem o',
    '   termo direto de que derivam. Isso não se limita a nome de órgão: adjetivo que',
    '   descreve a pessoa como lasciva, referência a ato sexual e referência a nudez',
    '   entram na mesma regra. Teste prático: se tirar o sufixo devolve um termo que',
    '   você bloquearia, bloqueie o nome deformado também.',
    '',
    'No sentido oposto, e com o mesmo peso: um nome apenas estranho, genérico ou sem',
    'sentido óbvio é SEGURO, e vocabulário de combate é temático num jogo de nave —',
    'mas só enquanto nomeia o que o PILOTO é ou faz (MATADOR, SNIPER, CACADOR).',
    'Ameaça, ordem ou desejo de dano dirigido a uma pessoa não é persona de piloto,',
    'é recado para quem está lendo o telão: "MORRA_LOGO", "TE_MATO", "VAI_MORRER"',
    'são bloqueio, não tema. Feita essa distinção, reprovar um visitante inocente',
    'custa mais caro do que deixar passar um nome meramente bobo.',
    '',
    `Callsign a avaliar: ${JSON.stringify(callsign)}`,
    '',
    'Responda SOMENTE um objeto JSON no formato exato',
    '{"safe": boolean, "reason": string}. Se safe for true, reason deve ser "".',
    'Se safe for false, reason deve explicar objetivamente o motivo, em português.'
  ].join('\n');
}

function isModerationShape(value: unknown): value is { safe: boolean; reason: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).safe === 'boolean' &&
    typeof (value as Record<string, unknown>).reason === 'string'
  );
}

/**
 * `Promise.race` contra um timeout, `JSON.parse` protegido, e qualquer desvio
 * do formato esperado cai em `block`. Falha fechada — ver comentário do topo.
 */
export async function moderateCallsign(
  callsign: string,
  generate: GenerateFn,
  timeoutMs: number,
  onLateResponse?: (info: LateResponse) => void
): Promise<ModerationVerdict> {
  const prompt = buildModerationPrompt(callsign);
  const startedAt = Date.now();

  // Três desfechos possíveis da corrida abaixo, cada um com uma tag própria — é isso que
  // permite distinguir "o timeout venceu" de "generate() lançou antes de qualquer resposta"
  // sem depender de inspecionar a mensagem do erro (ver Crítico 4 no comentário do topo).
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutRace = new Promise<{ kind: 'timeout' }>((resolve) => {
    timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
  });
  const generateRace = generate(prompt).then(
    (raw): { kind: 'ok'; raw: string } => ({ kind: 'ok', raw }),
    (err): { kind: 'error'; err: unknown } => ({ kind: 'error', err })
  );

  const outcome = await Promise.race([generateRace, timeoutRace]);
  clearTimeout(timer);

  if (outcome.kind === 'timeout') {
    // A corrida acabou, mas a chamada ao modelo continua em voo — e até 2026-08-24 nós a
    // abandonávamos sem nunca saber como ela terminava. Isso apagava a única medida capaz de
    // distinguir dois diagnósticos opostos que produzem exatamente o mesmo log: "o teto está
    // curto demais, o modelo responderia em 8,5s" e "esta chamada não voltaria nunca". A
    // bateria de 100 callsigns caiu justamente nessa ambiguidade — 16 estouros, todos
    // registrados como o mesmo evento sem duração. Observar o desfecho tardio não muda nada
    // para o visitante (a resposta já foi decidida acima); só converte cada estouro futuro numa
    // medição do teto em vez de um mistério.
    //
    // Ressalva de leitura: este callback roda DEPOIS de a resposta ter ido embora. Se o Cloud
    // Run estiver estrangulando CPU fora da requisição, ele fica na fila até a instância
    // receber CPU de novo, e o tempo relatado vem inflado por essa espera, não pelo modelo. O
    // deploy passa --no-cpu-throttling por causa disto (ver scripts/deploy.sh); se alguém rodar
    // com estrangulamento ligado, trate estes números como teto superior, não como medida.
    onLateResponse?.({
      callsign,
      timeoutMs,
      // A promise já tem os dois handlers ligados na criação, então nunca rejeita: este `then`
      // não pode virar unhandled rejection.
      settle: generateRace.then((late) => ({
        ms: Date.now() - startedAt,
        settled: late.kind === 'ok' ? ('ok' as const) : ('error' as const),
        detail: late.kind === 'ok'
          ? ''
          : late.err instanceof Error ? late.err.message : String(late.err)
      }))
    });

    // O modelo pode até responder depois disto — só não a tempo. Dúvida genuína sobre o
    // veredito, não infraestrutura quebrada: falha fechada de verdade (Spec 05 §3.2).
    return {
      verdict: 'block',
      reason: 'moderação semântica não respondeu a tempo — falha fechada (Spec 05 §3.2)'
    };
  }

  if (outcome.kind === 'error') {
    // generate() nunca chegou a produzir uma resposta do modelo — erro de cliente/config
    // (ex.: GOOGLE_CLOUD_PROJECT ausente), transporte, ou HTTP não-2xx do Vertex. Isto não é
    // "o modelo achou o nome inseguro"; é "a infraestrutura de moderação está fora do ar".
    const message = outcome.err instanceof Error ? outcome.err.message : String(outcome.err);
    return {
      verdict: 'unavailable',
      reason: `moderação semântica indisponível (falha de infraestrutura, não do modelo): ${message}`
    };
  }

  const raw = outcome.raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      verdict: 'block',
      reason: 'resposta do modelo não é JSON válido — falha fechada (Spec 05 §3.2)'
    };
  }

  if (!isModerationShape(parsed)) {
    return {
      verdict: 'block',
      reason: 'resposta do modelo fora do formato esperado — falha fechada (Spec 05 §3.2)'
    };
  }

  return parsed.safe
    ? { verdict: 'allow', reason: parsed.reason }
    : { verdict: 'block', reason: parsed.reason };
}

/** Ponte real para o Vertex — nunca usada em teste. 'low' porque isto é bloqueante (visitante esperando). */
export const generateWithVertex: GenerateFn = (prompt) =>
  generateJson(prompt, MODERATION_RESPONSE_SCHEMA, 'low');
