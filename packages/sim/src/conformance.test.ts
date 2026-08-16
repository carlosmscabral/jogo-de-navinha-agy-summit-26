import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BALANCE, applySynergies } from '@jogo/shared';
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
  /**
   * `telemetry.shots_fired` da mesma captura. Obrigatório: é o segundo relógio, e sem ele o
   * portão não sabe distinguir "modelo errado" de "instrumento quebrado". Ver o teste de
   * integridade abaixo.
   */
  shots_fired: number;
  /** `telemetry.boss_fight_min_fps`. Registrado para triagem; não entra em nenhuma asserção. */
  boss_fight_min_fps?: number | null;
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
  // under `node --test`, not vitest, so this is the equivalent for that runner. Both tests below
  // skip (never fail) until a human with a real browser populates harness-runs.json per its
  // README; an empty fixture must never silently read as "conformance confirmed".

  /**
   * Integridade da captura, antes de comparar qualquer coisa com o simulador.
   *
   * Com "Disparo automático" ligado a cadência é fixa e conhecida, então `shots_fired` é um
   * segundo cronômetro, independente daquele que produz `boss_ttk_s`: uma luta de T segundos cabe
   * `floor(T / intervalo) + 1` acionamentos, nem um a mais. Se os dois relógios discordam, o
   * problema é do instrumento, não do modelo -- e comparar com o simulador não significa nada.
   *
   * Foi exatamente assim que o defeito §5.10 apareceu: o `interceptor` da captura de 2026-08-16
   * trouxe 122 tiros num TTK de 8.1s, quando 8.1s a 12 tiros/s comportam 98. Os 24 excedentes
   * exigem 2.0s que o TTK não relatou, porque as armas corriam no relógio de parede e a medição no
   * relógio do mundo. Este teste transforma aquela investigação manual num portão.
   *
   * A folga é `max(5%, 2 intervalos)`: há até um acionamento de ambiguidade em cada ponta (o
   * primeiro tiro sai no quadro 1, e o último pode estar em voo quando o boss cai).
   */
  it(
    'a captura é internamente coerente: shots_fired confere com boss_ttk_s',
    { skip: harnessRuns.length === 0 ? 'harness-runs.json está vazio -- ver fixtures/README.md' : false },
    () => {
      for (const fixture of harnessRuns) {
        const spec = ARCHETYPES[fixture.preset];
        assert.ok(spec, `preset desconhecido em harness-runs.json: "${fixture.preset}"`);

        const primary = applySynergies(spec).weapons.primary;
        const intervalS = 1 / primary.fire_rate;
        // `shots_fired` conta projéteis, não acionamentos: o vulcan solta 3 pelotas por tiro.
        const pellets = primary.type === 'vulcan_spread' ? BALANCE.weapons.primary.vulcan_pellet_count : 1;
        const pulls = fixture.shots_fired / pellets;
        const shotClockS = (pulls - 1) * intervalS;

        const slackS = Math.max(0.05 * fixture.boss_ttk_s, 2 * intervalS);
        assert.ok(
          Math.abs(shotClockS - fixture.boss_ttk_s) <= slackS,
          `${fixture.preset}: captura incoerente -- ${fixture.shots_fired} projéteis (${pulls} acionamentos a ` +
            `${(intervalS * 1000).toFixed(1)}ms) implicam ${shotClockS.toFixed(2)}s de luta, mas boss_ttk_s diz ` +
            `${fixture.boss_ttk_s}s. Os dois relógios da engine discordam: o instrumento está quebrado, ` +
            `não o modelo. Ver Spec 09 §5.10 e fixtures/README.md.`
        );
      }
    }
  );

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
