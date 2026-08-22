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
 * Nome de campo checado pelo compilador, para as consultas do Firestore.
 * `orderBy(field<MatchDocument>('final_score'), 'desc')` quebra o build se o
 * campo for renomeado; `orderBy('final_score', 'desc')` compila e falha no evento.
 */
export function field<T>(name: keyof T & string): string {
  return name;
}
