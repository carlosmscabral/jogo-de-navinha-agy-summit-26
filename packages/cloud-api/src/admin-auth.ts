/**
 * Senha do painel de admin (Tarefa C10), em cima do Identity-Aware Proxy do Cloud Run.
 * HTTP Basic: o navegador mostra o prompt nativo de login sozinho, sem sessão, sem cookie.
 * Comparação de tempo constante, mesmo padrão de auth.ts.
 */
import { timingSafeEqual } from 'node:crypto';

export function isAdminAuthorized(header: string | undefined, expected: string | undefined): boolean {
  if (!expected) return false;
  if (!header?.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const password = decoded.slice(decoded.indexOf(':') + 1);
  const given = Buffer.from(password);
  const want = Buffer.from(expected);
  if (given.length !== want.length) return false;
  return timingSafeEqual(given, want);
}
