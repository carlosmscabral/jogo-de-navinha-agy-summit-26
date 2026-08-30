import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BOOTH_KICKOFF_PROMPT } from '@jogo/shared';

/**
 * A frase de abertura do estande tem que ser a MESMA em três lugares que não conseguem se importar:
 * a constante em `packages/shared/src/constants/branding.ts` (fonte), o `AGENTS.md` gerado (que diz
 * ao agente qual será a primeira mensagem do piloto) e `scripts/booth-terminal.sh`, que a injeta via
 * `agy --prompt-interactive`. O shell não importa TypeScript, então lá ela vai literal — mesma
 * convenção dos arquivos `index.html`. Este teste é o que impede as duas cópias de divergirem em
 * silêncio, no mesmo espírito de `schema-sync.test.ts`.
 *
 * Se falhar: edite `BOOTH_KICKOFF_PROMPT` e copie o novo valor para `KICKOFF_PROMPT=` no script.
 */
describe('BOOTH_KICKOFF_PROMPT x scripts/booth-terminal.sh', () => {
  // dist/services/ -> dist/ -> packages/daemon/ -> packages/ -> raiz do repo
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
  const scriptPath = path.join(repoRoot, 'scripts', 'booth-terminal.sh');

  it('o script injeta exatamente a frase da constante', () => {
    const script = fs.readFileSync(scriptPath, 'utf8');
    assert.ok(
      script.includes(`KICKOFF_PROMPT="${BOOTH_KICKOFF_PROMPT}"`),
      `booth-terminal.sh não define KICKOFF_PROMPT="${BOOTH_KICKOFF_PROMPT}"`
    );
  });

  it('o script passa a frase para o agy via --prompt-interactive', () => {
    const script = fs.readFileSync(scriptPath, 'utf8');
    assert.match(script, /exec agy --prompt-interactive "\$2"/);
    // A flag é sondada antes de usada; sem a sonda, um CLI sem a flag deixa o visitante numa tela
    // morta em vez de cair no `agy` puro.
    assert.match(script, /agy --help .*grep -q -- '--prompt-interactive'/);
  });
});
