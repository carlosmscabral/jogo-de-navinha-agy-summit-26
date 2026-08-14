import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FALLBACK_PRESETS, computeBaselineAttributes, computeBaselineWeapons, applySynergies, BALANCE } from '@jogo/shared';
import { FileWatcherService } from './file-watcher.js';

function tempSession(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'booth-test-'));
}

function auditLine(server: string, tool: string): string {
  return JSON.stringify({ timestamp: new Date().toISOString(), server, tool, args: {}, result: {} }) + '\n';
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('FileWatcherService — validação estrita e gate de auditoria', () => {
  let dir: string;
  let watcher: FileWatcherService;

  before(() => {
    dir = tempSession();
    fs.writeFileSync(path.join(dir, 'mcp_audit.log'), '', 'utf8');
  });

  after(() => {
    watcher?.stopWatching();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejeita spec que não passa no schema e não emite EVENT_SHIP_READY', async () => {
    const rejections: any[] = [];
    let ready = 0;
    watcher = new FileWatcherService();
    watcher.startWatching(dir, {
      requiredMcps: [],
      onShipReady: () => { ready += 1; },
      onSpecRejected: (r) => rejections.push(r)
    });

    fs.writeFileSync(path.join(dir, 'ship_spec.json'), JSON.stringify({ pilot: { callsign: 'X' } }), 'utf8');
    await wait(900);

    assert.equal(ready, 0);
    assert.equal(rejections.length, 1);
    assert.equal(rejections[0].reason, 'SCHEMA_INVALID');
    watcher.stopWatching();
  });

  it('segura uma spec válida até que todo MCP selecionado tenha registro de auditoria', async () => {
    const dir2 = tempSession();
    const auditPath = path.join(dir2, 'mcp_audit.log');
    fs.writeFileSync(auditPath, '', 'utf8');

    const rejections: any[] = [];
    const readySpecs: any[] = [];
    const w = new FileWatcherService();
    w.startWatching(dir2, {
      requiredMcps: ['weapons-arsenal', 'hull-propulsion'],
      onShipReady: (s) => readySpecs.push(s),
      onSpecRejected: (r) => rejections.push(r)
    });

    fs.appendFileSync(auditPath, auditLine('weapons-arsenal', 'configure_primary_cannon'));
    fs.writeFileSync(path.join(dir2, 'ship_spec.json'), JSON.stringify(FALLBACK_PRESETS.interceptor), 'utf8');
    await wait(900);
    assert.equal(readySpecs.length, 0, 'não pode decolar com auditoria incompleta');

    fs.appendFileSync(auditPath, auditLine('hull-propulsion', 'tune_engine_output'));
    await wait(900);
    assert.equal(readySpecs.length, 1, 'decola assim que a auditoria fecha');
    assert.equal(rejections.length, 0);

    w.stopWatching();
    fs.rmSync(dir2, { recursive: true, force: true });
  });

  it('aceita uma spec que traz "$schema" no topo em vez de rejeitá-la por additionalProperties', async () => {
    const dir3 = tempSession();
    fs.writeFileSync(path.join(dir3, 'mcp_audit.log'), '', 'utf8');

    const rejections: any[] = [];
    const readySpecs: any[] = [];
    const w = new FileWatcherService();
    w.startWatching(dir3, {
      requiredMcps: [],
      onShipReady: (s) => readySpecs.push(s),
      onSpecRejected: (r) => rejections.push(r)
    });

    // Convenção comum de agentes de IA ao escrever JSON "à mão": incluir $schema
    // no topo. O schema estrito não declara essa chave — normalizeSpec precisa
    // descartá-la incondicionalmente, e não apenas evitar adicioná-la de novo.
    const specWithSchema = {
      $schema: 'https://json-schema.org/draft-07/schema#',
      ...FALLBACK_PRESETS.interceptor
    };
    fs.writeFileSync(path.join(dir3, 'ship_spec.json'), JSON.stringify(specWithSchema), 'utf8');
    await wait(900);

    assert.equal(rejections.length, 0, 'não deve rejeitar por additionalProperties por causa de $schema');
    assert.equal(readySpecs.length, 1, 'deve liberar a spec normalmente');
    assert.equal((readySpecs[0] as any).$schema, undefined, 'a spec liberada não deve carregar $schema');

    w.stopWatching();
    fs.rmSync(dir3, { recursive: true, force: true });
  });

  it('dispara onAuditGateSatisfied exatamente uma vez, quando o último MCP obrigatório é registrado', async () => {
    const dir4 = tempSession();
    const auditPath = path.join(dir4, 'mcp_audit.log');
    fs.writeFileSync(auditPath, '', 'utf8');

    let satisfiedCount = 0;
    const w = new FileWatcherService();
    w.startWatching(dir4, {
      requiredMcps: ['weapons-arsenal', 'hull-propulsion'],
      onShipReady: () => {},
      onAuditGateSatisfied: () => { satisfiedCount += 1; }
    });

    fs.appendFileSync(auditPath, auditLine('weapons-arsenal', 'configure_primary_cannon'));
    await wait(900);
    assert.equal(satisfiedCount, 0, 'gate não deve disparar com apenas 1 dos 2 MCPs obrigatórios');

    fs.appendFileSync(auditPath, auditLine('hull-propulsion', 'tune_thrusters'));
    await wait(900);
    assert.equal(satisfiedCount, 1, 'gate deve disparar exatamente uma vez quando o último MCP é registrado');

    // Uma terceira chamada MCP não deve disparar de novo
    fs.appendFileSync(auditPath, auditLine('weapons-arsenal', 'attach_secondary_ordnance'));
    await wait(900);
    assert.equal(satisfiedCount, 1, 'gate não deve disparar de novo após já satisfeito');

    w.stopWatching();
    fs.rmSync(dir4, { recursive: true, force: true });
  });

  it('forceCheckNow() libera uma spec válida e já auditada antes mesmo do poll de 400ms ou do chokidar rodarem', () => {
    const dir5 = tempSession();
    const auditPath = path.join(dir5, 'mcp_audit.log');
    fs.writeFileSync(auditPath, '', 'utf8');

    const readySpecs: any[] = [];
    const w = new FileWatcherService();
    w.startWatching(dir5, {
      requiredMcps: ['weapons-arsenal'],
      onShipReady: (s) => readySpecs.push(s)
    });

    // Escreve a auditoria e a spec, e chama forceCheckNow() imediatamente —
    // na mesma volta síncrona, sem nenhum await/setTimeout entre a escrita e
    // a checagem. Como Node.js é single-threaded e tanto o pollIntervalTimer
    // (400ms) quanto o chokidar (que depende de I/O assíncrono e de um
    // awaitWriteFinish com pollInterval de 50ms) só entregam eventos em ciclos
    // futuros do event loop, nenhum dos dois pode ter processado estes
    // arquivos dentro desta mesma função síncrona. A única forma de
    // readySpecs já conter o resultado na asserção abaixo é o efeito
    // síncrono do próprio forceCheckNow() — não uma coincidência de timing
    // com o poller de fundo.
    fs.appendFileSync(auditPath, auditLine('weapons-arsenal', 'configure_primary_cannon'));
    fs.writeFileSync(path.join(dir5, 'ship_spec.json'), JSON.stringify(FALLBACK_PRESETS.interceptor), 'utf8');
    w.forceCheckNow();

    assert.equal(readySpecs.length, 1, 'forceCheckNow deve liberar a spec sincronamente, sem esperar o poll/chokidar');
    assert.equal(readySpecs[0].pilot.callsign, FALLBACK_PRESETS.interceptor.pilot.callsign);

    w.stopWatching();
    fs.rmSync(dir5, { recursive: true, force: true });
  });

  it('forceCheckNow() é um no-op seguro antes de startWatching() e depois de stopWatching()', () => {
    const w = new FileWatcherService();
    assert.doesNotThrow(() => w.forceCheckNow());

    const dir6 = tempSession();
    fs.writeFileSync(path.join(dir6, 'mcp_audit.log'), '', 'utf8');
    w.startWatching(dir6, { requiredMcps: [], onShipReady: () => {} });
    w.stopWatching();

    assert.doesNotThrow(() => w.forceCheckNow());

    fs.rmSync(dir6, { recursive: true, force: true });
  });
});

describe('FileWatcherService — backfill de baseline para MCPs não selecionados', () => {
  it('preenche attributes com a fórmula-base quando hull-propulsion e cybernetics-shields não são selecionados', async () => {
    const dir = tempSession();
    const auditPath = path.join(dir, 'mcp_audit.log');
    fs.writeFileSync(auditPath, '', 'utf8');

    const readySpecs: any[] = [];
    const rejections: any[] = [];
    const w = new FileWatcherService();
    w.startWatching(dir, {
      requiredMcps: ['weapons-arsenal'],
      onShipReady: (s) => readySpecs.push(s),
      onSpecRejected: (r) => rejections.push(r)
    });

    const sliders = { offense: 42, speed: 18, defense: 27, tech: 33 };
    const rawSpec = {
      pilot: FALLBACK_PRESETS.interceptor.pilot,
      build_metadata: {
        selected_mcps: ['weapons-arsenal'],
        selected_subagents: ['aesthetic-designer', 'combat-strategist'],
        energy_sliders: sliders,
        fast_grill_me_choices: { weapon_focus: 'laser_piercing', visual_theme: 'synthwave_80s' },
        synergies_unlocked: []
      },
      // attributes ausente de propósito -- simula o que agy escreve quando
      // hull-propulsion/cybernetics-shields nunca foram chamados
      weapons: FALLBACK_PRESETS.interceptor.weapons,
      visuals: FALLBACK_PRESETS.interceptor.visuals
    };

    fs.appendFileSync(auditPath, auditLine('weapons-arsenal', 'configure_primary_cannon'));
    fs.writeFileSync(path.join(dir, 'ship_spec.json'), JSON.stringify(rawSpec), 'utf8');
    await wait(900);

    assert.equal(rejections.length, 0, JSON.stringify(rejections));
    assert.equal(readySpecs.length, 1);
    const expected = computeBaselineAttributes(sliders);
    assert.deepEqual(readySpecs[0].attributes, expected);

    w.stopWatching();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('preenche weapons com a fórmula-base quando weapons-arsenal não é selecionado', async () => {
    const dir = tempSession();
    const auditPath = path.join(dir, 'mcp_audit.log');
    fs.writeFileSync(auditPath, '', 'utf8');

    const readySpecs: any[] = [];
    const rejections: any[] = [];
    const w = new FileWatcherService();
    w.startWatching(dir, {
      requiredMcps: ['hull-propulsion'],
      onShipReady: (s) => readySpecs.push(s),
      onSpecRejected: (r) => rejections.push(r)
    });

    const sliders = { offense: 22, speed: 40, defense: 12, tech: 46 };
    const rawSpec = {
      pilot: FALLBACK_PRESETS.interceptor.pilot,
      build_metadata: {
        selected_mcps: ['hull-propulsion'],
        selected_subagents: ['aesthetic-designer', 'systems-engineer'],
        energy_sliders: sliders,
        fast_grill_me_choices: { weapon_focus: 'vulcan_spread', visual_theme: 'dark_void_stealth' },
        synergies_unlocked: []
      },
      attributes: {
        max_hp: 4,
        speed_px_s: 340,
        hitbox_radius: 10,
        shield_capacity: 2
      },
      // weapons ausente de propósito -- simula uma sessão onde weapons-arsenal
      // nunca foi chamado
      visuals: FALLBACK_PRESETS.interceptor.visuals
    };

    fs.appendFileSync(auditPath, auditLine('hull-propulsion', 'tune_thrusters'));
    fs.writeFileSync(path.join(dir, 'ship_spec.json'), JSON.stringify(rawSpec), 'utf8');
    await wait(900);

    assert.equal(rejections.length, 0, JSON.stringify(rejections));
    assert.equal(readySpecs.length, 1);
    const expectedWeapons = computeBaselineWeapons(sliders, 'vulcan_spread');
    assert.deepEqual(readySpecs[0].weapons, expectedWeapons);
    // attributes de hull-propulsion (MCP selecionado) passam intactos
    assert.equal(readySpecs[0].attributes.max_hp, 4);
    assert.equal(readySpecs[0].attributes.speed_px_s, 340);
    assert.equal(readySpecs[0].attributes.hitbox_radius, 10);

    w.stopWatching();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejeita weapons fora do schema quando weapons-arsenal FOI selecionado, mesmo com a fórmula-base disponível', async () => {
    const dir = tempSession();
    const auditPath = path.join(dir, 'mcp_audit.log');
    fs.writeFileSync(auditPath, '', 'utf8');

    const readySpecs: any[] = [];
    const rejections: any[] = [];
    const w = new FileWatcherService();
    w.startWatching(dir, {
      requiredMcps: ['weapons-arsenal'],
      onShipReady: (s) => readySpecs.push(s),
      onSpecRejected: (r) => rejections.push(r)
    });

    const rawSpec = {
      ...FALLBACK_PRESETS.interceptor,
      weapons: {
        ...FALLBACK_PRESETS.interceptor.weapons,
        primary: {
          ...FALLBACK_PRESETS.interceptor.weapons.primary,
          damage: 9999 // fora do range [10,60] do schema
        }
      }
    };

    fs.appendFileSync(auditPath, auditLine('weapons-arsenal', 'configure_primary_cannon'));
    fs.writeFileSync(path.join(dir, 'ship_spec.json'), JSON.stringify(rawSpec), 'utf8');
    await wait(900);

    assert.equal(readySpecs.length, 0, 'nunca deve mascarar dano inválido de um MCP selecionado com a fórmula-base');
    assert.equal(rejections.length, 1);
    assert.equal(rejections[0].reason, 'SCHEMA_INVALID');

    w.stopWatching();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('rejeita fire_rate fora da faixa em vez de clampar (D14 -- normalizeSpec não corrige mais faixas)', async () => {
    const dir = tempSession();
    const auditPath = path.join(dir, 'mcp_audit.log');
    fs.writeFileSync(auditPath, '', 'utf8');

    const readySpecs: any[] = [];
    const rejections: any[] = [];
    const w = new FileWatcherService();
    w.startWatching(dir, {
      requiredMcps: ['weapons-arsenal'],
      onShipReady: (s) => readySpecs.push(s),
      onSpecRejected: (r) => rejections.push(r)
    });

    const rawSpec = {
      ...FALLBACK_PRESETS.interceptor,
      weapons: {
        ...FALLBACK_PRESETS.interceptor.weapons,
        primary: {
          ...FALLBACK_PRESETS.interceptor.weapons.primary,
          fire_rate: 60 // fora da faixa [5,12] de BALANCE.ranges -- antes disto, normalizeSpec clampava para 12 em silêncio
        }
      }
    };

    fs.appendFileSync(auditPath, auditLine('weapons-arsenal', 'configure_primary_cannon'));
    fs.writeFileSync(path.join(dir, 'ship_spec.json'), JSON.stringify(rawSpec), 'utf8');
    await wait(900);

    assert.equal(readySpecs.length, 0, 'um fire_rate fora da faixa nunca pode ser silenciosamente clampado e decolar');
    assert.equal(rejections.length, 1);
    assert.equal(rejections[0].reason, 'SCHEMA_INVALID');
    assert.match(rejections[0].details.join(' '), /fire_rate|maximum/);

    w.stopWatching();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('aceita shield_capacity: 0 (valor legítimo do schema) quando cybernetics-shields é o único MCP selecionado, nos sliders padrão do app', async () => {
    const dir = tempSession();
    const auditPath = path.join(dir, 'mcp_audit.log');
    fs.writeFileSync(auditPath, '', 'utf8');

    const readySpecs: any[] = [];
    const rejections: any[] = [];
    const w = new FileWatcherService();
    w.startWatching(dir, {
      requiredMcps: ['cybernetics-shields'],
      onShipReady: (s) => readySpecs.push(s),
      onSpecRejected: (r) => rejections.push(r)
    });

    // Sliders padrão do player-app (App.tsx) -- tech: 15 é < 20, então o retorno
    // real de calibrate_energy_barrier é shield_capacity: 0 (um valor legítimo,
    // não "ausente").
    const sliders = { offense: 35, speed: 35, defense: 15, tech: 15 };
    const rawSpec = {
      pilot: FALLBACK_PRESETS.interceptor.pilot,
      build_metadata: {
        selected_mcps: ['cybernetics-shields'],
        selected_subagents: ['aesthetic-designer', 'systems-engineer'],
        energy_sliders: sliders,
        fast_grill_me_choices: { weapon_focus: 'laser_piercing', visual_theme: 'synthwave_80s' },
        synergies_unlocked: []
      },
      attributes: {
        shield_capacity: 0
      },
      // max_hp/speed_px_s/hitbox_radius e weapons ausentes de propósito -- hull-propulsion
      // e weapons-arsenal não foram selecionados
      visuals: FALLBACK_PRESETS.interceptor.visuals
    };

    fs.appendFileSync(auditPath, auditLine('cybernetics-shields', 'calibrate_energy_barrier'));
    fs.writeFileSync(path.join(dir, 'ship_spec.json'), JSON.stringify(rawSpec), 'utf8');
    await wait(900);

    assert.equal(rejections.length, 0, JSON.stringify(rejections));
    assert.equal(readySpecs.length, 1);
    assert.equal(readySpecs[0].attributes.shield_capacity, 0, 'um shield_capacity real de 0 não pode virar NaN nem ser rejeitado');

    w.stopWatching();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('não força Glass Cannon quando cybernetics-shields não é selecionado e o agente não declara synergies_unlocked', async () => {
    // Regressão do bug crítico da revisão final: hull-propulsion-only build (cybernetics-shields
    // e weapons-arsenal ambos não selecionados). O agente nunca recebe instrução de produzir
    // `synergies_unlocked` (GEMINI.md só inclui essa linha quando cybernetics-shields é
    // selecionado), então o raw input não traz o campo. Antes da correção, normalizeSpec
    // defaultava para ['Glass Cannon 🔥'] e applyBaselineForUnselectedMcps nunca tocava o campo,
    // então toda build sem cybernetics-shields decolava com Glass Cannon forçado (max_hp preso
    // em 2) independentemente do que o visitante realmente construiu.
    const dir = tempSession();
    const auditPath = path.join(dir, 'mcp_audit.log');
    fs.writeFileSync(auditPath, '', 'utf8');

    const readySpecs: any[] = [];
    const rejections: any[] = [];
    const w = new FileWatcherService();
    w.startWatching(dir, {
      requiredMcps: ['hull-propulsion'],
      onShipReady: (s) => readySpecs.push(s),
      onSpecRejected: (r) => rejections.push(r)
    });

    const sliders = { offense: 15, speed: 15, defense: 50, tech: 15 };
    const rawSpec = {
      pilot: FALLBACK_PRESETS.interceptor.pilot,
      build_metadata: {
        selected_mcps: ['hull-propulsion'],
        selected_subagents: ['aesthetic-designer', 'systems-engineer'],
        energy_sliders: sliders,
        fast_grill_me_choices: { weapon_focus: 'laser_piercing', visual_theme: 'synthwave_80s' }
        // synergies_unlocked ausente de propósito -- cybernetics-shields nunca foi chamado
      },
      attributes: {
        max_hp: 5,
        speed_px_s: 200,
        hitbox_radius: 15
        // shield_capacity ausente de propósito -- cybernetics-shields não selecionado
      },
      weapons: FALLBACK_PRESETS.interceptor.weapons,
      visuals: FALLBACK_PRESETS.interceptor.visuals
    };

    fs.appendFileSync(auditPath, auditLine('hull-propulsion', 'tune_thrusters'));
    fs.writeFileSync(path.join(dir, 'ship_spec.json'), JSON.stringify(rawSpec), 'utf8');
    await wait(900);

    assert.equal(rejections.length, 0, JSON.stringify(rejections));
    assert.equal(readySpecs.length, 1);
    assert.deepEqual(readySpecs[0].build_metadata.synergies_unlocked, []);

    const post = applySynergies(readySpecs[0]);
    assert.deepEqual(post.applied, [], 'nenhuma sinergia deve ser aplicada quando o visitante não declarou nenhuma');
    assert.equal(post.attributes.max_hp, 5, 'max_hp real do visitante (hull-propulsion) não pode virar 2 (Glass Cannon forçado)');

    w.stopWatching();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('normalizeSpec sozinho (sem o ramo de backfill tocá-lo) usa [] como padrão para synergies_unlocked ausente, não mais "Glass Cannon 🔥"', async () => {
    // cybernetics-shields FOI selecionado aqui, então applyBaselineForUnselectedMcps não entra
    // no ramo que zera synergies_unlocked -- isso isola o default do próprio normalizeSpec.
    const dir = tempSession();
    const auditPath = path.join(dir, 'mcp_audit.log');
    fs.writeFileSync(auditPath, '', 'utf8');

    const readySpecs: any[] = [];
    const rejections: any[] = [];
    const w = new FileWatcherService();
    w.startWatching(dir, {
      requiredMcps: ['cybernetics-shields'],
      onShipReady: (s) => readySpecs.push(s),
      onSpecRejected: (r) => rejections.push(r)
    });

    const rawSpec: any = {
      ...FALLBACK_PRESETS.interceptor,
      build_metadata: {
        ...FALLBACK_PRESETS.interceptor.build_metadata,
        selected_mcps: ['cybernetics-shields']
      }
    };
    delete rawSpec.build_metadata.synergies_unlocked;

    fs.appendFileSync(auditPath, auditLine('cybernetics-shields', 'calibrate_energy_barrier'));
    fs.writeFileSync(path.join(dir, 'ship_spec.json'), JSON.stringify(rawSpec), 'utf8');
    await wait(900);

    assert.equal(rejections.length, 0, JSON.stringify(rejections));
    assert.equal(readySpecs.length, 1);
    assert.deepEqual(readySpecs[0].build_metadata.synergies_unlocked, []);

    w.stopWatching();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('FileWatcherService — normalizeSpec: literais de fallback (revisão final, Importante 3)', () => {
  it('usa o teto de BALANCE.ranges para o damage-fallback do primário, independente do tipo de arma', async () => {
    // Antes: vulcan_spread defaultava para 35 sem base em balance.ts, enquanto laser/plasma
    // defaultavam para 45 (uma cópia manual do teto). Este fallback só dispara quando o agente
    // não forneceu literalmente nada aproveitável para damage -- não há razão para o tipo
    // influenciar esse valor.
    const dir = tempSession();
    const auditPath = path.join(dir, 'mcp_audit.log');
    fs.writeFileSync(auditPath, '', 'utf8');

    const readySpecs: any[] = [];
    const rejections: any[] = [];
    const w = new FileWatcherService();
    w.startWatching(dir, {
      requiredMcps: ['weapons-arsenal'],
      onShipReady: (s) => readySpecs.push(s),
      onSpecRejected: (r) => rejections.push(r)
    });

    const rawSpec: any = {
      ...FALLBACK_PRESETS.interceptor,
      weapons: {
        ...FALLBACK_PRESETS.interceptor.weapons,
        primary: {
          type: 'vulcan_spread',
          fire_rate: FALLBACK_PRESETS.interceptor.weapons.primary.fire_rate,
          bullet_speed: FALLBACK_PRESETS.interceptor.weapons.primary.bullet_speed
          // damage ausente de propósito -- o agente não forneceu nada aproveitável
        }
      }
    };

    fs.appendFileSync(auditPath, auditLine('weapons-arsenal', 'configure_primary_cannon'));
    fs.writeFileSync(path.join(dir, 'ship_spec.json'), JSON.stringify(rawSpec), 'utf8');
    await wait(900);

    assert.equal(rejections.length, 0, JSON.stringify(rejections));
    assert.equal(readySpecs.length, 1);
    assert.equal(
      readySpecs[0].weapons.primary.damage,
      BALANCE.ranges['weapons.primary.damage'].max,
      'vulcan_spread não deve mais defaultar para 35 -- mesmo teto usado por laser/plasma'
    );

    w.stopWatching();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('preserva um spread_angle real fornecido pelo raw em vez de sobrescrever com o default hardcoded', async () => {
    // Antes: spread_angle sempre virava 0.25 (vulcan_spread) ou 0 (demais tipos), mesmo quando o
    // raw trazia um valor real de weapons-arsenal ou de computeBaselineWeapons -- descartando um
    // campo que o GEMINI.md anuncia como controlado pelo agente, faixa [0,30].
    const dir = tempSession();
    const auditPath = path.join(dir, 'mcp_audit.log');
    fs.writeFileSync(auditPath, '', 'utf8');

    const readySpecs: any[] = [];
    const rejections: any[] = [];
    const w = new FileWatcherService();
    w.startWatching(dir, {
      requiredMcps: ['weapons-arsenal'],
      onShipReady: (s) => readySpecs.push(s),
      onSpecRejected: (r) => rejections.push(r)
    });

    const rawSpec: any = {
      ...FALLBACK_PRESETS.interceptor,
      weapons: {
        ...FALLBACK_PRESETS.interceptor.weapons,
        primary: {
          type: 'vulcan_spread',
          damage: 30,
          fire_rate: FALLBACK_PRESETS.interceptor.weapons.primary.fire_rate,
          bullet_speed: FALLBACK_PRESETS.interceptor.weapons.primary.bullet_speed,
          spread_angle: 12 // valor real e diferente do default hardcoded (0.25)
        }
      }
    };

    fs.appendFileSync(auditPath, auditLine('weapons-arsenal', 'configure_primary_cannon'));
    fs.writeFileSync(path.join(dir, 'ship_spec.json'), JSON.stringify(rawSpec), 'utf8');
    await wait(900);

    assert.equal(rejections.length, 0, JSON.stringify(rejections));
    assert.equal(readySpecs.length, 1);
    assert.equal(
      readySpecs[0].weapons.primary.spread_angle,
      12,
      'um spread_angle real não pode ser descartado pelo default hardcoded de vulcan_spread'
    );

    w.stopWatching();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
