/// <reference types="vite/client" />
import { resolveEndpoints } from '@jogo/shared';

export const ENDPOINTS = resolveEndpoints(
  import.meta.env as unknown as Record<string, string | undefined>,
  window.location.origin
);
