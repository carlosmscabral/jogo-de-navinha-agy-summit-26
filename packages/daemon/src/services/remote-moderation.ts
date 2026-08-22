/**
 * Cliente do daemon para a moderação de camada 2 (`POST /v1/moderate` em
 * `packages/cloud-api`) — Spec 08 §6.2.
 *
 * A distinção com `packages/cloud-api/src/moderation-l2.ts` é o coração desta
 * tarefa e é deliberada: lá, "o modelo respondeu em dúvida ou não respondeu"
 * falha FECHADO (Spec 05 §3.2) — o callsign não vai pro telão. Aqui, "o Vertex
 * está inalcançável" falha ABERTO — devolve `'unavailable'`, e quem chama trata
 * isso como camada 1 (local, síncrona, já aprovou) bastando para deixar o
 * visitante seguir. Um estande sem internet não pode parar de receber gente;
 * um modelo em dúvida não deve soltar um nome ofensivo no telão. São a mesma
 * pergunta ("posso confiar nisso?") com respostas opostas por bons motivos.
 */
export interface RemoteVerdict {
  verdict: 'allow' | 'block' | 'unavailable';
  reason?: string;
}

/**
 * `unavailable` cobre TODO caminho que não é um veredito reconhecido vindo do
 * serviço: endereço/token ausente, DNS falhando, timeout, HTTP não-2xx, corpo
 * que não é o JSON esperado. Nunca lança — quem chama (`/api/session/start` em
 * `index.ts`) não precisa de try/catch para tratar "a nuvem sumiu".
 */
export async function moderateRemotely(
  base: string | null | undefined,
  token: string | null | undefined,
  callsign: string,
  timeoutMs: number
): Promise<RemoteVerdict> {
  if (!base || !token) {
    return { verdict: 'unavailable' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/v1/moderate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ callsign }),
      signal: controller.signal
    });

    if (!res.ok) {
      return { verdict: 'unavailable' };
    }

    const body = (await res.json()) as { verdict?: unknown; reason?: unknown };
    if (body.verdict !== 'allow' && body.verdict !== 'block') {
      return { verdict: 'unavailable' };
    }

    return typeof body.reason === 'string'
      ? { verdict: body.verdict, reason: body.reason }
      : { verdict: body.verdict };
  } catch {
    // DNS falhou, conexão recusada, abort por timeout, corpo não é JSON, etc.
    // Tudo isso é "a nuvem não respondeu", não "o callsign é duvidoso" — fail-open.
    return { verdict: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}
