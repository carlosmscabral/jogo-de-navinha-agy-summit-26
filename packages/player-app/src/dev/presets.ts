import { DEV_ARCHETYPES, FALLBACK_PRESETS, ShipSpecification } from '@jogo/shared';

/**
 * `minimo`/`maximo`/`glass_cannon`/`vulcan_max`/`tanque` are range-derived synthetic archetypes
 * (Spec 09 §5.1) that live in `@jogo/shared` as `DEV_ARCHETYPES` (Task B7 amendment), since the
 * Phaser-free headless simulator's `ARCHETYPES` needs the exact same list and can't import from
 * inside `player-app`. This spread keeps `DEV_PRESETS`'s shape and every consumer (DevHarness.tsx,
 * presets.test.ts) unchanged — it's a pure "move the definition, keep the same runtime object"
 * refactor.
 */
export const DEV_PRESETS: Record<string, ShipSpecification> = {
  interceptor: FALLBACK_PRESETS.interceptor,
  vanguard: FALLBACK_PRESETS.vanguard,
  striker: FALLBACK_PRESETS.striker,
  ...DEV_ARCHETYPES
};
