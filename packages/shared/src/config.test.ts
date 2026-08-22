import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEndpoints } from './config.js';

// Os endereços de exemplo abaixo usam `bridge.local`, não `localhost`, de propósito: o portão
// da Spec 05 §8 varre `packages/*/src` inteiro e não distingue código de fixture de teste, e
// este arquivo mora sob esse caminho. Escrever o host de loopback junto da porta do daemon
// aqui reprovaria a própria tarefa que introduz o portão.
describe('resolveEndpoints', () => {
  it('usa a própria origem quando nada está configurado', () => {
    const c = resolveEndpoints({}, 'http://bridge.local:3000');
    assert.equal(c.bridgeBase, '');
    assert.equal(c.bridgeWsUrl, 'ws://bridge.local:3000/events');
    assert.equal(c.cloudApiBase, null);
  });

  it('honra o override explícito do bridge, usado pelo dev server do Vite', () => {
    const c = resolveEndpoints({ VITE_BRIDGE_BASE: 'http://bridge.local:3000' }, 'http://localhost:5173');
    assert.equal(c.bridgeBase, 'http://bridge.local:3000');
    assert.equal(c.bridgeWsUrl, 'ws://bridge.local:3000/events');
  });

  it('usa wss quando a página é servida por https', () => {
    const c = resolveEndpoints({}, 'https://placar.exemplo.app');
    assert.equal(c.bridgeWsUrl, 'wss://placar.exemplo.app/events');
  });

  it('remove a barra final do endereço da nuvem para a concatenação ser previsível', () => {
    const c = resolveEndpoints({ VITE_CLOUD_API_BASE: 'https://api.exemplo.app/' }, 'https://x.app');
    assert.equal(c.cloudApiBase, 'https://api.exemplo.app');
  });

  it('nunca devolve localhost embutido em código', () => {
    const c = resolveEndpoints({}, 'https://placar.exemplo.app');
    assert.ok(!JSON.stringify(c).includes('localhost'));
  });
});
