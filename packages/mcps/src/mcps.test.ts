import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BALANCE, type BalanceRangeKey } from '@jogo/shared';
import {
  computePrimaryCannon,
  computeSecondaryOrdnance,
  createWeaponsArsenalServer
} from './weapons-arsenal.js';
import { createHullPropulsionServer } from './hull-propulsion.js';
import { createCyberneticsShieldsServer } from './cybernetics-shields.js';

describe('MCP Servers Creation and Tools Verification', () => {
  it('should instantiate weapons-arsenal MCP server', () => {
    const server = createWeaponsArsenalServer();
    assert.ok(server);
  });

  it('should instantiate hull-propulsion MCP server', () => {
    const server = createHullPropulsionServer();
    assert.ok(server);
  });

  it('should instantiate cybernetics-shields MCP server', () => {
    const server = createCyberneticsShieldsServer();
    assert.ok(server);
  });
});

/**
 * A REGRA ZERO manda o agente tirar TODO número de uma ferramenta MCP, e o schema gerado por
 * `gen-schema.ts` decide quais números são aceitáveis. As duas ordens só convivem se nenhuma
 * ferramenta conseguir emitir um valor fora de `BALANCE.ranges` — do contrário o agente é obrigado
 * a desobedecer uma delas, e a única saída que lhe resta é inventar o número.
 *
 * Em 2026-08-30 uma sessão real do estande foi rejeitada com
 * `/weapons/secondary/cooldown_seconds must be >= 3`: o padrão da tool era 2. Esta suíte existe
 * para que nenhum padrão, nenhum repasse e nenhum multiplicador volte a escapar da faixa.
 */
describe('weapons-arsenal nunca emite valor fora de BALANCE.ranges', () => {
  const inRange = (key: BalanceRangeKey, value: number) => {
    const { min, max } = BALANCE.ranges[key];
    assert.ok(
      value >= min && value <= max,
      `${key} = ${value} fora da faixa [${min}, ${max}] aceita pelo schema`
    );
  };

  // Nada aqui é hipotético: são as formas que um agente de verdade produz — campo omitido, `null`
  // explícito, texto no lugar de número, e valores absurdos nas duas pontas.
  const HOSTILE: Array<Record<string, unknown>> = [
    {},
    { type: null, fire_rate: null, damage_multiplier: null, cooldown_seconds: null },
    { fire_rate: 'rápido', damage_multiplier: 'muito', cooldown_seconds: 'curto' },
    { fire_rate: 0, damage_multiplier: 0, cooldown_seconds: 0 },
    { fire_rate: -50, damage_multiplier: -3, cooldown_seconds: -1 },
    { fire_rate: 999, damage_multiplier: 40, cooldown_seconds: 999 },
    { fire_rate: NaN, damage_multiplier: Infinity, cooldown_seconds: NaN }
  ];

  const PRIMARY_TYPES = ['plasma', 'laser', 'vulcan_spread', 'spread', 'vulcan', '', 'coisa nenhuma'];
  const SECONDARY_TYPES = ['homing_missiles', 'emp_burst', 'none', 'EMP', '', 'coisa nenhuma'];

  it('configure_primary_cannon devolve tudo dentro da faixa, para qualquer entrada', () => {
    for (const type of PRIMARY_TYPES) {
      for (const args of HOSTILE) {
        const r = computePrimaryCannon({ ...args, type });
        inRange('weapons.primary.damage', r.damage);
        inRange('weapons.primary.fire_rate', r.fire_rate);
        inRange('weapons.primary.bullet_speed', r.bullet_speed);
        inRange('weapons.primary.spread_angle', r.spread_angle);
      }
    }
  });

  it('attach_secondary_ordnance devolve tudo dentro da faixa, para qualquer entrada', () => {
    for (const type of SECONDARY_TYPES) {
      for (const args of HOSTILE) {
        const r = computeSecondaryOrdnance({ ...args, type });
        inRange('weapons.secondary.damage', r.damage);
        inRange('weapons.secondary.cooldown_seconds', r.cooldown_seconds);
      }
    }
  });

  it('o padrão de cooldown_seconds, sozinho, já é válido', () => {
    // A regressão exata de 2026-08-30: o agente não passa o argumento e a tool devolve o padrão.
    inRange('weapons.secondary.cooldown_seconds', computeSecondaryOrdnance({ type: 'emp_burst' }).cooldown_seconds);
    inRange('weapons.secondary.cooldown_seconds', computeSecondaryOrdnance().cooldown_seconds);
  });

  it('não devolve blast_radius, que não existe no ShipSpecification', () => {
    // `additionalProperties: false` em `weapons.secondary`: se o agente copiar o campo, o Ajv
    // rejeita a spec inteira. A tool não pode oferecer a tentação.
    assert.ok(!('blast_radius' in computeSecondaryOrdnance({ type: 'emp_burst', blast_radius: 250 })));
  });

  it('o tipo declarado casa com as estatísticas devolvidas', () => {
    // Antes, `"spread"` recebia as estatísticas do vulcan e voltava rotulado como `plasma`.
    const spread = computePrimaryCannon({ type: 'spread', damage_multiplier: 1 });
    assert.equal(spread.type, 'vulcan_spread');
    assert.equal(spread.spread_angle, computePrimaryCannon({ type: 'vulcan_spread' }).spread_angle);
    assert.equal(computePrimaryCannon({ type: 'plasma' }).spread_angle, 0);
  });

  it('o tipo secundário sobrevive ao caminho todo', () => {
    assert.equal(computeSecondaryOrdnance({ type: 'emp_burst' }).type, 'emp_burst');
    assert.equal(computeSecondaryOrdnance({ type: 'none' }).type, 'none');
    assert.equal(computeSecondaryOrdnance({ type: 'homing_missiles' }).type, 'homing_missiles');
    // O EMP continua batendo mais fraco que o míssil — a intenção de balanceamento não pode ter
    // sido apagada pelo clamp.
    assert.ok(
      computeSecondaryOrdnance({ type: 'emp_burst' }).damage <
        computeSecondaryOrdnance({ type: 'homing_missiles' }).damage
    );
  });
});
