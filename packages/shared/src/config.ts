export interface EndpointConfig {
  /** Prefixo das chamadas ao bridge. String vazia significa "mesma origem". */
  bridgeBase: string;
  bridgeWsUrl: string;
  /** Endereço da API de ingestão em Cloud Run. null quando o app não fala com a nuvem. */
  cloudApiBase: string | null;
}

/**
 * Resolve endereços a partir do ambiente de build e da origem em execução.
 * Recebe `env` e `origin` como parâmetros em vez de ler `import.meta.env` e
 * `window` porque o pacote shared também é consumido pelo daemon em Node,
 * onde nenhum dos dois existe.
 */
export function resolveEndpoints(
  env: Record<string, string | undefined>,
  origin: string
): EndpointConfig {
  const stripSlash = (s: string) => s.replace(/\/+$/, '');
  const bridgeBase = env.VITE_BRIDGE_BASE ? stripSlash(env.VITE_BRIDGE_BASE) : '';
  const wsOrigin = bridgeBase || origin;
  const bridgeWsUrl = `${wsOrigin.replace(/^http/, 'ws')}/events`;
  const cloudApiBase = env.VITE_CLOUD_API_BASE ? stripSlash(env.VITE_CLOUD_API_BASE) : null;
  return { bridgeBase, bridgeWsUrl, cloudApiBase };
}
