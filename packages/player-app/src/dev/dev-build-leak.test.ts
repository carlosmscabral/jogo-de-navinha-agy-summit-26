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

    expect(bundled).not.toContain('DevHarness');
  });
});
