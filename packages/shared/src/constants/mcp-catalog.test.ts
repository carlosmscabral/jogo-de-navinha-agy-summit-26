import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MCP_CATALOG,
  SUBAGENT_CATALOG,
  PRIMARY_WEAPON_LABELS,
  SECONDARY_WEAPON_LABELS,
  STAT_LABELS,
  lookupMcpServer,
  lookupMcpTool,
  statLabel
} from './mcp-catalog.js';
import { buildShipSpecSchema } from '../schema/gen-schema.js';

/**
 * O teste roda a partir de `dist/`, por isso sobe dois níveis extras até a raiz do
 * workspace antes de procurar `packages/mcps`.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../../../..');
const MCP_SRC = path.join(REPO_ROOT, 'packages/mcps/src');

/**
 * Lê os nomes de ferramenta realmente registrados em cada `server.tool('nome', …)`.
 * É a fonte de verdade que o catálogo precisa espelhar: se alguém renomear uma
 * ferramenta no MCP e esquecer do catálogo, a UI volta a mostrar slug cru.
 */
function registeredTools(file: string): string[] {
  const source = fs.readFileSync(path.join(MCP_SRC, file), 'utf8');
  return [...source.matchAll(/server\.tool\(\s*'([^']+)'/g)].map((m) => m[1]);
}

const SERVER_FILES: Record<string, string> = {
  'weapons-arsenal': 'weapons-arsenal.ts',
  'hull-propulsion': 'hull-propulsion.ts',
  'cybernetics-shields': 'cybernetics-shields.ts'
};

describe('MCP_CATALOG', () => {
  it('cobre exatamente os três servidores, com os mesmos nomes dos arquivos de MCP', () => {
    assert.deepEqual(Object.keys(MCP_CATALOG).sort(), Object.keys(SERVER_FILES).sort());
  });

  it('lista, por servidor, exatamente as ferramentas que o MCP registra', () => {
    for (const [server, file] of Object.entries(SERVER_FILES)) {
      const actual = registeredTools(file).sort();
      const catalogued = MCP_CATALOG[server as keyof typeof MCP_CATALOG].tools
        .map((t) => t.id)
        .sort();
      assert.deepEqual(
        catalogued,
        actual,
        `${server}: catálogo e packages/mcps/src/${file} divergem`
      );
    }
  });

  it('é a única fonte da descrição: nenhum MCP declara a sua própria', () => {
    // Os `server.tool(...)` passam `toolBlurb(server, id)`, que lê deste catálogo.
    // Se alguém reintroduzir um literal, a duplicação volta e as cópias derivam de novo
    // — foi exatamente assim que builder e MCP passaram a dizer coisas diferentes.
    for (const [server, file] of Object.entries(SERVER_FILES)) {
      const source = fs.readFileSync(path.join(MCP_SRC, file), 'utf8');
      for (const tool of MCP_CATALOG[server as keyof typeof MCP_CATALOG].tools) {
        assert.ok(
          source.includes(`toolBlurb('${server}', '${tool.id}')`),
          `${file}: ${tool.id} não usa toolBlurb() — descrição duplicada fora do catálogo`
        );
        assert.ok(
          !source.includes(`'${tool.blurb}'`),
          `${file}: ${tool.id} ainda tem a descrição como literal`
        );
      }
    }
  });

  it('não deixa nenhum campo de texto vazio', () => {
    for (const [server, entry] of Object.entries(MCP_CATALOG)) {
      for (const field of ['label', 'blurb', 'whenSelected', 'whenUnselected'] as const) {
        assert.ok(entry[field].trim().length > 0, `${server}.${field} vazio`);
      }
      assert.match(entry.color, /^#[0-9a-f]{6}$/i, `${server}.color não é hex`);
    }
  });

  it('resolve servidor por chave exata e devolve undefined para desconhecido', () => {
    assert.equal(lookupMcpServer('weapons-arsenal')?.label, 'Arsenal de Armas');
    // A implementação antiga usava includes() com catch-all e chamaria isto de
    // "cybernetics-shields". Slug desconhecido tem que sair como desconhecido.
    assert.equal(lookupMcpServer('weapons'), undefined);
    assert.equal(lookupMcpServer('servidor-que-nao-existe'), undefined);
  });

  it('resolve ferramenta em qualquer servidor', () => {
    assert.equal(lookupMcpTool('tune_thrusters')?.label, 'Propulsores');
    assert.equal(lookupMcpTool('nao_existe'), undefined);
  });
});

describe('SUBAGENT_CATALOG', () => {
  it('inclui os três sub-agentes, com o aesthetic-designer marcado como não-selecionável', () => {
    assert.deepEqual(
      Object.keys(SUBAGENT_CATALOG).sort(),
      ['aesthetic-designer', 'combat-strategist', 'systems-engineer']
    );
    // Ele é sempre gerado no workspace e sempre enviado no payload — o visitante não
    // escolhe, mas a tela precisa poder mostrá-lo.
    assert.equal(SUBAGENT_CATALOG['aesthetic-designer'].selectable, false);
    assert.equal(SUBAGENT_CATALOG['combat-strategist'].selectable, true);
    assert.equal(SUBAGENT_CATALOG['systems-engineer'].selectable, true);
  });
});

describe('rótulos de armas', () => {
  it('cobre todo valor de enum que o schema aceita', () => {
    const schema: any = buildShipSpecSchema();
    const primary: string[] = schema.properties.weapons.properties.primary.properties.type.enum;
    const secondary: string[] = schema.properties.weapons.properties.secondary.properties.type.enum;

    for (const t of primary) {
      assert.ok(
        t in PRIMARY_WEAPON_LABELS,
        `tipo primário ${t} sem rótulo — vazaria cru para o jogador`
      );
    }
    for (const t of secondary) {
      assert.ok(t in SECONDARY_WEAPON_LABELS, `tipo secundário ${t} sem rótulo`);
    }
  });

  it('não deixa nenhum rótulo igual ao slug', () => {
    for (const [slug, label] of Object.entries({
      ...PRIMARY_WEAPON_LABELS,
      ...SECONDARY_WEAPON_LABELS
    })) {
      assert.notEqual(label, slug, `${slug} não foi traduzido`);
    }
  });
});

describe('STAT_LABELS', () => {
  it('cobre os quatro atributos de ShipAttributes', () => {
    for (const field of ['max_hp', 'shield_capacity', 'speed_px_s', 'hitbox_radius']) {
      assert.ok(field in STAT_LABELS, `${field} sem rótulo`);
    }
  });

  it('devolve o slug cru quando não conhece o campo, em vez de string vazia', () => {
    assert.equal(statLabel('max_hp'), 'Casco');
    assert.equal(statLabel('campo_novo'), 'campo_novo');
  });
});
