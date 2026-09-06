/**
 * Cliente HTTP fino para `/v1/admin/*` (Tarefa C7, `packages/cloud-api/src/admin.ts`).
 * Sem token no código, e isso é de propósito: quem protege estas rotas e o painel servido sob
 * `/admin` é uma senha HTTP Basic (`isAdminAuthorized`, em `packages/cloud-api/src/admin-auth.ts`),
 * a única camada de autenticação da topologia — não há IAP, e o Gate M3 provou ao vivo que não
 * pode haver num serviço Cloud Run compartilhado com a ingestão do estande (ver o comentário de
 * `requireAdminAuth` em `packages/cloud-api/src/index.ts`).
 * Nada disso exige código aqui: o navegador guarda a credencial depois do
 * prompt nativo de login e a reenvia sozinho em toda requisição de mesma origem, inclusive
 * as que este cliente faz via `fetch`. Se o painel pedir login antes de qualquer chamada
 * deste arquivo aparecer, é essa senha, não um bug de autenticação aqui. Ver README do
 * cloud-api ("Autenticação do painel de admin").
 */
import type { MatchDocument, CompanyCatalogDocument, MatchCorrection } from '@jogo/shared';
import { ENDPOINTS } from './config.js';

// '' quando não configurado: mesma origem, o caso normal em produção (o admin-app é
// servido pelo mesmo container Cloud Run da API, sob /admin).
const BASE = ENDPOINTS.cloudApiBase ?? '';

/**
 * Erro de resposta HTTP que preserva o status e o corpo.
 *
 * Antes daqui só sobrevivia a mensagem, e isso bastava enquanto todo erro do painel era
 * "seu corpo está errado" (400). Deixou de bastar quando o catálogo de empresas passou a
 * alimentar as duas estações: um `PUT` recusado por concorrência volta como **409** e traz
 * o catálogo atual no corpo, e a tela precisa dos dois para dizer "outro operador salvou
 * primeiro" em vez de repetir uma mensagem de erro genérica.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) }
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new ApiError(
      (body as { error?: string }).error ?? `Request to ${path} failed with status ${res.status}`,
      res.status,
      body
    );
  }
  return res.json() as Promise<T>;
}

export interface ListMatchesQuery {
  q?: string;
  company?: string;
  limit?: number;
}

export function fetchMatches(query: ListMatchesQuery): Promise<{ matches: MatchDocument[] }> {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.company) params.set('company', query.company);
  if (query.limit) params.set('limit', String(query.limit));
  const qs = params.toString();
  return requestJson(`/v1/admin/matches${qs ? `?${qs}` : ''}`);
}

export function patchMatch(matchId: string, changes: MatchCorrection): Promise<{ status: string }> {
  return requestJson(`/v1/admin/matches/${encodeURIComponent(matchId)}`, {
    method: 'PATCH',
    body: JSON.stringify(changes)
  });
}

export interface BulkMatchActionResult {
  succeeded: string[];
  failed: Array<{ match_id: string; reason: string }>;
}

/**
 * Tarefa C9 — ações em lote no painel. `action: 'void'` reusa `patchMatch({voided: true})`
 * item a item (não-destrutivo); `action: 'delete'` apaga de verdade (`deleteMatch`,
 * `packages/cloud-api/src/admin.ts`), pensado para limpar dados de teste do evento.
 */
export function bulkUpdateMatches(matchIds: string[], action: 'void' | 'delete'): Promise<BulkMatchActionResult> {
  return requestJson('/v1/admin/matches/bulk', {
    method: 'POST',
    body: JSON.stringify({ match_ids: matchIds, action })
  });
}

export function fetchCompanies(): Promise<CompanyCatalogDocument> {
  return requestJson('/v1/admin/companies');
}

/**
 * Grava o catálogo com concorrência otimista. `expectedVersion` é a versão que a tela carregou;
 * se outra pessoa (ou a outra aba do mesmo operador) salvou nesse meio-tempo, o servidor recusa
 * com 409 em vez de sobrescrever em silêncio — era `.set()` puro, last-write-wins, e isso deixou
 * de ser aceitável quando este documento virou a fonte única das duas estações.
 *
 * `force` só existe para o caso legítimo de esvaziar o catálogo de propósito, que o servidor
 * recusa por padrão. Não usar para "resolver" um 409: aí o certo é recarregar e reaplicar.
 */
export function putCompanies(
  companies: string[],
  opts: { expectedVersion?: number; force?: boolean } = {}
): Promise<{ status: string; version: number }> {
  return requestJson('/v1/admin/companies', {
    method: 'PUT',
    body: JSON.stringify({
      companies,
      ...(opts.expectedVersion !== undefined ? { expectedVersion: opts.expectedVersion } : {}),
      ...(opts.force ? { force: true } : {})
    })
  });
}

export interface AdminHealthReport {
  syncQueue: {
    stations: Array<{ stationId: string; pending: number; state: string }>;
    note: string;
  };
  recentRejections: {
    items: Array<{ match_id: string; reason: string }>;
    note: string;
  };
  emergencyPreset: {
    rate: number;
    sampleSize: number;
    note: string;
  };
}

export function fetchHealth(): Promise<AdminHealthReport> {
  return requestJson('/v1/admin/health');
}
