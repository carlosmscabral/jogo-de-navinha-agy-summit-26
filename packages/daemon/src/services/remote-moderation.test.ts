import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { moderateRemotely } from './remote-moderation.js';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

/**
 * Servidores HTTP reais e efêmeros, não um `fetch` global monkey-patchado —
 * mais perto do comportamento real do cliente contra `POST /v1/moderate` em
 * `packages/cloud-api`, sem depender de rede de verdade nem de um duplo que
 * finja ser o `fetch` do runtime.
 */
function listen(handler: Handler): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

const openServers: Server[] = [];
after(() => {
  for (const s of openServers) s.close();
});

describe('moderateRemotely', () => {
  it('devolve o veredito do serviço quando ele responde', async () => {
    const { server, base } = await listen((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk; });
      req.on('end', () => {
        const { callsign } = JSON.parse(body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          verdict: callsign === 'OFENSOR' ? 'block' : 'allow',
          reason: callsign === 'OFENSOR' ? 'insulto velado' : ''
        }));
      });
    });
    openServers.push(server);

    const allow = await moderateRemotely(base, 'tok', 'PILOTO', 800);
    assert.equal(allow.verdict, 'allow');

    const block = await moderateRemotely(base, 'tok', 'OFENSOR', 800);
    assert.equal(block.verdict, 'block');
    assert.equal(block.reason, 'insulto velado');
  });

  it('devolve "unavailable" quando a rede falha, sem lançar', async () => {
    const r = await moderateRemotely('http://inexistente.invalid', 'tok', 'PILOTO', 800);
    assert.equal(r.verdict, 'unavailable');
  });

  it('devolve "unavailable" no timeout em vez de segurar o registro', async () => {
    const { server, base } = await listen((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ verdict: 'allow', reason: '' }));
      }, 500);
    });
    openServers.push(server);

    const start = Date.now();
    const r = await moderateRemotely(base, 'tok', 'PILOTO', 80);
    const elapsed = Date.now() - start;

    assert.equal(r.verdict, 'unavailable');
    assert.ok(elapsed < 400, `deveria ter desistido perto de 80ms, levou ${elapsed}ms`);
  });

  it('devolve "unavailable" quando nenhum endereço de nuvem está configurado', async () => {
    const r = await moderateRemotely(null, null, 'PILOTO', 800);
    assert.equal(r.verdict, 'unavailable');
  });
});
