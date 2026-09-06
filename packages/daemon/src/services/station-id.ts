/**
 * Identidade do estande — de qual Mac veio cada partida.
 *
 * O evento passou a ter dois estandes jogando ao mesmo tempo contra a MESMA nuvem e o MESMO
 * placar. Nada no documento de partida dizia qual máquina o produziu, e a tela de Saúde do
 * painel de admin devolvia `stations: []` com um comentário afirmando que só uma estação
 * seria implantada. No dia, "as partidas pararam de chegar" e "um dos dois Macs travou" são
 * diagnósticos diferentes, e sem este campo não há como distinguir um do outro.
 *
 * Duas decisões deliberadas:
 *
 * 1. **Nunca falhar no boot.** Um daemon que se recusa a subir às 9h porque `BOOTH_STATION_ID`
 *    não foi exportada é pior que uma partida sem rótulo — o estande fica fechado por um campo
 *    de observabilidade. O precedente do daemon é degradar e avisar alto, não abortar. Como os
 *    dois Macs têm hostnames distintos, o default já é útil sem configuração nenhuma.
 * 2. **Nunca aceitar o valor do navegador.** Quem chama isto é o daemon, no handler de
 *    `POST /api/matches`, sobrescrevendo o que veio do cliente. Um `station_id` vindo da página
 *    é não autenticado e permitiria atribuir as partidas de um estande ao outro.
 *
 * Funções puras, com `env` e o leitor de hostname injetados, para o teste não depender da
 * máquina onde roda.
 */

/**
 * Caracteres seguros para um identificador que vai virar chave de agrupamento no painel e
 * viajar num documento do Firestore. Sem espaço e sem acento de propósito: o valor aparece em
 * log de terminal e em URL de filtro, e um hostname de Mac costuma vir com sufixo `.local`.
 */
const STATION_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/** Usado quando nem a env nem o hostname produzem algo utilizável. */
export const UNKNOWN_STATION_ID = 'estacao-desconhecida';

export interface StationIdResolution {
  stationId: string;
  /** De onde o valor saiu. `'fallback'` é o único caso que merece aviso no boot. */
  source: 'env' | 'hostname' | 'fallback';
  /**
   * Presente quando um candidato existia mas foi recusado pelo formato — o operador precisa
   * saber que exportou algo que o daemon ignorou, senão vai procurar o valor no painel e não
   * encontrar. `null` quando não houve candidato nenhum.
   */
  rejected: string | null;
}

/**
 * Aceita ou recusa; nunca "conserta". Sanear silenciosamente (trocar espaço por hífen, tirar
 * acento) produziria um `station_id` que o operador não digitou e não reconhece no painel —
 * pior que recusar e dizer o porquê.
 */
export function isValidStationId(value: string): boolean {
  return STATION_ID_PATTERN.test(value);
}

/**
 * Ordem: `BOOTH_STATION_ID` → hostname da máquina → `UNKNOWN_STATION_ID`.
 *
 * `hostnameFn` é injetada (e pode lançar: `os.hostname()` pode falhar em ambiente restrito)
 * para o teste cobrir os três ramos sem depender do host real.
 */
export function resolveStationId(
  env: NodeJS.ProcessEnv,
  hostnameFn: () => string
): StationIdResolution {
  const fromEnv = (env.BOOTH_STATION_ID ?? '').trim();
  if (fromEnv) {
    if (isValidStationId(fromEnv)) return { stationId: fromEnv, source: 'env', rejected: null };
    // Env presente e inválida: cai para o hostname, mas guarda o valor recusado para o aviso.
    const viaHostname = resolveFromHostname(hostnameFn);
    return { ...viaHostname, rejected: fromEnv };
  }

  return resolveFromHostname(hostnameFn);
}

function resolveFromHostname(hostnameFn: () => string): StationIdResolution {
  let raw = '';
  try {
    raw = (hostnameFn() ?? '').trim();
  } catch {
    raw = '';
  }

  if (raw && isValidStationId(raw)) return { stationId: raw, source: 'hostname', rejected: null };
  return { stationId: UNKNOWN_STATION_ID, source: 'fallback', rejected: raw || null };
}

/**
 * A linha de boot, ou `null` quando não há nada a dizer. Separada do IO pelo mesmo motivo de
 * `buildShadowWarning` em `env-precedence.ts`: a redação é o recurso, e o teste precisa poder
 * afirmar o texto.
 *
 * Silencioso quando veio da env — é o caso configurado corretamente, e mais uma linha de log
 * no boot é mais uma linha que o operador aprende a ignorar.
 */
export function buildStationIdWarning(resolution: StationIdResolution): string | null {
  if (resolution.rejected !== null) {
    return (
      `[Daemon] ATENÇÃO: BOOTH_STATION_ID='${resolution.rejected}' foi recusada — ` +
      `só são aceitos letras, números, ponto, hífen e sublinhado (até 64 caracteres). ` +
      `Usando '${resolution.stationId}' no lugar. ` +
      `Com dois estandes contra o mesmo placar, o painel de Saúde vai agrupar as partidas ` +
      `por este nome.`
    );
  }

  if (resolution.source === 'fallback') {
    return (
      `[Daemon] ATENÇÃO: não foi possível identificar esta estação (BOOTH_STATION_ID ausente ` +
      `e hostname indisponível). Todas as partidas vão como '${resolution.stationId}'. ` +
      `Com dois estandes, isso significa que o painel de Saúde não vai distinguir um do outro: ` +
      `exporte BOOTH_STATION_ID (ex.: 'booth-a') e reinicie o daemon.`
    );
  }

  if (resolution.source === 'hostname') {
    return (
      `[Daemon] Estação identificada como '${resolution.stationId}' (hostname). ` +
      `Defina BOOTH_STATION_ID no .env para um nome estável se os dois Macs puderem ` +
      `compartilhar hostname na rede do evento.`
    );
  }

  return null;
}
