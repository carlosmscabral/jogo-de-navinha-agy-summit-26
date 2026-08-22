import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { moderateCallsign } from './moderation-l2.js';

const allow = async () => JSON.stringify({ safe: true, reason: '' });
const block = async () => JSON.stringify({ safe: false, reason: 'insulto velado' });
const lixo = async () => 'desculpe, não posso ajudar com isso';
const trava = () => new Promise<string>(() => {});

describe('moderateCallsign', () => {
  it('libera o que o modelo considera seguro', async () => {
    assert.equal((await moderateCallsign('SKILLER', allow, 1200)).verdict, 'allow');
  });

  it('bloqueia o que o modelo considera ofensivo', async () => {
    const r = await moderateCallsign('xxx', block, 1200);
    assert.equal(r.verdict, 'block');
    assert.equal(r.reason, 'insulto velado');
  });

  it('falha FECHADO quando a resposta do modelo não é o JSON esperado', async () => {
    assert.equal((await moderateCallsign('DUVIDOSO', lixo, 1200)).verdict, 'block');
  });

  it('falha FECHADO no timeout do modelo', async () => {
    assert.equal((await moderateCallsign('DUVIDOSO', trava, 50)).verdict, 'block');
  });
});
