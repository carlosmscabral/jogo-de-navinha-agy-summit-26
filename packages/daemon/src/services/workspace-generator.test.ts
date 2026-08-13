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

  it('não declara MCPs ou sub-agentes que o visitante não escolheu como ativos, nem lhes atribui contrato de retorno', () => {
    const dir = generate();
    const md = fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8');
    // hull-propulsion/cybernetics-shields/systems-engineer podem aparecer apenas dentro do
    // parágrafo que instrui a OMITIR seus campos (ver Fix 3) -- nunca como MCP/sub-agente
    // ativo, nem como origem de um contrato de retorno.
    assert.doesNotMatch(md, /SERVIDORES MCP ATIVOS:[^\n]*hull-propulsion/);
    assert.doesNotMatch(md, /SERVIDORES MCP ATIVOS:[^\n]*cybernetics-shields/);
    assert.doesNotMatch(md, /SUB-AGENTES ATIVOS:[^\n]*systems-engineer/);
    assert.doesNotMatch(md, /Retorno de `hull-propulsion`/);
    assert.doesNotMatch(md, /Retorno de `cybernetics-shields`/);
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

  it('PASSO 2 instrui o Orquestrador a invocar as ferramentas MCP diretamente, sem delegar', () => {
    const dir = generate();
    const md = fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8');
    assert.match(md, /PASSO 2 - EXECUÇÃO DIRETA DAS FERRAMENTAS MCP/);
    assert.match(md, /Você mesmo \(a sessão principal\) DEVE invocar/);
    assert.match(md, /não delegue esta etapa a nenhum\s+sub-agente/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('PASSO 3 instrui a usar invoke_subagent com workspace inherit, após os valores já terem sido obtidos, apenas para narrativa', () => {
    const dir = generate();
    const md = fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8');
    assert.match(md, /PASSO 3 - NARRATIVA DOS ESPECIALISTAS/);
    assert.match(md, /invoke_subagent/);
    assert.match(md, /inherit/);
    assert.match(md, /valores já obtidos no Passo 2/);
    assert.match(md, /NÃO\s+devem invocar nenhuma ferramenta MCP por conta própria/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('não afirma mais que os sub-agentes DEVEM executar as ferramentas dos MCPs ativos', () => {
    const dir = generate();
    const md = fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8');
    assert.doesNotMatch(md, /Os sub-agentes DEVEM executar as ferramentas/);
    assert.doesNotMatch(md, /PASSO 2 - DELEGAÇÃO/);
    assert.doesNotMatch(md, /PASSO 3 - EXECUÇÃO DE TOOLS/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('instrui a gravar company_raw E company_canonical como dois campos separados, nunca um único "company"', () => {
    const dir = generate();
    const md = fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8');
    assert.match(md, /pilot\.company_raw/);
    assert.match(md, /pilot\.company_canonical/);
    assert.match(md, /NUNCA.*pilot\.company\b/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('instrui a chave exata "offense" em energy_sliders, nunca "attack"', () => {
    const dir = generate();
    const md = fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8');
    assert.match(md, /`offense`/);
    assert.match(md, /NUNCA.*`attack`/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('mapeia weapon_focus e visual_theme para os slugs exatos em inglês exigidos pelo schema', () => {
    const dir = generate();
    const md = fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8');
    assert.match(md, /weapon_focus/);
    assert.match(md, /"laser_piercing"/);
    assert.match(md, /"missile_barrage"/);
    assert.match(md, /"vulcan_spread"/);
    assert.match(md, /visual_theme/);
    assert.match(md, /"synthwave_80s"/);
    assert.match(md, /"dark_void_stealth"/);
    assert.match(md, /"cyberpunk_gold"/);
    // aesthetic_style só pode aparecer como nome explicitamente proibido (NUNCA aesthetic_style),
    // nunca como o nome real do campo a preencher.
    assert.match(md, /NUNCA `?aesthetic_style`?/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('proíbe explicitamente accent_color dentro de fast_grill_me_choices', () => {
    const dir = generate();
    const md = fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8');
    assert.match(md, /accent_color/);
    assert.match(md, /N[ÃA]O.*entra em `?(?:build_metadata\.)?fast_grill_me_choices`?/i);
    assert.match(md, /aceita\s+apenas `?weapon_focus`? e `?visual_theme`?/i);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('instrui que campos de MCPs não selecionados podem ser omitidos, sem violar a REGRA ZERO', () => {
    const dir = generate();
    const md = fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8');
    assert.match(md, /OMITA-os do arquivo final/);
    assert.match(md, /N[ÃA]O é uma\s+violação da REGRA ZERO/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('inclui bullet_speed e spread_angle no contrato de weapons-arsenal quando selecionado', () => {
    const dir = generate(); // generate() already selects weapons-arsenal
    const md = fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8');
    assert.match(md, /weapons\.primary\.bullet_speed/);
    assert.match(md, /weapons\.primary\.spread_angle/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('contrato de svg_path_data exige viewBox 0 0 128 128 (nunca 100 100) e restringe a comandos de path seguros', () => {
    const dir = generate();
    const md = fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8');
    assert.match(md, /viewBox `0 0 128 128`/);
    assert.doesNotMatch(md, /viewBox `?0 0 100 100`?/, 'nunca o viewBox 100x100 do rascunho antigo do plano');
    assert.match(md, /M\/L\/C\/Q\/Z/);
    assert.match(md, /Sem `<svg>`/);
    assert.match(md, /sem atributos/);
    assert.match(md, /sem `url\(\)`/);
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

  it('instrui o próprio sub-agente (não só a tabela do orquestrador) a restringir svg_path_data a M/L/C/Q/Z, sem <svg>, atributos ou url()', () => {
    const dir = generate();
    const md = fs.readFileSync(path.join(dir, '.agents', 'agents', 'aesthetic-designer.md'), 'utf8');

    // Pre-existing viewBox sentence must still be present and untouched by the new addition.
    assert.match(md, /viewBox 0 0 128 128/);

    // New safe-path-data constraint, added directly to the sub-agent's own instructions.
    assert.match(md, /M\/L\/C\/Q\/Z/);
    assert.match(md, /nunca a tag `<svg>` em si/);
    assert.match(md, /nenhum atributo/);
    assert.match(md, /nenhuma referência `url\(\)`/);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('WorkspaceGeneratorService — frontmatter dos sub-agentes', () => {
  it('não usa campos fictícios de frontmatter (kind, enable_mcp_tools, enable_write_tools)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'booth-ws-'));
    WorkspaceGeneratorService.generateWorkspace({
      sessionDir: dir,
      pilot: { callsign: 'TESTE', company_raw: 'Acme', company_canonical: 'Acme' },
      energy_sliders: { offense: 40, speed: 20, defense: 25, tech: 15 },
      selected_mcps: ['weapons-arsenal', 'hull-propulsion', 'cybernetics-shields'],
      selected_subagents: ['combat-strategist', 'systems-engineer'],
      mcpsDistDir: '/tmp/fake-mcps'
    });

    const agentFiles = ['aesthetic-designer.md', 'combat-strategist.md', 'systems-engineer.md'];
    for (const file of agentFiles) {
      const md = fs.readFileSync(path.join(dir, '.agents', 'agents', file), 'utf8');
      assert.doesNotMatch(md, /enable_mcp_tools/, `${file} não deve conter enable_mcp_tools`);
      assert.doesNotMatch(md, /enable_write_tools/, `${file} não deve conter enable_write_tools`);
      assert.doesNotMatch(md, /^kind:/m, `${file} não deve conter uma linha de frontmatter 'kind:'`);
      // name/description continuam sendo campos reais e obrigatórios.
      assert.match(md, /^name: /m);
      assert.match(md, /^description: /m);
    }

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('WorkspaceGeneratorService — sub-agentes táticos são narrativos, não invocam MCP tools', () => {
  function generateBoth(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'booth-ws-'));
    WorkspaceGeneratorService.generateWorkspace({
      sessionDir: dir,
      pilot: { callsign: 'TESTE', company_raw: 'Acme', company_canonical: 'Acme' },
      energy_sliders: { offense: 40, speed: 20, defense: 25, tech: 15 },
      selected_mcps: ['weapons-arsenal', 'hull-propulsion', 'cybernetics-shields'],
      selected_subagents: ['combat-strategist', 'systems-engineer'],
      mcpsDistDir: '/tmp/fake-mcps'
    });
    return dir;
  }

  it('combat-strategist.md não instrui mais a invocar ferramentas MCP por conta própria', () => {
    const dir = generateBoth();
    const md = fs.readFileSync(path.join(dir, '.agents', 'agents', 'combat-strategist.md'), 'utf8');
    assert.doesNotMatch(md, /Você DEVE invocar as ferramentas/);
    assert.match(md, /já invocou/);
    assert.match(md, /JÁ OBTIDOS/);
    assert.match(md, /NÃO deve invocar nenhuma\s+ferramenta MCP por conta própria/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('systems-engineer.md não instrui mais a invocar ferramentas MCP por conta própria', () => {
    const dir = generateBoth();
    const md = fs.readFileSync(path.join(dir, '.agents', 'agents', 'systems-engineer.md'), 'utf8');
    assert.doesNotMatch(md, /Você DEVE invocar as ferramentas/);
    assert.match(md, /já invocou/);
    assert.match(md, /JÁ OBTIDOS/);
    assert.match(md, /NÃO deve invocar nenhuma\s+ferramenta MCP por conta própria/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
