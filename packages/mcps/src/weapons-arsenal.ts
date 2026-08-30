import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { logMcpToolExecution } from './utils/audit-logger.js';
import {
  BALANCE,
  MCP_CATALOG,
  type BalanceRangeKey,
  type McpServerName,
  type PrimaryWeaponType,
  type SecondaryWeaponType
} from '@jogo/shared';

/**
 * Descrição da ferramenta, lida de `MCP_CATALOG` (`@jogo/shared`). A mesma string
 * alimenta o card que o visitante vê no builder — antes havia duas cópias sem fonte
 * comum, e elas derivaram. `mcp-catalog.test.ts` tranca a igualdade.
 */
function toolBlurb(server: McpServerName, toolId: string): string {
  const found = MCP_CATALOG[server].tools.find((t) => t.id === toolId);
  if (!found) throw new Error(`Ferramenta ${toolId} ausente de MCP_CATALOG['${server}']`);
  return found.blurb;
}

/**
 * Converte um argumento cru do agente em número, caindo no padrão quando ele não mandou nada
 * utilizável. `null`, `undefined` e string vazia contam como ausência — `Number(null)` é 0, e um
 * zero silencioso é pior que o padrão declarado.
 */
function numberOr(raw: unknown, fallback: number): number {
  if (raw === null || raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Prende um valor dentro da faixa de `BALANCE.ranges` — a MESMA fonte que `gen-schema.ts` usa para
 * gerar o `ship_spec.schema.json`.
 *
 * Sem isso uma ferramenta MCP pode devolver, com toda a autoridade que a REGRA ZERO lhe dá, um
 * número que o Ajv rejeita — e o agente fica entre duas ordens contraditórias: "todo número vem da
 * tool" e "este campo vale de 3 a 12". Em 2026-08-30 foi exatamente o que aconteceu: o padrão de
 * `cooldown_seconds` era 2, o piso do schema é 3, a spec foi rejeitada e o agente só conseguiu se
 * recuperar inventando o número — violando a REGRA ZERO para satisfazer o schema.
 */
function clampToRange(key: BalanceRangeKey, value: number): number {
  const { min, max } = BALANCE.ranges[key];
  return Math.min(max, Math.max(min, value));
}

/**
 * Perfil de cada canhão primário. Antes esses números viviam numa cadeia de `if/else` e o tipo
 * declarado no retorno era recalculado por um ternário com condição levemente diferente — um
 * pedido de `"spread"` recebia as estatísticas do vulcan e voltava rotulado como `plasma`. Com uma
 * tabela indexada pelo tipo já resolvido, estatística e rótulo não têm como divergir.
 */
const PRIMARY_PROFILES: Record<PrimaryWeaponType, { base_damage: number; bullet_speed: number; spread_angle: number }> = {
  plasma: { base_damage: 35, bullet_speed: 650, spread_angle: 0 },
  laser: { base_damage: 25, bullet_speed: 750, spread_angle: 0 },
  vulcan_spread: { base_damage: 20, bullet_speed: 600, spread_angle: 15 }
};

function resolvePrimaryType(raw: unknown): PrimaryWeaponType {
  const text = String(raw ?? 'plasma').toLowerCase();
  if (text.includes('laser')) return 'laser';
  if (text.includes('vulcan') || text.includes('spread')) return 'vulcan_spread';
  return 'plasma';
}

function resolveSecondaryType(raw: unknown): SecondaryWeaponType {
  const text = String(raw ?? 'homing_missiles').toLowerCase();
  if (text.includes('emp')) return 'emp_burst';
  if (text.includes('none')) return 'none';
  return 'homing_missiles';
}

/**
 * Núcleo puro do `configure_primary_cannon`. Separado do handler para que o teste consiga
 * bombardeá-lo com argumentos hostis sem levantar um servidor MCP.
 */
export function computePrimaryCannon(args?: Record<string, unknown> | null) {
  const type = resolvePrimaryType(args?.type);
  const profile = PRIMARY_PROFILES[type];

  const fire_rate = clampToRange('weapons.primary.fire_rate', numberOr(args?.fire_rate, 8));
  const damage = clampToRange(
    'weapons.primary.damage',
    Math.round(profile.base_damage * numberOr(args?.damage_multiplier, 1.0))
  );
  const bullet_speed = clampToRange('weapons.primary.bullet_speed', profile.bullet_speed);
  const spread_angle = clampToRange('weapons.primary.spread_angle', profile.spread_angle);

  return {
    type,
    damage,
    fire_rate,
    bullet_speed,
    spread_angle,
    // Derivado, não é campo do schema: existe para o agente narrar a build no terminal.
    dps_estimate: Math.round(damage * fire_rate)
  };
}

/**
 * Núcleo puro do `attach_secondary_ordnance`.
 *
 * `blast_radius` sumiu do retorno de propósito. O campo não existe em `ShipSpecification`, e como
 * todo objeto aninhado do schema é `additionalProperties: false`, um agente que o copiasse para
 * `weapons.secondary` derrubaria a spec inteira. O raio do EMP nunca foi configurável: o jogo lê
 * `BALANCE.weapons.secondary.emp_radius_px` (300) e ignora qualquer outro valor. O argumento
 * continua sendo aceito para não quebrar quem já o manda.
 */
export function computeSecondaryOrdnance(args?: Record<string, unknown> | null) {
  const type = resolveSecondaryType(args?.type);
  const damageRange = BALANCE.ranges['weapons.secondary.damage'];

  // `none` recebe o piso do schema, não zero — mesma decisão de `computeSecondaryDamage` em
  // `baseline-ship-stats.ts`. Um valor abaixo do piso não é "mais fraco", é inválido.
  const rawDamage = type === 'emp_burst' ? 60 : type === 'none' ? damageRange.min : 100;

  return {
    type,
    damage: clampToRange('weapons.secondary.damage', rawDamage),
    cooldown_seconds: clampToRange(
      'weapons.secondary.cooldown_seconds',
      numberOr(args?.cooldown_seconds, BALANCE.ranges['weapons.secondary.cooldown_seconds'].min)
    ),
    status: 'ARMED'
  };
}

export function createWeaponsArsenalServer(): McpServer {
  const server = new McpServer({
    name: 'weapons-arsenal',
    version: '1.0.0'
  });

  server.tool(
    'configure_primary_cannon',
    toolBlurb('weapons-arsenal', 'configure_primary_cannon'),
    {
      type: z.any().optional().nullable().describe('Tipo de armamento primário (plasma, laser, vulcan_spread)'),
      fire_rate: z
        .any()
        .optional()
        .nullable()
        .describe(
          `Cadência de tiro em disparos por segundo (${BALANCE.ranges['weapons.primary.fire_rate'].min} a ${BALANCE.ranges['weapons.primary.fire_rate'].max})`
        ),
      damage_multiplier: z.any().optional().nullable().describe('Multiplicador de dano baseado no slider de ataque')
    },
    async (args) => {
      const result = computePrimaryCannon(args);

      logMcpToolExecution('weapons-arsenal', 'configure_primary_cannon', args, result);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    }
  );

  server.tool(
    'attach_secondary_ordnance',
    toolBlurb('weapons-arsenal', 'attach_secondary_ordnance'),
    {
      type: z.any().optional().nullable().describe('Tipo de arma secundária (homing_missiles, emp_burst, none)'),
      blast_radius: z
        .any()
        .optional()
        .nullable()
        .describe('Ignorado: o raio do EMP é fixo no motor do jogo (BALANCE.weapons.secondary.emp_radius_px)'),
      cooldown_seconds: z
        .any()
        .optional()
        .nullable()
        .describe(
          `Tempo de recarga em segundos (${BALANCE.ranges['weapons.secondary.cooldown_seconds'].min} a ${BALANCE.ranges['weapons.secondary.cooldown_seconds'].max})`
        )
    },
    async (args) => {
      const result = computeSecondaryOrdnance(args);

      logMcpToolExecution('weapons-arsenal', 'attach_secondary_ordnance', args, result);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    }
  );

  return server;
}

// Auto-run when executed directly
if (process.argv[1]?.endsWith('weapons-arsenal.js') || process.argv[1]?.endsWith('weapons-arsenal.ts')) {
  const server = createWeaponsArsenalServer();
  const transport = new StdioServerTransport();
  server.connect(transport).catch((err) => {
    console.error('Fatal error starting weapons-arsenal MCP:', err);
    process.exit(1);
  });
}
