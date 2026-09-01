import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ACCENT_COLOR_ORDER,
  ACCENT_COLORS,
  BOOTH_KICKOFF_PROMPT,
  FALLBACK_PRESETS,
  GRILL_ME_SECONDARY_ORDER,
  PRIMARY_WEAPON_LABELS,
  PRIMARY_WEAPON_ORDER,
  SECONDARY_WEAPON_LABELS,
  VISUAL_THEME_ORDER,
  VISUAL_THEMES,
  type SubagentName
} from '@jogo/shared';
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

/**
 * Numa sessão real de 2026-08-30 o `ship_spec.json` saiu com
 * `"selected_subagents": ["aesthetic-designer", "aesthetic-designer", "systems-engineer"]`.
 *
 * O agente não errou: `EnergySlidersBuilder.tsx:229` já envia `['aesthetic-designer', tático]`, o
 * gerador prefixava `'aesthetic-designer'` outra vez, e a tabela de contrato manda gravar a lista
 * "Exatamente". Nenhum teste pegou porque as fixtures daqui mandavam só o tático, uma forma que o
 * builder nunca produz.
 *
 * O dano é nos dados persistidos (Firestore, leaderboard contam o designer duas vezes), não na
 * tela: `PilotBriefingPanel.tsx:40` procura o primeiro sub-agente `selectable` e o designer é
 * `selectable: false`.
 */
describe('WorkspaceGeneratorService — selected_subagents', () => {
  const contractRow = (selected: SubagentName[]): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'booth-ws-'));
    WorkspaceGeneratorService.generateWorkspace({
      sessionDir: dir,
      pilot: { callsign: 'TESTE', company_raw: 'Acme', company_canonical: 'Acme' },
      energy_sliders: { offense: 40, speed: 20, defense: 25, tech: 15 },
      selected_mcps: ['weapons-arsenal'],
      selected_subagents: selected,
      mcpsDistDir: '/tmp/fake-mcps'
    });
    const md = fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8');
    fs.rmSync(dir, { recursive: true, force: true });
    const row = md.split('\n').find((l) => l.includes('`build_metadata.selected_subagents`'));
    assert.ok(row, 'nenhuma linha de contrato para selected_subagents');
    return row;
  };

  it('não manda gravar o mesmo sub-agente duas vezes', () => {
    // A forma que o builder de verdade envia: o designer já vem na lista.
    const row = contractRow(['aesthetic-designer', 'systems-engineer']);
    const listed = [...row.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
    assert.deepEqual(listed, [...new Set(listed)], `sub-agente repetido no contrato: ${listed.join(', ')}`);
    assert.deepEqual(listed, ['aesthetic-designer', 'systems-engineer']);
  });

  it('continua garantindo o aesthetic-designer quando o chamador o omite', () => {
    // O default do daemon (`index.ts:335`) e as fixtures antigas mandam só o tático; o designer é
    // sempre ativo, então a lista precisa ganhá-lo — uma vez.
    const row = contractRow(['combat-strategist']);
    const listed = [...row.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
    assert.deepEqual(listed, ['aesthetic-designer', 'combat-strategist']);
  });
});

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

  // Contraparte do aviso condicional dentro das personas: elas só conseguem decidir se a dica do
  // EMP cabe se o Orquestrador entregar o tipo escolhido. Como `primary_weapon`/`secondary_weapon`
  // vêm da resposta do piloto no PASSO 1, e não de ferramenta, o repasse independe dos MCPs
  // selecionados — `generate()` aqui monta a sessão com apenas um MCP, de propósito.
  it('manda o Orquestrador repassar os tipos de arma aos sub-agentes táticos', () => {
    const dir = generate();
    const md = fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8');
    const passo3 = md.slice(md.indexOf('PASSO 3'), md.indexOf('PASSO 4'));
    assert.match(passo3, /`primary_weapon` e `secondary_weapon`/);
    assert.match(passo3, /weapons-arsenal/);
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

  // O PASSO 1 embute o argumento literal da chamada de `ask_question`. Como o bloco é o único
  // cercado por ```json no prompt inteiro, o teste consegue parseá-lo de verdade em vez de casar
  // regex — e um JSON que não parseia aqui é uma chamada que morre no estande.
  function grillMePayload(md: string): {
    questions: { question: string; options: string[]; is_multi_select: boolean }[];
  } {
    const fence = md.match(/```json\n([\s\S]*?)\n```/);
    assert.ok(fence, 'bloco JSON do ask_question ausente do PASSO 1');
    return JSON.parse(fence[1]);
  }

  // Até 2026-08-31 o agente escrevia as quatro perguntas como texto e o piloto digitava o número.
  // Agora quem desenha é o CLI: `ask_question` numera as opções, mostra o cursor `>` que anda com
  // as setas e caminha `Question 1/4` a `4/4` sozinho. Uma chamada só, com as quatro perguntas no
  // array, troca quatro idas e voltas ao modelo por uma — é o maior ganho de SLA disponível aqui.
  it('Fast-Grill-Me (PASSO 1) faz as quatro perguntas numa única chamada de ask_question', () => {
    const dir = generate();
    const md = fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8');

    assert.match(md, /\*\*uma única chamada\*\* da\s+ferramenta `ask_question`/);
    assert.match(md, /\*\*ÚNICA\*\* do turno/);
    assert.match(md, /\*\*pare de gerar\s+imediatamente\*\*/);

    const { questions } = grillMePayload(md);
    assert.equal(questions.length, 4, 'a chamada tem que levar as quatro perguntas de uma vez');
    for (const q of questions) {
      assert.equal(q.is_multi_select, false, `'${q.question}' deixou de ser seleção única`);
      assert.ok(q.options.length >= 2, `'${q.question}' com menos de duas opções`);
      // O CLI numera sozinho: uma opção pré-numerada aqui renderiza como "1. 1) Laser".
      for (const opt of q.options) {
        assert.doesNotMatch(opt, /^\s*\d+[).\-]/, `opção pré-numerada: '${opt}'`);
      }
      // A ferramenta acrescenta o write-in por conta própria; declará-lo duplicaria a opção.
      assert.ok(
        !q.options.some((o) => /write-in|outra|nenhuma/i.test(o)),
        `'${q.question}' declara uma opção que o CLI já acrescenta`
      );
    }

    // O formato antigo não pode sobreviver em lugar nenhum do prompt: as instruções seriam
    // contraditórias, e um agente que encontrasse as duas escolheria a errada metade das vezes.
    assert.doesNotMatch(md, /PERGUNTA \d\/4/);
    assert.doesNotMatch(md, /de uma vez só, em UM único/);
    assert.doesNotMatch(md, /\[1\] Canhão primário:/);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  // Cada opção precisa dizer o que ela faz no jogo — é o pedido inteiro desta mudança. As frases
  // saem dos catálogos, então o teste cobra a presença de uma descrição por opção, não o texto.
  // A cor fica de fora de propósito: o rótulo já é a descrição.
  it('descreve cada arma e cada formato de casco na própria opção do seletor', () => {
    const dir = generate();
    const md = fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8');
    const [primaria, secundaria, casco, cor] = grillMePayload(md).questions;

    const described = (q: { options: string[] }, label: string) =>
      q.options.some((o) => new RegExp(`^${label} — \\S`).test(o));

    for (const label of Object.values(PRIMARY_WEAPON_LABELS)) {
      assert.ok(described(primaria, label), `primária '${label}' sem descrição`);
    }
    for (const key of GRILL_ME_SECONDARY_ORDER) {
      assert.ok(
        described(secundaria, SECONDARY_WEAPON_LABELS[key]),
        `secundária '${key}' sem descrição`
      );
    }
    for (const key of VISUAL_THEME_ORDER) {
      assert.ok(described(casco, VISUAL_THEMES[key].label), `tema '${key}' sem descrição`);
    }
    for (const opt of cor.options) {
      assert.doesNotMatch(opt, / — /, `a cor '${opt}' ganhou descrição e custa SLA à toa`);
    }

    fs.rmSync(dir, { recursive: true, force: true });
  });

  // O menu é gerado dos catálogos justamente para não poder anunciar uma opção que o schema
  // rejeita — nem esconder uma que ele aceita, como acontecia com emp_burst.
  it('Fast-Grill-Me expõe todas as armas e todas as cores curadas', () => {
    const dir = generate();
    const md = fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8');
    for (const label of Object.values(PRIMARY_WEAPON_LABELS)) {
      assert.match(md, new RegExp(label), `primária '${label}' ausente do menu`);
    }
    for (const key of GRILL_ME_SECONDARY_ORDER) {
      assert.match(md, new RegExp(SECONDARY_WEAPON_LABELS[key]), `secundária '${key}' ausente`);
    }
    for (const key of VISUAL_THEME_ORDER) {
      assert.match(md, new RegExp(VISUAL_THEMES[key].label), `tema '${key}' ausente`);
    }
    for (const key of ACCENT_COLOR_ORDER) {
      assert.match(md, new RegExp(ACCENT_COLORS[key].label), `cor '${key}' ausente`);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // "Sem armamento secundário" continua no enum do schema, mas oferecê-lo numa partida de 90
  // segundos é uma armadilha para quem escolhe sem saber.
  it('não oferece "sem secundária" no menu, e avisa que o EMP não fere o boss', () => {
    const dir = generate();
    const md = fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8');
    assert.doesNotMatch(md, new RegExp(SECONDARY_WEAPON_LABELS.none));
    assert.match(md, /NÃO fere o boss/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('diz ao agente que a sessão abre com a frase do estande e que ele deve ir direto ao PASSO 1', () => {
    const dir = generate();
    const md = fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8');
    assert.ok(md.includes(BOOTH_KICKOFF_PROMPT), 'a frase de abertura do estande não aparece');
    assert.match(md, /sem saudação/);
    assert.match(md, /sem chamar nenhuma ferramenta\s+MCP antes delas/);
    assert.match(md, /é o seletor da\s+`Question 1\/4`, sozinho/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('AGENTS.md e GEMINI.md continuam byte-idênticos', () => {
    const dir = generate();
    assert.equal(
      fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8'),
      fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8')
    );
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
    assert.match(md, /PASSO 3 - BRIEFING DOS ESPECIALISTAS/);
    assert.match(md, /invoke_subagent/);
    assert.match(md, /inherit/);
    assert.match(md, /valores já obtidos no Passo 2/);
    assert.match(md, /NÃO devem invocar\s+nenhuma ferramenta MCP por conta própria/);
    assert.match(md, /lista de dicas de pilotagem/);
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

  it('dá a tabela nº → slug exato para as quatro escolhas', () => {
    const dir = generate();
    const md = fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8');
    for (const key of [
      ...PRIMARY_WEAPON_ORDER,
      ...GRILL_ME_SECONDARY_ORDER,
      ...VISUAL_THEME_ORDER,
      ...ACCENT_COLOR_ORDER
    ]) {
      assert.match(md, new RegExp(`"${key}"`), `slug "${key}" ausente da tabela de conversão`);
    }
    assert.match(md, /`primary_weapon`/);
    assert.match(md, /`secondary_weapon`/);
    assert.match(md, /`visual_theme`/);
    assert.match(md, /`accent_color`/);
    // aesthetic_style só pode aparecer como nome explicitamente proibido (NUNCA aesthetic_style),
    // nunca como o nome real do campo a preencher.
    assert.match(md, /NUNCA `?aesthetic_style`?/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // A instrução antiga PROIBIA accent_color em fast_grill_me_choices. Agora ele é obrigatório, e
  // quem virou campo morto é weapon_focus — que o Ajv rejeita por additionalProperties: false.
  it('exige as quatro chaves em fast_grill_me_choices e trata weapon_focus como campo morto', () => {
    const dir = generate();
    const md = fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8');
    assert.match(md, /As quatro chaves são \*\*obrigatórias\*\*/);
    assert.match(md, /`weapon_focus` \*\*não existe mais\*\*/);
    assert.doesNotMatch(md, /N[ÃA]O.*entra em `?(?:build_metadata\.)?fast_grill_me_choices`?/i);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('amarra weapons.*.type à escolha do PASSO 1, em vez de deixá-lo livre para o modelo', () => {
    const dir = generate();
    const md = fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8');
    assert.match(md, /`weapons\.primary\.type` \| O canhão escolhido no PASSO 1/);
    assert.match(md, /`weapons\.secondary\.type` \| A secundária escolhida no PASSO 1/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('manda gravar pilot_tips na mesma escrita, e omitir o campo em vez de inventar dica', () => {
    const dir = generate();
    const md = fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8');
    assert.match(md, /`build_metadata\.pilot_tips`/);
    assert.match(md, /mesma escrita/);
    assert.match(md, /máx\. 3 itens, até 140 caracteres cada/);
    assert.match(md, /\*\*omita o campo\*\* em vez de inventar uma/);
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
  // Antes de 2026-08-30 este arquivo só NOMEAVA os temas e as cores; a paleta era inventada a cada
  // sessão e a cor era "refinação opcional". Agora os hexes vêm do catálogo e o destaque é
  // obrigatório — a estrutura continua governada pelo tema.
  it('entrega a paleta de cada tema e a cor de destaque em hex, e não como prosa opcional', () => {
    const dir = generate();
    const md = fs.readFileSync(path.join(dir, '.agents', 'agents', 'aesthetic-designer.md'), 'utf8');

    for (const key of VISUAL_THEME_ORDER) {
      const theme = VISUAL_THEMES[key];
      assert.match(md, new RegExp(theme.label), `tema '${key}' ausente`);
      for (const hex of Object.values(theme.palette)) {
        assert.ok(md.includes(hex), `hex ${hex} do tema '${key}' ausente`);
      }
    }
    for (const key of ACCENT_COLOR_ORDER) {
      assert.match(md, new RegExp(ACCENT_COLORS[key].label), `cor '${key}' ausente`);
      assert.ok(md.includes(ACCENT_COLORS[key].hex), `hex de '${key}' ausente`);
    }

    assert.match(md, /governa a GEOMETRIA/);
    assert.match(md, /deve\*\* aparecer em\s+`primary_color` \*\*ou\*\* em `engine_trail_color`/);
    assert.doesNotMatch(md, /refinação\s+opcional/i);

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

describe('WorkspaceGeneratorService — sub-agentes táticos produzem dicas, não invocam MCP tools', () => {
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

  // O texto antigo pedia "uma avaliação tática breve para exibição no terminal" — prosa que morria
  // ali, nunca chegava no ship_spec.json e o visitante nunca lia. É o issue #2 do repositório.
  for (const agent of ['combat-strategist', 'systems-engineer']) {
    it(`${agent}.md pede duas dicas de pilotagem, sem invocar ferramentas MCP`, () => {
      const dir = generateBoth();
      const md = fs.readFileSync(path.join(dir, '.agents', 'agents', `${agent}.md`), 'utf8');

      assert.doesNotMatch(md, /Você DEVE invocar as ferramentas/);
      assert.match(md, /já invocou/);
      assert.match(md, /NÃO deve\s+invocar nenhuma\s+ferramenta MCP por conta\s+própria/);

      assert.match(md, /\*\*exatamente 2 dicas de pilotagem\*\*/);
      assert.match(md, /no máximo 140 caracteres/);
      assert.match(md, /`build_metadata\.pilot_tips`/);
      assert.match(md, /uma por linha, sem numeração/);

      // O destino mudou: nada mais é escrito "para exibição no terminal".
      assert.doesNotMatch(md, /para\s+exibição no terminal/);

      fs.rmSync(dir, { recursive: true, force: true });
    });
  }

  // Gate M6, achado do bloco 22.3: o aviso vivia só no `combat-strategist`, então quem escolhia
  // EMP e `systems-engineer` — 1 visitante em 4 — decolava sem saber que a secundária não fere o
  // boss. A persona é escrita antes do Fast-Grill-Me, então o gerador não pode condicionar o texto
  // à escolha; a regra é condicional dentro da persona e o Orquestrador entrega o tipo escolhido.
  for (const agent of ['combat-strategist', 'systems-engineer']) {
    it(`${agent}.md avisa que o emp_burst não fere o boss`, () => {
      const dir = generateBoth();
      const md = fs.readFileSync(path.join(dir, '.agents', 'agents', `${agent}.md`), 'utf8');

      assert.match(md, /`emp_burst`/);
      assert.match(md, /\*\*não\*\*\s+fere\s+o\s+boss/);
      assert.match(md, /`secondary_weapon`/);

      fs.rmSync(dir, { recursive: true, force: true });
    });
  }

  it('aesthetic-designer.md não produz dica de pilotagem', () => {
    const dir = generateBoth();
    const md = fs.readFileSync(path.join(dir, '.agents', 'agents', 'aesthetic-designer.md'), 'utf8');
    assert.doesNotMatch(md, /pilot_tips/);
    assert.doesNotMatch(md, /dicas de pilotagem/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Numa sessão real de 2026-08-30 o agente gravou `"style_name": "synthwave_80s"` — o slug interno
   * do tema no lugar do nome da nave. O campo é o único texto livre agente→jogador que sobrevive ao
   * pipeline (aparece como "Classe" no pré-voo), e nem a persona nem a tabela de contrato diziam o
   * que ele deveria conter: a instrução inteira era "texto curto".
   */
  it('o aesthetic-designer sabe que assina o nome da nave, e que não é o slug', () => {
    const dir = generateBoth();
    const persona = fs.readFileSync(path.join(dir, '.agents', 'agents', 'aesthetic-designer.md'), 'utf8');

    assert.match(persona, /style_name/);
    assert.match(persona, /Maiúsculas De Título/);
    assert.match(persona, /40 caracteres/);
    // O exemplo vem dos presets de emergência, que são nomes já validados contra o maxLength do
    // schema — nada de exemplo inventado no prompt.
    assert.ok(persona.includes(FALLBACK_PRESETS.interceptor.visuals.style_name));
    // Numa sessão real de 2026-08-30 o agente devolveu `Cyberpunk Gold Dreadnought` — o preset cujo
    // nome começa pelo rótulo do tema que o piloto escolheu. Há um exemplo por tema, então o modelo
    // casa o tema com o exemplo e copia em vez de batizar. A persona precisa proibir a cópia
    // explicitamente e exigir que o nome fale da build, senão todo visitante de um mesmo tema sai do
    // estande com a mesma nave.
    assert.match(persona, /NÃO copie nenhum deles/);
    assert.match(persona, /build/);
    // A proibição precisa nomear os slugs de verdade, senão ela não cobre um tema novo.
    for (const theme of VISUAL_THEME_ORDER) {
      assert.ok(persona.includes(`\`${theme}\``), `persona não proíbe o slug ${theme} em style_name`);
    }

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a tabela de contrato descreve style_name em vez de dizer só "texto curto"', () => {
    const dir = generateBoth();
    const md = fs.readFileSync(path.join(dir, 'GEMINI.md'), 'utf8');
    const row = md.split('\n').find((l) => l.includes('`visuals.style_name`'));
    assert.ok(row, 'nenhuma linha de contrato para visuals.style_name');
    assert.doesNotMatch(row, /\|\s*texto curto\s*\|/);
    assert.match(row, /NUNCA o slug do tema/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
