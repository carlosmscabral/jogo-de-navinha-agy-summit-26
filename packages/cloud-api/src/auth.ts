/**
 * Autenticação do token de ingestão de escopo único (Spec 08 §6.1).
 * Comparação de tempo constante: o token é curto e o endpoint é público.
 */
import { timingSafeEqual } from 'node:crypto';

export function isAuthorized(header: string | undefined, expected: string | undefined): boolean {
  if (!expected) return false;                    // servidor sem token não aceita nada
  if (!header?.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice(7));
  const want = Buffer.from(expected);
  if (given.length !== want.length) return false;
  return timingSafeEqual(given, want);
}
