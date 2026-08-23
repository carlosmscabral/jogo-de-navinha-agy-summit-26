/// <reference types="vite/client" />
import { resolveEndpoints } from '@jogo/shared';

// `window` doesn't exist under Vitest's `node` environment (mirrors leaderboard-app's
// config.ts, Tarefa C6) — falls back to an empty origin there; in the browser this is
// always window.location.origin.
const origin = typeof window !== 'undefined' ? window.location.origin : '';

export const ENDPOINTS = resolveEndpoints(
  import.meta.env as unknown as Record<string, string | undefined>,
  origin
);
