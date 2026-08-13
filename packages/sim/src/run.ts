import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMatrix, type SimMatrix, type SimMatrixCell } from './combat-model.js';
import { ARCHETYPES, SKILL_PROFILES } from './archetypes.js';

// 200 seeds lacks the statistical power to reliably distinguish a true win rate near 0% from a
// true win rate of, say, 0.5%: at 200 samples, a handful of lucky/unlucky seeds can flip a cell's
// reported rate by several percentage points. 2,000 seeds (confirmed to still complete in a few
// seconds, well inside the 60s budget) is enough for events down to roughly the 0.1-1% range to
// show up reliably as nonzero (or reliably as zero) instead of as sampling noise.
const SEED_COUNT = 2000;
const seeds = Array.from({ length: SEED_COUNT }, (_, i) => i + 1);

function pctBr(fraction: number): string {
  return `${(fraction * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

function secondsBr(value: number | null): string {
  if (value === null) return '—';
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}s`;
}

function numberBr(value: number, fractionDigits = 1): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits });
}

function scoreBr(value: number): string {
  return Math.round(value).toLocaleString('pt-BR');
}

function defeatSummary(cell: SimMatrixCell): string {
  if (cell.timeoutShareOfLosses === 0 && cell.deathShareOfLosses === 0) return '—';
  return `${pctBr(cell.timeoutShareOfLosses)} tempo / ${pctBr(cell.deathShareOfLosses)} morte`;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

function printTable(matrix: SimMatrix): void {
  const columns = [
    { header: 'arquétipo', width: 16 },
    { header: 'habilidade', width: 13 },
    { header: 'vitórias', width: 10 },
    { header: 'TTK p50', width: 9 },
    { header: 'TTK p90', width: 9 },
    { header: 'dano', width: 6 },
    { header: 'score', width: 9 },
    { header: 'derrota', width: 28 }
  ];

  console.log(columns.map((c) => pad(c.header, c.width)).join(' '));

  for (const cell of matrix.cells) {
    const row = [
      pad(cell.archetype, columns[0].width),
      pad(cell.skill, columns[1].width),
      pad(pctBr(cell.winRate), columns[2].width),
      pad(secondsBr(cell.ttkP50), columns[3].width),
      pad(secondsBr(cell.ttkP90), columns[4].width),
      pad(numberBr(cell.avgDamageTaken), columns[5].width),
      pad(scoreBr(cell.avgScore), columns[6].width),
      pad(defeatSummary(cell), columns[7].width)
    ];
    console.log(row.join(' '));
  }
}

function main(): void {
  const start = Date.now();
  const matrix = runMatrix({ archetypes: ARCHETYPES, skills: SKILL_PROFILES, seeds });
  const elapsedS = (Date.now() - start) / 1000;

  console.log(`\nSimulador de balanceamento — ${Object.keys(ARCHETYPES).length} arquétipos × ${Object.keys(SKILL_PROFILES).length} habilidades × ${seeds.length} seeds`);
  console.log(`(concluído em ${elapsedS.toFixed(2)}s)\n`);
  printTable(matrix);

  // Written to the repo root (see root .gitignore); this is a diagnostic artifact for Task B8,
  // not something committed alongside the simulator itself.
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const outputPath = path.join(repoRoot, 'sim-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(matrix, null, 2));
  console.log(`\nResultado completo gravado em ${outputPath}`);
}

main();
