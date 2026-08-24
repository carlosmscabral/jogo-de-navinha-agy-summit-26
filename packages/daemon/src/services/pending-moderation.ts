/**
 * Tira a moderação de camada 2 do caminho crítico do visitante.
 *
 * MOTIVO, medido no Gate M3 em 2026-08-24. A camada 2 era aguardada dentro do
 * `POST /api/session/start`, então o visitante ficava parado na tela de cadastro até o Vertex
 * responder. Uma bateria de 100 callsigns contra o projeto real mediu p50 de 2,7s, p90 de 4,4s
 * e uma cauda que estoura o teto de 8s em 4% dos casos. Pior: o log de resposta tardia
 * (`packages/cloud-api/src/moderation-l2.ts`) mostrou que as chamadas abandonadas TERMINAM bem,
 * só que em 8,3s, 11,5s, 14,8s, 16,2s, 47,8s e 78,0s. Não dá para esperar por isso com uma
 * pessoa olhando a tela, e aumentar o teto até caber os 78s é absurdo.
 *
 * A observação que dissolve o problema: o codinome não precisa estar correto quando é DIGITADO,
 * só quando chega ao telão. Entre uma coisa e outra o visitante passa pela tela de instruções,
 * monta a nave, espera o `agy` forjar e joga uma partida inteira — minutos. Movida para cá, uma
 * moderação de 78s termina muito antes de importar, e o visitante nunca espera por ela.
 *
 * É o mesmo padrão que a Spec 08 §6.2 já adotou para a canonicalização de empresa
 * (`needs_company_review`): trabalho que não bloqueia quem está esperando.
 *
 * O que este módulo NÃO faz: afrouxar a política. O desfecho de um `block` continua sendo o
 * placeholder da camada 1, e `POST /api/matches` aguarda `final` antes de gravar — então nenhum
 * nome reprovado chega ao SQLite, ao telão ou à nuvem. O que mudou foi só QUEM espera.
 */
import type { RemoteVerdict } from './remote-moderation.js';

/** `moderateRemotely` já com base/token/timeout amarrados — é o ponto de injeção dos testes. */
export type ModerateFn = (callsign: string) => Promise<RemoteVerdict>;

export interface PendingModeration {
  /** O que o visitante vê enquanto a camada 2 roda: o callsign já saneado pela camada 1. */
  readonly provisional: string;
  /**
   * O callsign definitivo. Resolve com `provisional` (aprovado ou camada 2 indisponível) ou com
   * um placeholder (reprovado). NUNCA rejeita: quem aguarda não precisa de try/catch, porque uma
   * falha aqui não pode impedir a partida de um visitante de ser gravada.
   */
  readonly final: Promise<string>;
}

export interface ModerationDeps {
  moderate: ModerateFn;
  placeholder: () => string;
  warn?: (message: string) => void;
}

/**
 * Dispara a camada 2 em segundo plano e devolve imediatamente. `isValid` vem da camada 1: quando
 * ela já reprovou, `provisional` JÁ é um placeholder seguro por construção e perguntar ao modelo
 * não mudaria nada — só gastaria uma chamada de rede. É só no caminho "aprovado localmente" que
 * o insulto velado tem chance de passar, e é aí que a camada 2 existe para entrar.
 */
export function startModeration(
  provisional: string,
  isValid: boolean,
  deps: ModerationDeps
): PendingModeration {
  if (!isValid) {
    return { provisional, final: Promise.resolve(provisional) };
  }

  const warn = deps.warn ?? ((m: string) => console.warn(m));

  const final = deps
    .moderate(provisional)
    .then((remote) => {
      if (remote.verdict === 'block') {
        // Mesmo desfecho da camada 1: troca por um placeholder e segue, em silêncio para o
        // visitante. Contraria a letra da Spec 05 §3.2 ("o registro é recusado […] o visitante
        // escolhe outro codinome") de propósito, por decisão do operador em 2026-08-24 — ver o
        // comentário longo em index.ts. O objetivo da §3.2 continua cumprido: o nome ofensivo
        // não chega ao telão.
        warn(
          `[Daemon] Camada 2 recusou "${provisional}" (${remote.reason || 'sem motivo declarado'}) — ` +
          'trocando por um placeholder, como a camada 1 já faz com palavrão.'
        );
        return deps.placeholder();
      }

      if (remote.verdict === 'unavailable') {
        // Falha ABERTA do transporte (Spec 08 §6.2): o Vertex está inalcançável, não em dúvida.
        // A camada 1 local já aprovou; o estande não pode parar de receber visitantes por isso,
        // mas o staff precisa saber se isso virar o dia inteiro sem moderação semântica.
        warn(
          `[Daemon] Moderação semântica (camada 2) indisponível para "${provisional}" — ` +
          'seguindo só com a aprovação local (camada 1). Se persistir, o Vertex está inalcançável.'
        );
      }

      return provisional;
    })
    .catch((err) => {
      // `moderateRemotely` promete nunca lançar, mas este módulo não pode depender disso: se
      // algum dia lançar, uma promise rejeitada aqui derrubaria o `await` do POST /api/matches e
      // o visitante perderia a PARTIDA por causa de um problema de moderação. Fail-open é o
      // desfecho certo — a camada 1 já aprovou este nome.
      warn(`[Daemon] Camada 2 lançou inesperadamente para "${provisional}": ${String(err)}`);
      return provisional;
    });

  return { provisional, final };
}
