import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isAdminAuthorized } from './admin-auth.js';

function basic(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

describe('isAdminAuthorized', () => {
  it('aceita a senha configurada, com qualquer usuário no par user:pass', () => {
    assert.equal(isAdminAuthorized(basic('admin', 'segredo-do-painel'), 'segredo-do-painel'), true);
    assert.equal(isAdminAuthorized(basic('qualquer-usuario', 'segredo-do-painel'), 'segredo-do-painel'), true);
  });

  it('recusa senha errada, cabeçalho ausente, ou esquema errado', () => {
    assert.equal(isAdminAuthorized(basic('admin', 'senha-errada'), 'segredo-do-painel'), false);
    assert.equal(isAdminAuthorized(undefined, 'segredo-do-painel'), false);
    assert.equal(
      isAdminAuthorized(`Bearer ${Buffer.from('admin:segredo-do-painel').toString('base64')}`, 'segredo-do-painel'),
      false
    );
  });

  it('recusa tudo quando o servidor subiu sem ADMIN_PANEL_PASSWORD configurado', () => {
    assert.equal(isAdminAuthorized(basic('admin', 'qualquer'), ''), false);
    assert.equal(isAdminAuthorized(basic('admin', 'qualquer'), undefined), false);
  });
});
