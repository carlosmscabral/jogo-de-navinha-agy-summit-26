import type { MatchRecord, MatchTelemetry, PilotInfo, ScoreBreakdown, ShipSpecification } from '@jogo/shared';

/**
 * Mirrors `MatchCompleteData` from `./game/index.js` field-for-field, but is declared here
 * instead of imported from there: that module does `import Phaser from 'phaser'` at the top
 * level, which is unsafe to pull into a Vitest run under `environment: 'node'` (no `window`/
 * `document`). Keeping this as a structural duplicate costs nothing at the call site in
 * App.tsx -- `MatchCompleteData` satisfies it by shape -- and lets `buildMatchRecord` be
 * unit-tested without booting a game engine. If the two ever drift, TypeScript catches it at
 * the `buildMatchRecord(...)` call in App.tsx.
 */
export interface MatchOutcome {
  finalScore: number;
  victory: boolean;
  breakdown: ScoreBreakdown;
  telemetry: MatchTelemetry;
}

/**
 * Builds the record persisted to the local buffer (and, eventually, Firestore) from a finished
 * match. Pulled out of `App.tsx`'s `handleMatchComplete` so it can be exercised directly in
 * tests -- see `match-record.test.ts` -- the same pattern `EnergySlidersBuilder.tsx` already
 * uses for `rebalanceEnergySliders`.
 */
export function buildMatchRecord(
  pilot: PilotInfo,
  pilotId: string,
  shipSpec: ShipSpecification,
  result: MatchOutcome
): MatchRecord & { victory: boolean } {
  return {
    // UUID, não timestamp: este valor é a PRIMARY KEY do SQLite e vira o ID do
    // documento Firestore, onde a escrita é set() por ID. Duas estações que
    // terminam no mesmo milissegundo sobrescreveriam uma à outra em silêncio.
    // Spec 05 §4.1.
    match_id: crypto.randomUUID(),
    pilot_id: pilotId,
    callsign: pilot.callsign,
    company_canonical: pilot.company_canonical,
    company_raw: pilot.company_raw,
    // Piloto ainda sem confiança do daemon (ex.: estado inicial de registro, antes do
    // primeiro round-trip de /api/session/start) é tratado como certo, não como
    // suspeito -- mesma convenção de resolveCompany() para os caminhos que não passam
    // por resolução fresca do catálogo.
    company_confidence: pilot.company_confidence ?? 1.0,
    final_score: result.finalScore,
    telemetry: result.telemetry,
    ship_spec_snapshot: shipSpec,
    created_at: new Date().toISOString(),
    victory: result.victory,
    score_breakdown: result.breakdown
  };
}
