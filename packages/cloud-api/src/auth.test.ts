import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isAuthorized } from './auth.js';

describe('isAuthorized', () => {
  it('aceita o token configurado', () => {
    assert.equal(isAuthorized('Bearer segredo-do-estande', 'segredo-do-estande'), true);
  });

  it('recusa token errado, ausente ou com esquema errado', () => {
    assert.equal(isAuthorized('Bearer outro', 'segredo-do-estande'), false);
    assert.equal(isAuthorized(undefined, 'segredo-do-estande'), false);
    assert.equal(isAuthorized('segredo-do-estande', 'segredo-do-estande'), false);
  });

  it('recusa tudo quando o servidor subiu sem token configurado', () => {
    assert.equal(isAuthorized('Bearer qualquer', ''), false);
    assert.equal(isAuthorized('Bearer qualquer', undefined), false);
  });
});
