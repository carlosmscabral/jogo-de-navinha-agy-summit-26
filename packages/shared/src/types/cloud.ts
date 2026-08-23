/**
 * Modelo de dados do Firestore — Spec 05 §4 e Spec 08 §6.3.
 *
 * As três formas de documento são declaradas uma única vez, aqui, e importadas
 * tanto pelo escritor (`cloud-api`, Tarefa C3) quanto pelo leitor
 * (`leaderboard-app`, Tarefa C6). Nenhum pacote declara sua própria cópia — é
 * isso que faz o compilador, e não uma revisão humana, pegar deriva de schema.
 */
import type { ScoreBreakdown, MatchTelemetry, ShipSpecification } from './ship.js';

/** Banco Firestore nomeado. Nunca o (default). Spec 08 §6.3. */
export const DATABASE_ID = 'jogo-navinha';

/**
 * Versão da forma dos documentos. Nasce em 1 e sobe quando um campo muda de
 * significado ou some. Custa um inteiro por documento e evita ter que adivinhar,
 * depois do evento, qual forma um documento tem. Spec 05 §4.1.
 */
export const SCHEMA_VERSION = 1;

/** Documento em /matches/{match_id}. `match_id` é a chave: reenviar é idempotente. */
export interface MatchDocument {
  schema_version: number;
  /** UUID v4. Nunca timestamp — duas estações colidiriam. Spec 05 §4.1. */
  match_id: string;
  pilot_id: string;
  callsign: string;
  company_raw: string;
  company_canonical: string;
  company_confidence: number;
  final_score: number;
  score_breakdown: ScoreBreakdown;
  telemetry: MatchTelemetry;
  ship_spec_snapshot: ShipSpecification;
  /** ISO 8601 no cliente. O servidor sobrescreve com FieldValue.serverTimestamp(). */
  created_at: string;
  /** Marcado quando a canonicalização por modelo ainda não rodou (Spec 05 §3.2). */
  needs_company_review?: boolean;
  /**
   * Marcado por uma correção do painel de admin (Tarefa C7). Anular exclui a partida de
   * todos os agregados recalculados (`company_rankings`), mas o documento nunca é apagado —
   * `DELETE` destruiria a evidência de que a partida existiu, o que importa se alguém
   * contestar uma pontuação durante o evento.
   */
  voided?: boolean;
}

/** Documento em /pilots/{pilot_id}. Spec 05 §4.2. */
export interface PilotDocument {
  schema_version: number;
  pilot_id: string;
  callsign: string;
  company_canonical: string;
  /** ISO 8601 no cliente. O servidor sobrescreve com FieldValue.serverTimestamp(). */
  created_at: string;
  best_score: number;
  matches_played: number;
}

/** Documento em /company_rankings/{company_canonical}. Spec 05 §4.3. */
export interface CompanyRankingDocument {
  schema_version: number;
  company_canonical: string;
  total_score: number;
  pilots_count: number;
  top_individual_score: number;
  /** ISO 8601 no cliente. O servidor sobrescreve com FieldValue.serverTimestamp(). */
  last_updated: string;
}

/**
 * Documento único em /companies/catalog. Espelha `config/companies.json` (Tarefa C0b), mas
 * é a cópia que o painel de admin (Tarefa C7) edita — a fonte de verdade local e offline do
 * estande continua sendo o arquivo. A reconciliação entre os dois é manual e explícita (um
 * botão "exportar para o estande" no painel), nunca automática: um segundo canal nuvem→estande
 * é exatamente o que a Spec 05 §5 evita.
 */
export interface CompanyCatalogDocument {
  schema_version: number;
  companies: string[];
  /** ISO 8601 no cliente. O servidor sobrescreve com FieldValue.serverTimestamp(). */
  updated_at: string;
}

/**
 * Nome de campo checado pelo compilador, para as consultas do Firestore.
 * `orderBy(field<MatchDocument>('final_score'), 'desc')` quebra o build se o
 * campo for renomeado; `orderBy('final_score', 'desc')` compila e falha no evento.
 */
export function field<T>(name: keyof T & string): string {
  return name;
}

/**
 * Campos que uma correção manual de partida (Tarefa C7, `PATCH /v1/admin/matches/:id`) pode
 * tocar. Tudo opcional: o operador manda só o que muda. Declarado uma única vez aqui (revisão
 * final Fase C, Minor 10) — antes disso, `packages/cloud-api/src/admin.ts` e
 * `packages/admin-app/src/api.ts` tinham cada um sua própria cópia idêntica, exatamente o
 * tipo de deriva que este arquivo existe para o compilador pegar em vez de uma revisão humana.
 */
export interface MatchCorrection {
  callsign?: string;
  company_canonical?: string;
  final_score?: number;
  voided?: boolean;
}
