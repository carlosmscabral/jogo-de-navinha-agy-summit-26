/**
 * Senha do painel de admin (Tarefa C10) — a ÚNICA camada de autenticação do painel. Não há IAP
 * nesta topologia; ver o comentário de `requireAdminAuth` em index.ts para o porquê (verificado
 * ao vivo no Gate M3, 2026-08-24).
 *
 * HTTP Basic: o navegador mostra o prompt nativo de login sozinho, sem sessão, sem cookie.
 * O nome de usuário é IGNORADO de propósito — só a senha é comparada, e em tempo constante,
 * mesmo padrão de auth.ts. Um segredo só, sem par usuário/senha para o staff decorar.
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
