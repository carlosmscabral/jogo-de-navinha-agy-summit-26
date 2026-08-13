import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const distDir = path.join(packageRoot, 'dist');

describe('build de produção', () => {
  it.skipIf(!fs.existsSync(distDir))('não contém o harness de desenvolvimento', () => {
    expect(fs.existsSync(path.join(distDir, 'dev.html'))).toBe(false);

    const bundled = fs
      .readdirSync(path.join(distDir, 'assets'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => fs.readFileSync(path.join(distDir, 'assets', f), 'utf8'))
      .join('\n');

    // Asserting on the `DevHarness` identifier is unreliable: esbuild's production minifier
    // mangles local identifiers, so a leaked-but-minified bundle would still pass a check against
    // that name. A PT-BR UI string literal survives minification (string literals aren't
    // renamed), so it reliably catches a leak even through minification.
    expect(bundled).not.toContain('Harness de Desenvolvimento');
  });
});
