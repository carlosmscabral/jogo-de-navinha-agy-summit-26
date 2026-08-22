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
 */
import { generateJson } from './vertex.js';

export type GenerateFn = (prompt: string) => Promise<string>;

export interface ModerationVerdict {
  verdict: 'allow' | 'block';
  reason?: string;
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
    'de evento corporativo, exibidos publicamente num telão. Um filtro local já',
    'bloqueou palavrão óbvio e leet-speak; sua tarefa é o que esse filtro simples',
    'não pega: insulto velado, trocadilho ofensivo, referência degradante a',
    'terceiros, dog-whistle. Não bloqueie por excesso de zelo um nome apenas',
    'estranho, genérico ou sem sentido óbvio — isso é seguro.',
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
  timeoutMs: number
): Promise<ModerationVerdict> {
  const prompt = buildModerationPrompt(callsign);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('moderation-l2: timeout do modelo')), timeoutMs);
  });

  let raw: string;
  try {
    raw = await Promise.race([generate(prompt), timeout]);
  } catch {
    return {
      verdict: 'block',
      reason: 'moderação semântica não respondeu a tempo — falha fechada (Spec 05 §3.2)'
    };
  } finally {
    clearTimeout(timer);
  }

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
