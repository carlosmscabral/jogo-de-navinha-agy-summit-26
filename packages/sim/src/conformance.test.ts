import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulateMatch } from './combat-model.js';
import { ARCHETYPES } from './archetypes.js';

/**
 * One real match summary captured manually from the dev harness (`npm run dev:game`), God mode
 * on, holding primary fire, never touching the secondary. See `fixtures/README.md` for the exact
 * capture procedure.
 */
interface HarnessRun {
  preset: string;
  seed: number;
  boss_ttk_s: number;
  isHardcore?: boolean;
}

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const harnessRunsPath = path.join(fixturesDir, 'harness-runs.json');
const harnessRuns: HarnessRun[] = JSON.parse(fs.readFileSync(harnessRunsPath, 'utf8'));

/**
 * God mode with the primary fire held down the whole fight, per the capture procedure in
 * `fixtures/README.md` — never touches the secondary (that procedure never presses Shift).
 */
const godModeContinuousFire = {
  name: 'experiente' as const,
  accuracy: 1.0,
  fireUptime: 1.0,
  hitsTakenPerSecond: 0,
  secondaryUptime: 0
};

describe('conformidade simulador × engine real (Spec 09 §5.1)', () => {
  it('fixtures/harness-runs.json existe e é um array', () => {
    assert.ok(Array.isArray(harnessRuns));
  });

  // node:test's `it`/`test` take an options object with `skip` instead of vitest's chainable
  // `it.skipIf(...)` (the pattern Task B4's dev-build-leak.test.ts uses) -- `packages/sim` runs
  // under `node --test`, not vitest, so this is the equivalent for that runner. Skips (never
  // fails) until a human with a real browser populates harness-runs.json per its README; an empty
  // fixture must never silently read as "conformance confirmed".
  it(
    'TTK do boss no simulador está a até 5% do TTK capturado na engine real',
    { skip: harnessRuns.length === 0 ? 'harness-runs.json está vazio -- ver fixtures/README.md para o procedimento de captura manual' : false },
    () => {
      for (const fixture of harnessRuns) {
        const spec = ARCHETYPES[fixture.preset];
        assert.ok(spec, `preset desconhecido em harness-runs.json: "${fixture.preset}"`);

        const sim = simulateMatch({
          spec,
          skill: godModeContinuousFire,
          seed: fixture.seed,
          isHardcore: fixture.isHardcore
        });

        assert.ok(sim.bossTtkSeconds !== null, `${fixture.preset}: simulador não derrotou o boss (defeatReason=${sim.defeatReason})`);

        const deviation = Math.abs(sim.bossTtkSeconds! - fixture.boss_ttk_s) / fixture.boss_ttk_s;
        assert.ok(
          deviation <= 0.05,
          `${fixture.preset}: simulador ${sim.bossTtkSeconds}s vs engine ${fixture.boss_ttk_s}s (${(deviation * 100).toFixed(1)}%)`
        );
      }
    }
  );
});
