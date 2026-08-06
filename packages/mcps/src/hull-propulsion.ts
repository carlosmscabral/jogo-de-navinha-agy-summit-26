import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { logMcpToolExecution } from './utils/audit-logger.js';

export function createHullPropulsionServer(): McpServer {
  const server = new McpServer({
    name: 'hull-propulsion',
    version: '1.0.0'
  });

  server.tool(
    'tune_thrusters',
    'Calibra os propulsores de voo da nave, velocidade máxima de deslocamento e raio da hitbox central.',
    {
      speed_level: z.union([z.number(), z.string()]).optional().describe('Nível do slider de velocidade (10 a 50)'),
      agility_factor: z.union([z.number(), z.string()]).optional().describe('Fator de agilidade na esquiva lateral')
    },
    async (args) => {
      const speed_level = Number(args.speed_level ?? 25);
      const agility_factor = Number(args.agility_factor ?? 1.0);

      // Map 10-50 to 180-380 px/s
      const speed_px_s = Math.round(180 + ((speed_level - 10) / 40) * 200);
      // Higher speed reduces hitbox radius from 16px down to 8px
      const hitbox_radius = Math.max(8, Math.min(16, Math.round(16 - ((speed_level - 10) / 40) * 8 * agility_factor)));

      const result = {
        speed_px_s,
        hitbox_radius,
        agility_factor,
        acceleration: Math.round(speed_px_s * 2.5)
      };

      logMcpToolExecution('hull-propulsion', 'tune_thrusters', args, result);

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
    'reinforce_plating',
    'Instala blindagem estrutural na fuselagem para absorção de dano físico.',
    {
      defense_level: z.union([z.number(), z.string()]).optional().describe('Nível do slider de defesa (10 a 50)'),
      armor_type: z.string().optional().describe('Tipo de blindagem (lightweight_alloy, titanium_mesh, nanite_composite)')
    },
    async (args) => {
      const defense_level = Number(args.defense_level ?? 25);
      const armor_type = String(args.armor_type || 'titanium_mesh');

      // Map 10-50 to 2-5 max HP
      let max_hp = 3;
      if (defense_level < 20) max_hp = 2;
      else if (defense_level >= 20 && defense_level < 35) max_hp = 3;
      else if (defense_level >= 35 && defense_level < 45) max_hp = 4;
      else max_hp = 5;

      const result = {
        max_hp,
        armor_type,
        collision_resistance: `${Math.round(defense_level * 1.8)}%`
      };

      logMcpToolExecution('hull-propulsion', 'reinforce_plating', args, result);

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
if (process.argv[1]?.endsWith('hull-propulsion.js') || process.argv[1]?.endsWith('hull-propulsion.ts')) {
  const server = createHullPropulsionServer();
  const transport = new StdioServerTransport();
  server.connect(transport).catch((err) => {
    console.error('Fatal error starting hull-propulsion MCP:', err);
    process.exit(1);
  });
}
