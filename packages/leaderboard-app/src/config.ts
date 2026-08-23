/// <reference types="vite/client" />
import { resolveEndpoints } from '@jogo/shared';

// `window` doesn't exist when this module is pulled in under Vitest's `node`
// environment (Tarefa C6's leaderboard-source.test.ts imports firestore-source.ts,
// which imports this file for the bridge fallback endpoints). Falls back to an
// empty origin in that case; in the browser this is always window.location.origin.
const origin = typeof window !== 'undefined' ? window.location.origin : '';

export const ENDPOINTS = resolveEndpoints(
  import.meta.env as unknown as Record<string, string | undefined>,
  origin
);
