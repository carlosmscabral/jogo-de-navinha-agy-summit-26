/**
 * O gatilho da varredura de canonicalização, extraído do closure de `index.ts`.
 *
 * Duas guardas em camadas, porque elas cobrem casos diferentes e a barata cobre a maioria:
 *
 * 1. **`sweepInFlight`, em memória.** O serviço roda com `--min-instances 1` e tráfego esparso,
 *    então a maior parte das varreduras duplicadas vem de duas ingestões CONSECUTIVAS caindo na
 *    MESMA instância — dois estandes terminando partidas com segundos de diferença. Um booleano
 *    de módulo resolve esse caso sem uma única ida ao Firestore.
 * 2. **Lease no Firestore** (`lease.ts`), opcional e injetado. Cobre o caso que o booleano não
 *    vê: duas instâncias. Fica aqui fora e não dentro de `runCanonicalizationSweep` de propósito
 *    — os testes existentes chamam aquela função direto e não deveriam precisar de um lease.
 *
 * A extração para um módulo próprio existe para isto poder ser testado: dentro de `index.ts` o
 * gatilho vivia num closure de `createApp`, alcançável só subindo um servidor HTTP.
 */
export type SweepFn = () => Promise<void>;

export interface SweepTriggerOptions {
  /** A varredura de verdade. Injetada para o teste não precisar de Firestore nem de Vertex. */
  run: SweepFn;
  /**
   * Envolve `run` num lease distribuído e devolve `null` quando outra instância está varrendo.
   * Opcional: sem ele, sobra a guarda em memória, que já é a mais eficaz das duas aqui.
   */
  withLease?: <T>(fn: () => Promise<T>) => Promise<T | null>;
  onError?: (err: unknown) => void;
}

export interface SweepTrigger {
  /**
   * Dispara a varredura SEM `await` — é isto que `ingestBatch` chama, e o caminho de resposta de
   * `POST /v1/matches` não pode esperar pelo Vertex.
   */
  trigger: () => void;
  /** Só para teste: a promessa da varredura em curso, ou `null`. */
  inFlight: () => Promise<void> | null;
}

export function createSweepTrigger(opts: SweepTriggerOptions): SweepTrigger {
  const onError =
    opts.onError ??
    ((err: unknown) => {
      console.error('[cloud-api] canonicalization sweep failed:', err);
    });

  let inFlight: Promise<void> | null = null;

  function start(): Promise<void> {
    // IIFE assíncrona, e não `opts.run()` direto: se `run` lançar de forma SÍNCRONA, o erro
    // escaparia por `trigger()` para dentro de `ingestBatch` — que é justamente o caminho de
    // resposta do visitante que este gatilho existe para não tocar. Aqui vira rejeição.
    const body = (async () => {
      if (opts.withLease) await opts.withLease(opts.run);
      else await opts.run();
    })();
    // O `.catch` é essencial e não decorativo: esta promessa é DESANEXADA (ninguém dá `await`
    // nela), e sem tratamento uma falha do Vertex vira `unhandledRejection` do processo inteiro
    // — o serviço cai por causa de uma partida.
    return body.catch(onError).finally(() => {
      inFlight = null;
    });
  }

  return {
    trigger() {
      // Descarta em vez de enfileirar. Uma varredura pega até 50 marcadas de uma vez, então a
      // que já está rodando muito provavelmente já inclui a partida que acabou de chegar; e se
      // não incluir, a próxima ingestão dispara de novo. Enfileirar só duplicaria a chamada ao
      // Vertex com um atraso, que é exatamente o que esta guarda existe para não fazer.
      if (inFlight) return;
      inFlight = start();
    },
    inFlight: () => inFlight
  };
}
