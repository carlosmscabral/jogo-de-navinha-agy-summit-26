import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { WorkspaceGeneratorService } from './workspace-generator.js';

function generate(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'booth-ws-'));
  WorkspaceGeneratorService.generateWorkspace({
    sessionDir: dir,
    pilot: { callsign: 'TESTE', company_raw: 'Acme', company_canonical: 'Acme' },
    energy_sliders: { offense: 40, speed: 20, defense: 25, tech: 15 },
    selected_mcps: ['weapons-arsenal'],
    selected_subagents: ['combat-strategist'],
    mcpsDistDir: '/tmp/fake-mcps'
  });
  return dir;
}

describe('WorkspaceGeneratorService — GEMINI.md', () => {
  it('contém a regra anti-alucinação', () => {
    const dir = generate();
    const md = fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8');
    assert.match(md, /PROIBIDO INVENTAR VALORES/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('não entrega um ship_spec.json de exemplo preenchido', () => {
    const dir = generate();
    const md = fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8');
    assert.doesNotMatch(md, /"damage"\s*:\s*\d/, 'nenhum valor numérico de atributo no template');
    assert.doesNotMatch(md, /"svg_path_data"\s*:\s*"M/, 'nenhum SVG de exemplo copiável');
    assert.doesNotMatch(md, /"synergies_unlocked"\s*:\s*\[\s*"/, 'nenhuma sinergia literal');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('não declara MCPs ou sub-agentes que o visitante não escolheu', () => {
    const dir = generate();
    const md = fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8');
    assert.doesNotMatch(md, /hull-propulsion/);
    assert.doesNotMatch(md, /cybernetics-shields/);
    assert.doesNotMatch(md, /systems-engineer/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('Fast-Grill-Me (PASSO 1) menciona a lista curada de cores de destaque como opcional', () => {
    const dir = generate();
    const md = fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8');
    assert.match(md, /Rosa Choque/);
    assert.match(md, /Ciano Elétrico/);
    assert.match(md, /Verde Ácido/);
    assert.match(md, /Vermelho Sangue/);
    assert.match(md, /Dourado Royal/);
    assert.match(md, /Branco Gélido/);
    assert.match(md, /Opcional/i);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('WorkspaceGeneratorService — aesthetic-designer.md', () => {
  it('permite recolorir o tema escolhido para uma cor de destaque sem perder a identidade estrutural', () => {
    const dir = generate();
    const md = fs.readFileSync(path.join(dir, '.agents', 'agents', 'aesthetic-designer.md'), 'utf8');

    // The 3 structural themes must still be present and drive the SVG's identity.
    assert.match(md, /Synthwave/);
    assert.match(md, /Dark Void/);
    assert.match(md, /Cyberpunk Gold/);

    // The curated accent-color list must be present for the subagent to honor.
    assert.match(md, /Rosa Choque/);
    assert.match(md, /Ciano Elétrico/);
    assert.match(md, /Verde Ácido/);
    assert.match(md, /Vermelho Sangue/);
    assert.match(md, /Dourado Royal/);
    assert.match(md, /Branco Gélido/);

    // Key concept: recolor toward the requested accent while keeping structure intact,
    // and fall back to the theme's default palette when no (recognized) color is given.
    assert.match(md, /identidade estrutural/i);
    assert.match(md, /opcional/i);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
