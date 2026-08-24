/**
 * Revisão final Fase C follow-up — Importante 5: até aqui, a garantia de que TODAS as rotas
 * `/v1/admin/*` (mais o bloco estático de `/admin`) ficam atrás de `requireAdminAuth`
 * (Tarefa C10) dependia só de uma leitura humana da ordem de registro em `index.ts`. Este
 * arquivo sobe o `app` de verdade (`express`) numa porta efêmera e bate nele por HTTP, com
 * `fetch` nativo do Node -- sem dependência nova -- para provar isso de fato, e para provar
 * que os dois mecanismos de autenticação (token Bearer do estande vs. senha Basic do painel)
 * são realmente independentes: nenhum abre a porta do outro.
 *
 * `NODE_ENV=test` é obrigatório ANTES de importar `./index.js`, porque o módulo tem efeitos
 * colaterais só na importação: a checagem `GOOGLE_CLOUD_PROJECT` que derruba o processo
 * (Crítico 4, revisão final Fase C) só é pulada com `NODE_ENV === 'test'`, e o bloco
 * `app.listen` no final do arquivo também respeita essa mesma guarda -- é por isso que
 * podemos chamar `app.listen(0, ...)` nós mesmos aqui sem duas coisas escutando a mesma
 * porta. Import dinâmico (`await import(...)`), não `import` estático, porque `import`
 * estático é hoisted e rodaria ANTES das atribuições de `process.env` abaixo.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';

process.env.NODE_ENV = 'test';
process.env.GOOGLE_CLOUD_PROJECT ||= 'jogo-navinha-test';
process.env.BOOTH_INGEST_TOKEN ||= 'test-booth-token';
process.env.ADMIN_PANEL_PASSWORD ||= 'test-admin-panel-password';
// Mesmo default de test-helpers.ts (porta 8080). Rodando fora deste sandbox específico, isto
// aponta para o mesmo emulador que os outros testes deste pacote já usam; dentro do sandbox
// descrito no README da revisão (porta 8080 ocupada por infraestrutura da plataforma, não
// relacionada), sobrescrever via `FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npm test` funciona
// igual, sem mudar nenhum arquivo commitado.
process.env.FIRESTORE_EMULATOR_HOST ||= '127.0.0.1:8080';

const { app } = await import('./index.js');

function basicAuth(password: string): string {
  return `Basic ${Buffer.from(`qualquer-usuario:${password}`).toString('base64')}`;
}

/** Ping rápido no emulador para decidir se a asserção de sucesso (200) é viável aqui. */
async function firestoreEmulatorReachable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/`, { signal: controller.signal });
    clearTimeout(timeout);
    return true;
  } catch {
    return false;
  }
}

let baseUrl: string;
let server: import('node:http').Server;

before(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

// As seis rotas administrativas registradas em index.ts sob app.use('/v1/admin', requireAdminAuth).
const ADMIN_ROUTES: Array<{ method: string; path: string }> = [
  { method: 'GET', path: '/v1/admin/matches' },
  { method: 'PATCH', path: '/v1/admin/matches/does-not-matter' },
  { method: 'POST', path: '/v1/admin/matches/bulk' },
  { method: 'GET', path: '/v1/admin/companies' },
  { method: 'PUT', path: '/v1/admin/companies' },
  { method: 'GET', path: '/v1/admin/health' }
];

describe('cobertura HTTP do middleware de admin (Tarefa C10)', () => {
  for (const route of ADMIN_ROUTES) {
    it(`${route.method} ${route.path} recusa com 401 sem credenciais`, async () => {
      const res = await fetch(`${baseUrl}${route.path}`, { method: route.method });
      assert.equal(res.status, 401, `${route.method} ${route.path} deveria exigir autenticação`);
    });
  }

  it('/admin (painel estático) recusa com 401 sem credenciais', async () => {
    const res = await fetch(`${baseUrl}/admin`, { redirect: 'manual' });
    assert.equal(res.status, 401);
  });

  it('/admin/qualquer-sub-rota também recusa com 401 sem credenciais', async () => {
    const res = await fetch(`${baseUrl}/admin/settings`, { redirect: 'manual' });
    assert.equal(res.status, 401);
  });

  it('o token Bearer do estande (BOOTH_INGEST_TOKEN) NÃO abre uma rota de admin', async () => {
    const res = await fetch(`${baseUrl}/v1/admin/health`, {
      headers: { authorization: `Bearer ${process.env.BOOTH_INGEST_TOKEN}` }
    });
    assert.equal(res.status, 401, 'o token de ingestão do estande é um privilégio diferente da senha do painel');
  });

  it('a senha Basic do painel (ADMIN_PANEL_PASSWORD) NÃO abre a rota de ingestão do estande', async () => {
    const res = await fetch(`${baseUrl}/v1/matches`, {
      method: 'POST',
      headers: { authorization: basicAuth(process.env.ADMIN_PANEL_PASSWORD!), 'content-type': 'application/json' },
      body: JSON.stringify({ matches: [] })
    });
    assert.equal(res.status, 401, 'os dois mecanismos de autenticação são independentes -- nenhum substitui o outro');
  });

  it('a senha Basic correta ABRE uma rota de admin', async (t) => {
    if (!(await firestoreEmulatorReachable())) {
      // Best-effort: sem o emulador do Firestore alcançável, GET /v1/admin/health não
      // consegue completar a consulta que getHealthReport (admin.ts) faz -- mas isso é uma
      // limitação de ambiente, não do middleware de autenticação, que já foi coberto pelos
      // casos 401 acima (o objetivo central deste arquivo). Pula em vez de falhar.
      t.skip('emulador do Firestore inalcançável neste ambiente -- ver comentário acima');
      return;
    }
    const res = await fetch(`${baseUrl}/v1/admin/health`, {
      headers: { authorization: basicAuth(process.env.ADMIN_PANEL_PASSWORD!) }
    });
    assert.equal(res.status, 200, 'a senha correta precisa efetivamente abrir a rota, não só recusar as erradas');
  });
});
