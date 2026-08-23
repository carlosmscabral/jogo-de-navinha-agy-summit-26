/**
 * Cliente HTTP fino para `/v1/admin/*` (Tarefa C7, `packages/cloud-api/src/admin.ts`).
 * Sem token: em produção o Cloud Run serve estas rotas atrás do Identity-Aware Proxy, que
 * já autentica a conta Google de quem opera antes de a requisição chegar aqui — não há
 * nenhum segredo de aplicação para este cliente carregar. Ver README do cloud-api.
 */
import type { MatchDocument, CompanyCatalogDocument } from '@jogo/shared';
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

export interface MatchCorrection {
  callsign?: string;
  company_canonical?: string;
  final_score?: number;
  voided?: boolean;
}

export function patchMatch(matchId: string, changes: MatchCorrection): Promise<{ status: string }> {
  return requestJson(`/v1/admin/matches/${encodeURIComponent(matchId)}`, {
    method: 'PATCH',
    body: JSON.stringify(changes)
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
