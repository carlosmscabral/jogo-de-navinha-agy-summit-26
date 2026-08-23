/**
 * Cliente HTTP fino para `/v1/admin/*` (Tarefa C7, `packages/cloud-api/src/admin.ts`).
 * Sem token no código: em produção o Cloud Run serve estas rotas atrás do Identity-Aware
 * Proxy, que já autentica a conta Google de quem opera antes de a requisição chegar aqui.
 * Desde a Tarefa C10, uma segunda camada em código — senha HTTP Basic, `isAdminAuthorized`
 * em `packages/cloud-api/src/admin-auth.ts` — também protege estas rotas e o painel servido
 * sob `/admin`. Isso não exige nenhum código aqui: o navegador guarda a credencial depois do
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

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) }
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error ?? `Request to ${path} failed with status ${res.status}`);
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

export function putCompanies(companies: string[]): Promise<{ status: string }> {
  return requestJson('/v1/admin/companies', { method: 'PUT', body: JSON.stringify({ companies }) });
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
