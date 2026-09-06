import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { renderShipCardSvg, type ShipVisuals } from '@jogo/shared';
import { SQLiteBufferService, loadCompanyCatalog } from './sqlite-buffer.js';

function tempDb(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'booth-db-')), 'booth.sqlite');
}

describe('SQLiteBufferService', () => {
  it('não semeia pilotos fictícios por padrão', () => {
    delete process.env.BOOTH_SEED_DEMO;
    const db = new SQLiteBufferService(tempDb());
    const board = db.getLeaderboardData();
    assert.equal(board.topPilots.length, 0, 'o placar nasce vazio no estande');
    db.close();
  });

  it('semeia apenas quando BOOTH_SEED_DEMO=1', () => {
    process.env.BOOTH_SEED_DEMO = '1';
    const db = new SQLiteBufferService(tempDb());
    assert.ok(db.getLeaderboardData().topPilots.length > 0);
    db.close();
    delete process.env.BOOTH_SEED_DEMO;
  });

  it('resolve o caminho padrão de forma absoluta, independente do cwd', () => {
    delete process.env.BOOTH_DB_PATH;
    assert.ok(path.isAbsolute(SQLiteBufferService.defaultDbPath()));
  });

  it('rejeita partida sem telemetria em vez de gravar objeto vazio', () => {
    const db = new SQLiteBufferService(tempDb());
    assert.throws(
      () => db.saveMatch({ match_id: 'm1', callsign: 'X', company_canonical: 'Acme', final_score: 10 } as any),
      /telemetry/
    );
    db.close();
  });

  it('preserva telemetria e snapshot da nave no round-trip', () => {
    const db = new SQLiteBufferService(tempDb());
    db.saveMatch({
      match_id: 'm2',
      pilot_id: 'pilot-abc',
      callsign: 'NOVA',
      company_canonical: 'Acme',
      company_raw: 'acme corp',
      company_confidence: 0.95,
      final_score: 12345,
      telemetry: {
        duration_s: 90, enemies_killed: 42, boss_defeated: true, damage_taken: 2,
        accuracy_pct: 61.5, shots_fired: 400, shots_hit: 246,
        fallback_used: false, seed: 7, boss_ttk_s: 31.2, boss_fight_min_fps: 58.4,
        boss_damage_dealt: 800, boss_phase_reached: 3
      },
      ship_spec_snapshot: { pilot: { callsign: 'NOVA' } } as any,
      score_breakdown: {
        combatScore: 1000, bossBonus: 500, timeBonus: 100, survivalBonus: 50,
        bossDamageBonus: 0, bossPhaseBonus: 0, synergyBonus: 0, mcpMultiplier: 1.1
      },
      created_at: new Date().toISOString()
    });

    const pending = db.getPendingMatches();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].pilot_id, 'pilot-abc');
    assert.equal(pending[0].telemetry.enemies_killed, 42);
    assert.equal(pending[0].telemetry.seed, 7);
    assert.equal(pending[0].ship_spec_snapshot.pilot.callsign, 'NOVA');
    assert.equal(pending[0].company_raw, 'acme corp');
    assert.equal(pending[0].company_confidence, 0.95);
    assert.deepEqual(pending[0].score_breakdown, {
      combatScore: 1000, bossBonus: 500, timeBonus: 100, survivalBonus: 50,
      bossDamageBonus: 0, bossPhaseBonus: 0, synergyBonus: 0, mcpMultiplier: 1.1
    });
    assert.equal(pending[0].needs_company_review, false, 'confiança 0.95 está acima do limiar de 0.80');
    db.close();
  });

  it('marca needs_company_review quando a confiança fica abaixo de 0.80', () => {
    const db = new SQLiteBufferService(tempDb());
    db.saveMatch({
      match_id: 'm3',
      pilot_id: 'pilot-xyz',
      callsign: 'GHOST',
      company_canonical: 'Startup Do João',
      company_raw: 'startup do joao',
      company_confidence: 0.5,
      final_score: 100,
      telemetry: {
        duration_s: 10, enemies_killed: 1, boss_defeated: false, damage_taken: 0,
        accuracy_pct: 100, shots_fired: 1, shots_hit: 1,
        fallback_used: false, seed: 1, boss_ttk_s: null, boss_fight_min_fps: null,
        boss_damage_dealt: 0, boss_phase_reached: null
      },
      ship_spec_snapshot: { pilot: { callsign: 'GHOST' } } as any,
      score_breakdown: {
        combatScore: 10, bossBonus: 0, timeBonus: 0, survivalBonus: 0,
        bossDamageBonus: 0, bossPhaseBonus: 0, synergyBonus: 0, mcpMultiplier: 1
      },
      created_at: new Date().toISOString()
    });

    const pending = db.getPendingMatches();
    assert.equal(pending[0].needs_company_review, true);
    db.close();
  });

  it('não atribui a Google uma empresa vazia', () => {
    const db = new SQLiteBufferService(tempDb());
    assert.notEqual(db.resolveCompany('').canonical, 'Google');
    assert.notEqual(db.resolveCompany('   ').canonical, 'Google');
    assert.equal(db.resolveCompany('').canonical, 'Independente');
    db.close();
  });

  it('continua resolvendo os typos conhecidos', () => {
    const db = new SQLiteBufferService(tempDb());
    assert.equal(db.resolveCompany('Gooogle').canonical, 'Google');
    db.close();
  });

  it('trata entrada vazia como confiança 1.0 -- é um default deliberado, não uma dúvida', () => {
    const db = new SQLiteBufferService(tempDb());
    assert.equal(db.resolveCompany('').confidence, 1.0);
    db.close();
  });

  it('devolve confiança alta (>= 0.8) para um typo conhecido resolvido via catálogo', () => {
    const db = new SQLiteBufferService(tempDb());
    const resolved = db.resolveCompany('Gooogle');
    assert.equal(resolved.canonical, 'Google');
    assert.ok(resolved.confidence >= 0.8, `esperava confiança >= 0.8, recebeu ${resolved.confidence}`);
    db.close();
  });

  it('devolve confiança baixa para uma entrada nova que só bate no fallback do catálogo', () => {
    const db = new SQLiteBufferService(tempDb());
    const resolved = db.resolveCompany('Startup do João');
    assert.equal(resolved.canonical, 'Startup Do João');
    assert.ok(resolved.confidence < 0.8, `esperava confiança < 0.8, recebeu ${resolved.confidence}`);
    db.close();
  });

  it('trata um hit de cache de alias como confiança 1.0, mesmo que a resolução original tenha sido incerta', () => {
    const db = new SQLiteBufferService(tempDb());
    const first = db.resolveCompany('Startup do João');
    assert.ok(first.confidence < 0.8, 'pré-condição: a primeira resolução precisa ser incerta');

    const second = db.resolveCompany('Startup do João');
    assert.equal(second.canonical, 'Startup Do João');
    assert.equal(second.confidence, 1.0, 'um alias já em cache é uma resolução já aceita antes -- não há dúvida a marcar');
    db.close();
  });
});

describe('auto-cura do schema pré-C8', () => {
  it('adiciona as colunas novas a um banco existente com o schema antigo, sem perder saveMatch', () => {
    const dbPath = tempDb();

    // Simula um banco criado antes da Tarefa C8: só as 9 colunas originais.
    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE local_matches (
        match_id TEXT PRIMARY KEY,
        pilot_id TEXT NOT NULL,
        callsign TEXT NOT NULL,
        company_canonical TEXT NOT NULL,
        final_score INTEGER NOT NULL,
        telemetry_json TEXT NOT NULL,
        ship_spec_json TEXT NOT NULL,
        synced_to_cloud INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
      );
    `);
    raw.close();

    // Antes da correção, isto lançaria "table local_matches has no column named company_raw".
    const db = new SQLiteBufferService(dbPath);
    assert.doesNotThrow(() => db.saveMatch({
      match_id: 'm-old-schema',
      pilot_id: 'pilot-old',
      callsign: 'LEGACY',
      company_canonical: 'Acme',
      company_raw: 'acme',
      company_confidence: 0.95,
      final_score: 100,
      telemetry: {
        duration_s: 10, enemies_killed: 1, boss_defeated: false, damage_taken: 0,
        accuracy_pct: 50, shots_fired: 2, shots_hit: 1,
        fallback_used: false, seed: 1, boss_ttk_s: 0, boss_fight_min_fps: 60,
        boss_damage_dealt: 0, boss_phase_reached: 0
      },
      ship_spec_snapshot: { pilot: { callsign: 'LEGACY' } } as any
    } as any));
    db.close();
  });

  it('continua funcionando normalmente num banco novo, sem arquivo pré-existente (regressão)', () => {
    const db = new SQLiteBufferService(tempDb());
    assert.doesNotThrow(() => db.saveMatch({
      match_id: 'm-fresh',
      pilot_id: 'pilot-fresh',
      callsign: 'FRESH',
      company_canonical: 'Acme',
      final_score: 50,
      telemetry: {
        duration_s: 10, enemies_killed: 1, boss_defeated: false, damage_taken: 0,
        accuracy_pct: 50, shots_fired: 2, shots_hit: 1,
        fallback_used: false, seed: 1, boss_ttk_s: 0, boss_fight_min_fps: 60,
        boss_damage_dealt: 0, boss_phase_reached: 0
      },
      ship_spec_snapshot: { pilot: { callsign: 'FRESH' } } as any
    } as any));
    db.close();
  });
});

/**
 * O visual da nave atravessa este buffer como TEXTO: `saveMatch` faz `JSON.stringify` do spec
 * inteiro numa coluna `ship_spec_json` e `getPendingMatches` o reidrata. Todos os testes acima
 * gravam um `ship_spec_snapshot` de mentira (`{ pilot: { callsign } }`), então até aqui nada
 * neste repositório provava que `visuals` sobrevive ao trajeto — e ele é a única fonte do cartão
 * SVG que o `cardgen` desenha na nuvem. Um casco truncado ou uma cor perdida aqui só apareceria
 * meses depois, num consumidor que já não tem como saber o que era para estar lá.
 */
describe('o visual da nave sobrevive ao buffer local', () => {
  // Casco no formato que o agente de fato produz: só comandos de path, dentro do viewBox 0..128.
  const FORGED_VISUALS: ShipVisuals = {
    style_name: 'Interceptador "Aço & Cinza" <v2>',
    primary_color: '#1a2b3c',
    secondary_color: '#ff00aa',
    engine_trail_color: '#00ffcc',
    svg_path_data: 'M 64 8 C 80 40, 96 72, 88 118 L 40 118 C 32 72, 48 40, 64 8 Z'
  };

  function specWith(visuals: ShipVisuals) {
    return {
      pilot: { callsign: 'NOVA', pilot_id: 'pilot-abc' },
      attributes: { shield_capacity: 3 },
      visuals,
      build_metadata: { fast_grill_me_choices: { visual_theme: 'cyberpunk', accent_color: 'ciano' } }
    } as any;
  }

  function roundTrip(visuals: ShipVisuals) {
    const db = new SQLiteBufferService(tempDb());
    db.saveMatch({
      match_id: 'm-visual',
      pilot_id: 'pilot-abc',
      callsign: 'NOVA',
      company_canonical: 'Acme',
      final_score: 1,
      telemetry: {
        duration_s: 10, enemies_killed: 1, boss_defeated: false, damage_taken: 0,
        accuracy_pct: 50, shots_fired: 2, shots_hit: 1,
        fallback_used: false, seed: 1, boss_ttk_s: null, boss_fight_min_fps: null,
        boss_damage_dealt: 0, boss_phase_reached: null
      },
      ship_spec_snapshot: specWith(visuals),
      created_at: new Date().toISOString()
    } as any);
    const pending = db.getPendingMatches();
    db.close();
    return pending[0].ship_spec_snapshot as any;
  }

  it('devolve `visuals` profundamente igual, campo por campo', () => {
    const spec = roundTrip(FORGED_VISUALS);
    assert.deepEqual(spec.visuals, FORGED_VISUALS);
  });

  it('não trunca nem reescreve o `svg_path_data` — a comparação é byte a byte', () => {
    const spec = roundTrip(FORGED_VISUALS);
    assert.equal(spec.visuals.svg_path_data, FORGED_VISUALS.svg_path_data);
    assert.equal(spec.attributes.shield_capacity, 3, 'o escudo decide se o cartão tem anel');
  });

  it('o cartão desenhado do spec reidratado é idêntico ao desenhado do original', () => {
    // É esta a asserção que fecha o ciclo: o `cardgen` não vê o spec original, só o que saiu
    // deste buffer e foi ingerido. Se o SVG for o mesmo, o buffer não perdeu nada que importe.
    assert.equal(
      renderShipCardSvg(roundTrip(FORGED_VISUALS)),
      renderShipCardSvg(specWith(FORGED_VISUALS))
    );
  });

  it('preserva as escolhas de faceta do Fast-Grill-Me, que é o que torna a base pesquisável', () => {
    const spec = roundTrip(FORGED_VISUALS);
    assert.deepEqual(spec.build_metadata.fast_grill_me_choices, {
      visual_theme: 'cyberpunk',
      accent_color: 'ciano'
    });
  });
});

describe('catálogo de empresas', () => {
  it('carrega do arquivo apontado por BOOTH_COMPANIES_FILE', () => {
    const f = path.join(os.tmpdir(), `companies-${process.pid}.json`);
    fs.writeFileSync(f, JSON.stringify({ companies: ['Acme Corp', 'Umbrella'] }));
    assert.deepEqual(loadCompanyCatalog(f), ['Acme Corp', 'Umbrella']);
    fs.unlinkSync(f);
  });

  it('cai na lista embutida quando o arquivo não existe, em vez de subir vazio', () => {
    const catalog = loadCompanyCatalog('/caminho/que/nao/existe.json');
    assert.ok(catalog.includes('Google'));
    assert.ok(catalog.length >= 20);
  });

  it('recusa um arquivo malformado em vez de silenciar', () => {
    const f = path.join(os.tmpdir(), `bad-${process.pid}.json`);
    fs.writeFileSync(f, '{ isto não é json');
    assert.throws(() => loadCompanyCatalog(f), /companies\.json/i);
    fs.unlinkSync(f);
  });
});

describe('moderação do campo empresa', () => {
  it('não deixa texto ofensivo virar nome de empresa no telão', () => {
    const buffer = new SQLiteBufferService(tempDb());
    assert.equal(buffer.resolveCompany('PORRA LTDA').canonical, 'Independente');
    assert.equal(buffer.resolveCompany('p0rr4 tech').canonical, 'Independente');
    buffer.close();
  });

  it('trata o override de profanidade como confiança 1.0 -- é uma decisão deliberada, não incerteza', () => {
    const buffer = new SQLiteBufferService(tempDb());
    assert.equal(buffer.resolveCompany('PORRA LTDA').confidence, 1.0);
    buffer.close();
  });

  it('não afeta empresa desconhecida mas inofensiva', () => {
    const buffer = new SQLiteBufferService(tempDb());
    assert.equal(buffer.resolveCompany('Startup do João').canonical, 'Startup Do João');
    buffer.close();
  });

  it('não afeta empresa do catálogo', () => {
    const buffer = new SQLiteBufferService(tempDb());
    assert.equal(buffer.resolveCompany('Gooogle Brasil').canonical, 'Google');
    buffer.close();
  });
});

/**
 * Espelhamento do catálogo vindo da nuvem (Fase 3a).
 *
 * Estas travas são a diferença entre "o painel de admin controla as duas estações" e "um clique
 * errado no painel derruba as duas estações". Merecem teste próprio porque o modo de falha delas
 * é assimétrico: quando funcionam ninguém percebe, e quando não funcionam o estande abre com o
 * autocomplete vazio e cada visitante vira uma linha nova em `company_rankings`.
 */
function bufferComCatalogo(companies: string[]): { buffer: SQLiteBufferService; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'booth-cat-'));
  const file = path.join(dir, 'companies.json');
  fs.writeFileSync(file, JSON.stringify({ companies }));
  const anterior = process.env.BOOTH_COMPANIES_FILE;
  process.env.BOOTH_COMPANIES_FILE = file;
  const buffer = new SQLiteBufferService(path.join(dir, 'booth.sqlite'));
  return {
    buffer,
    cleanup: () => {
      buffer.close();
      if (anterior === undefined) delete process.env.BOOTH_COMPANIES_FILE;
      else process.env.BOOTH_COMPANIES_FILE = anterior;
    }
  };
}

describe('espelhamento do catálogo da nuvem', () => {
  it('espelha exatamente: insere o que falta e remove o que sumiu', () => {
    const { buffer, cleanup } = bufferComCatalogo(['Google', 'Nubank', 'Itaú', 'Globo']);

    const result = buffer.applyCanonicalCatalog(['Google', 'Nubank', 'Itaú', 'Embraer']);

    assert.equal(result.applied, true);
    assert.deepEqual(result.added, ['Embraer']);
    assert.deepEqual(result.removed, ['Globo']);
    assert.deepEqual(buffer.getCanonicalList(), ['Embraer', 'Google', 'Itaú', 'Nubank']);
    cleanup();
  });

  it('NUNCA aplica catálogo vazio, nem com a env de escape ligada', () => {
    const { buffer, cleanup } = bufferComCatalogo(['Google', 'Nubank']);

    for (const opts of [{}, { allowMassRemoval: true, maxRemovalRatio: 1 }]) {
      const result = buffer.applyCanonicalCatalog([], opts);
      assert.equal(result.applied, false);
      assert.match(result.refusedReason ?? '', /vazio/);
    }
    assert.deepEqual(buffer.getCanonicalList(), ['Google', 'Nubank'], 'o estande fica com o que tinha');
    cleanup();
  });

  it('recusa remoção em massa sem a env de escape e aplica com ela', () => {
    const { buffer, cleanup } = bufferComCatalogo(['A', 'B', 'C', 'D', 'E']);

    // 4 de 5 sumiriam: 80%, muito acima dos 30% de default.
    const recusado = buffer.applyCanonicalCatalog(['A']);
    assert.equal(recusado.applied, false);
    assert.match(recusado.refusedReason ?? '', /BOOTH_CATALOG_ALLOW_MASS_REMOVAL/);
    assert.equal(buffer.getCanonicalList().length, 5, 'recusa não pode aplicar nem as adições');

    const forcado = buffer.applyCanonicalCatalog(['A'], { allowMassRemoval: true });
    assert.equal(forcado.applied, true);
    assert.deepEqual(buffer.getCanonicalList(), ['A']);
    cleanup();
  });

  it('aplica remoção dentro do limiar sem precisar de escape', () => {
    const { buffer, cleanup } = bufferComCatalogo(['A', 'B', 'C', 'D', 'E']);

    const result = buffer.applyCanonicalCatalog(['A', 'B', 'C', 'D']); // 1 de 5 = 20%

    assert.equal(result.applied, true);
    assert.deepEqual(result.removed, ['E']);
    cleanup();
  });

  it('additiveOnly só adiciona, mesmo com empresas fora da lista recebida', () => {
    // O caso: a nuvem respondeu `version: 0`, isto é, está servindo a própria semente de disco.
    const { buffer, cleanup } = bufferComCatalogo(['Cadastrada No Mac', 'Google']);

    const result = buffer.applyCanonicalCatalog(['Google', 'Nubank'], { additiveOnly: true });

    assert.deepEqual(result.added, ['Nubank']);
    assert.deepEqual(result.removed, []);
    assert.ok(buffer.getCanonicalList().includes('Cadastrada No Mac'));
    cleanup();
  });

  it('remover uma empresa NÃO apaga os aliases já aprendidos que apontavam para ela', () => {
    const { buffer, cleanup } = bufferComCatalogo(['Google', 'Nubank', 'Itaú', 'Globo']);
    assert.equal(buffer.resolveCompany('globo comunicação').canonical, 'Globo');

    buffer.applyCanonicalCatalog(['Google', 'Nubank', 'Itaú']);

    assert.ok(!buffer.getCanonicalList().includes('Globo'), 'saiu do catálogo');
    assert.equal(
      buffer.resolveCompany('globo comunicação').canonical,
      'Globo',
      'quem já jogou continua no mesmo ranking — o histórico do evento não é reescrito no meio dele'
    );
    cleanup();
  });

  it('é idempotente: reaplicar a mesma lista não mexe em nada', () => {
    const { buffer, cleanup } = bufferComCatalogo(['Google', 'Nubank']);

    const result = buffer.applyCanonicalCatalog(['Google', 'Nubank']);

    assert.equal(result.applied, true);
    assert.deepEqual(result.added, []);
    assert.deepEqual(result.removed, []);
    cleanup();
  });

  it('ignora entradas em branco e duplicadas vindas da nuvem', () => {
    const { buffer, cleanup } = bufferComCatalogo(['Google']);

    const result = buffer.applyCanonicalCatalog(['Google', 'Nubank', 'Nubank', '   ', '']);

    assert.deepEqual(result.added, ['Nubank']);
    assert.deepEqual(buffer.getCanonicalList(), ['Google', 'Nubank']);
    cleanup();
  });
});

describe('merge de aliases da nuvem', () => {
  it('respeita a precedência override > cloud > local', () => {
    const buffer = new SQLiteBufferService(tempDb());

    buffer.cacheAlias('acme', 'Palpite Local', 'local');
    buffer.cacheAlias('acme', 'Acme Corp', 'cloud', '2026-09-01T10:00:00.000Z');
    assert.equal(buffer.getAlias('acme')?.canonical, 'Acme Corp', 'a nuvem corrige o palpite fuzzy local');

    buffer.cacheAlias('acme', 'Palpite Local De Novo', 'local');
    assert.equal(buffer.getAlias('acme')?.canonical, 'Acme Corp', 'e o local não pode desfazer a correção');

    buffer.cacheAlias('acme', 'Independente', 'override');
    assert.equal(buffer.getAlias('acme')?.canonical, 'Independente');

    buffer.cacheAlias('acme', 'Acme Corp', 'cloud', '2026-09-02T10:00:00.000Z');
    assert.equal(
      buffer.getAlias('acme')?.canonical,
      'Independente',
      'sem isto, o pull ressuscita no telão um nome que o filtro de profanidade bloqueou'
    );
    buffer.close();
  });

  it('entre dois cloud, ganha o resolved_at mais recente', () => {
    const buffer = new SQLiteBufferService(tempDb());

    buffer.cacheAlias('acme', 'Versão Nova', 'cloud', '2026-09-02T10:00:00.000Z');
    buffer.cacheAlias('acme', 'Versão Velha', 'cloud', '2026-09-01T10:00:00.000Z');

    assert.equal(buffer.getAlias('acme')?.canonical, 'Versão Nova', 'página fora de ordem não pode regredir');
    buffer.close();
  });

  it('normaliza o raw para minúsculas — a nuvem manda o texto como o visitante digitou', () => {
    const buffer = new SQLiteBufferService(tempDb());

    buffer.mergeCloudAliases([
      { raw: 'ACME CORP LTDA', canonical: 'Acme', resolved_at: '2026-09-01T10:00:00.000Z' }
    ]);

    assert.equal(buffer.getAlias('acme corp ltda')?.canonical, 'Acme');
    assert.equal(
      buffer.resolveCompany('Acme Corp Ltda').canonical,
      'Acme',
      'sem o lowercase o cache nunca acertaria e o alias da nuvem seria inútil'
    );
    buffer.close();
  });

  it('descarta aliases inválidos ou ofensivos sem derrubar a página inteira', () => {
    const buffer = new SQLiteBufferService(tempDb());

    const result = buffer.mergeCloudAliases([
      { raw: 'bom', canonical: 'Empresa Boa', resolved_at: '2026-09-01T10:00:00.000Z' },
      { raw: '', canonical: 'Sem Raw', resolved_at: '2026-09-01T10:00:00.000Z' },
      { raw: 'sem canonical', canonical: '   ', resolved_at: '2026-09-01T10:00:00.000Z' },
      { raw: 'ofensivo', canonical: 'PORRA LTDA', resolved_at: '2026-09-01T10:00:00.000Z' }
    ]);

    assert.equal(result.applied, 1);
    assert.equal(result.skipped, 3);
    assert.equal(buffer.getAlias('bom')?.canonical, 'Empresa Boa');
    assert.equal(buffer.getAlias('ofensivo'), null);
    buffer.close();
  });

  it('aceita resolved_at ausente ou ilegível sem descartar o alias', () => {
    const buffer = new SQLiteBufferService(tempDb());

    const result = buffer.mergeCloudAliases([
      { raw: 'sem data', canonical: 'Empresa', resolved_at: 'não é data' }
    ]);

    assert.equal(result.applied, 1);
    assert.equal(buffer.getAlias('sem data')?.source, 'cloud');
    assert.ok(buffer.getAlias('sem data')?.resolved_at, 'o merge carimba a hora local no lugar');
    buffer.close();
  });

  it('reaplicar a MESMA página não conta como trabalho — o alias da fronteira do cursor volta sempre', () => {
    const buffer = new SQLiteBufferService(tempDb());
    const pagina = [{ raw: 'bidu', canonical: 'Bidu Telecom', resolved_at: '2026-09-01T10:00:00.000Z' }];

    assert.equal(buffer.mergeCloudAliases(pagina).applied, 1, 'a primeira vez é trabalho de verdade');

    // `GET /v1/aliases` usa `resolved_at >= since` e devolve o último `resolved_at` como próximo
    // cursor, então este item volta em toda página. Achado ao vivo em 2026-09-06: o log do
    // estande tinha centenas de "1 aplicado(s)" idênticos e `lastPageApplied` ficava preso em 1,
    // escondendo qualquer pull real. Repetir não pode mais contar.
    for (let i = 0; i < 5; i++) {
      assert.equal(buffer.mergeCloudAliases(pagina).applied, 0, `tick ${i + 1} não mudou nada`);
    }

    assert.equal(buffer.getAlias('bidu')?.canonical, 'Bidu Telecom', 'e o alias continua lá');
    buffer.close();
  });

  it('uma correção de verdade no mesmo raw ainda conta', () => {
    const buffer = new SQLiteBufferService(tempDb());

    buffer.mergeCloudAliases([{ raw: 'bidu', canonical: 'Bidu Telecom', resolved_at: '2026-09-01T10:00:00.000Z' }]);
    const depois = buffer.mergeCloudAliases([
      { raw: 'bidu', canonical: 'Bidu Telecomunicacoes', resolved_at: '2026-09-01T11:00:00.000Z' }
    ]);

    assert.equal(depois.applied, 1, 'a guarda de no-op não pode engolir uma correção');
    assert.equal(buffer.getAlias('bidu')?.canonical, 'Bidu Telecomunicacoes');
    buffer.close();
  });

  it('marca a procedência de quem resolve localmente', () => {
    const buffer = new SQLiteBufferService(tempDb());

    buffer.resolveCompany('Gooogle Brasil');
    assert.equal(buffer.getAlias('gooogle brasil')?.source, 'local');

    buffer.resolveCompany('PORRA LTDA');
    assert.equal(buffer.getAlias('porra ltda')?.source, 'override', 'o bloqueio de profanidade é override');
    buffer.close();
  });
});

describe('auto-cura do schema de aliases e metadados', () => {
  it('adiciona source/resolved_at a um banco antigo sem perder os aliases já aprendidos', () => {
    const dbPath = tempDb();

    // Banco criado antes da Fase 3: `company_aliases` sem procedência, e sem `booth_metadata`.
    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE company_aliases (
        raw_input TEXT PRIMARY KEY,
        canonical_name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO company_aliases (raw_input, canonical_name, created_at)
        VALUES ('velho', 'Empresa Antiga', '2026-08-01T00:00:00.000Z');
    `);
    raw.close();

    const db = new SQLiteBufferService(dbPath);

    const alias = db.getAlias('velho');
    assert.equal(alias?.canonical, 'Empresa Antiga', 'o aprendizado anterior não pode ser perdido na migração');
    assert.equal(alias?.source, 'local', 'linha antiga é um palpite local — é isso que ela sempre foi');
    assert.equal(alias?.resolved_at, null);

    // E a linha antiga tem que poder ser corrigida pela nuvem, que é o ponto da migração.
    db.mergeCloudAliases([{ raw: 'velho', canonical: 'Empresa Correta', resolved_at: '2026-09-01T00:00:00.000Z' }]);
    assert.equal(db.getAlias('velho')?.canonical, 'Empresa Correta');
    db.close();
  });

  it('booth_metadata guarda e sobrescreve chaves, e devolve null para chave ausente', () => {
    const db = new SQLiteBufferService(tempDb());

    assert.equal(db.getMetadata('catalog_version'), null);
    db.setMetadata('catalog_version', '3');
    assert.equal(db.getMetadata('catalog_version'), '3');
    db.setMetadata('catalog_version', '4');
    assert.equal(db.getMetadata('catalog_version'), '4');
    db.close();
  });

  it('metadados sobrevivem a um reinício do daemon', () => {
    const dbPath = tempDb();
    const primeiro = new SQLiteBufferService(dbPath);
    primeiro.setMetadata('alias_cursor', '2026-09-01T10:00:00.000Z');
    primeiro.close();

    const segundo = new SQLiteBufferService(dbPath);
    assert.equal(
      segundo.getMetadata('alias_cursor'),
      '2026-09-01T10:00:00.000Z',
      'perder o cursor faria cada reinício repuxar a coleção inteira'
    );
    segundo.close();
  });
});
