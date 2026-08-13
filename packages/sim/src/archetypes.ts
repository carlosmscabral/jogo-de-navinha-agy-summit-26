import { DEV_ARCHETYPES, FALLBACK_PRESETS, type ShipSpecification } from '@jogo/shared';
import type { SkillProfile } from './combat-model.js';

/**
 * The 8 ship archetypes the simulator sweeps (Spec 09 §5.1): the 3 forge fallback presets plus
 * the 5 range-derived synthetic archetypes. Sourced from `@jogo/shared` rather than from
 * `player-app/src/dev/presets.ts`'s `DEV_PRESETS` directly — `packages/sim` only depends on
 * `@jogo/shared` (see its `package.json`), and there is no clean way for a Phaser-free package to
 * import from inside `player-app`'s source tree. `@jogo/shared` is the common Phaser-free
 * ancestor both `DEV_PRESETS` (via `DEV_ARCHETYPES`) and `ARCHETYPES` here draw from, so this is
 * still a single list, not two: both ultimately point at the same `DEV_ARCHETYPES` object.
 */
export const ARCHETYPES: Record<string, ShipSpecification> = {
  interceptor: FALLBACK_PRESETS.interceptor,
  vanguard: FALLBACK_PRESETS.vanguard,
  striker: FALLBACK_PRESETS.striker,
  ...DEV_ARCHETYPES
};

/**
 * First-cut skill-level estimates (Spec 09 §6). These numbers are **not measured** — there is no
 * event telemetry yet to calibrate against, since the booth hasn't run. They're a judgment call,
 * documented here, to be recalibrated once real match telemetry exists:
 *   - `iniciante`: rarely lands primary shots, fires in short bursts, barely uses the secondary,
 *     and gets hit often (never played a shmup, holding the stick more than the trigger).
 *   - `mediano`: roughly the median booth visitor — steady fire, average reflexes.
 *   - `experiente`: near-constant fire, good dodge instincts, actively times the secondary.
 * `iniciante` intentionally has lower accuracy/fireUptime/secondaryUptime and a higher
 * hitsTakenPerSecond than `experiente`; `mediano` sits between the two on every axis.
 */
export const SKILL_PROFILES: Record<'iniciante' | 'mediano' | 'experiente', SkillProfile> = {
  iniciante: {
    name: 'iniciante',
    accuracy: 0.35, // ESTIMATIVA inicial (Spec 09 §6) -- recalibrar com dados reais do evento.
    fireUptime: 0.45, // ESTIMATIVA inicial -- recalibrar com dados reais do evento.
    hitsTakenPerSecond: 0.8, // ESTIMATIVA inicial -- recalibrar com dados reais do evento.
    secondaryUptime: 0.2 // ESTIMATIVA inicial -- recalibrar com dados reais do evento.
  },
  mediano: {
    name: 'mediano',
    accuracy: 0.55, // ESTIMATIVA inicial (Spec 09 §6) -- recalibrar com dados reais do evento.
    fireUptime: 0.7, // ESTIMATIVA inicial -- recalibrar com dados reais do evento.
    hitsTakenPerSecond: 0.4, // ESTIMATIVA inicial -- recalibrar com dados reais do evento.
    secondaryUptime: 0.5 // ESTIMATIVA inicial -- recalibrar com dados reais do evento.
  },
  experiente: {
    name: 'experiente',
    accuracy: 0.8, // ESTIMATIVA inicial (Spec 09 §6) -- recalibrar com dados reais do evento.
    fireUptime: 0.9, // ESTIMATIVA inicial -- recalibrar com dados reais do evento.
    hitsTakenPerSecond: 0.15, // ESTIMATIVA inicial -- recalibrar com dados reais do evento.
    secondaryUptime: 0.85 // ESTIMATIVA inicial -- recalibrar com dados reais do evento.
  }
};
