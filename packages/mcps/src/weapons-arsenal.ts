import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { logMcpToolExecution } from './utils/audit-logger.js';

export function createWeaponsArsenalServer(): McpServer {
  const server = new McpServer({
    name: 'weapons-arsenal',
    version: '1.0.0'
  });

  server.tool(
    'configure_primary_cannon',
    'Configura o canhão primário da nave calculando dano, cadência de tiro e velocidade dos projéteis.',
    {
      type: z.any().optional().nullable().describe('Tipo de armamento primário (plasma, laser, vulcan_spread)'),
      fire_rate: z.any().optional().nullable().describe('Cadência de tiro em disparos por segundo'),
      damage_multiplier: z.any().optional().nullable().describe('Multiplicador de dano baseado no slider de ataque')
    },
    async (args) => {
      const type = String(args?.type || 'plasma').toLowerCase();
      const fire_rate = Number(args?.fire_rate) || 8;
      const damage_multiplier = Number(args?.damage_multiplier) || 1.0;

      let baseDamage = 35;
      let bulletSpeed = 650;
      let spreadAngle = 0;

      if (type.includes('laser')) {
        baseDamage = 25;
        bulletSpeed = 750;
        spreadAngle = 0;
      } else if (type.includes('vulcan') || type.includes('spread')) {
        baseDamage = 20;
        bulletSpeed = 600;
        spreadAngle = 15;
      } else {
        baseDamage = 35;
        bulletSpeed = 650;
        spreadAngle = 0;
      }

      const finalDamage = Math.round(baseDamage * damage_multiplier);
      const result = {
        type: type.includes('laser') ? 'laser' : type.includes('vulcan') ? 'vulcan_spread' : 'plasma',
        damage: finalDamage,
        fire_rate,
        bullet_speed: bulletSpeed,
        spread_angle: spreadAngle,
        dps_estimate: Math.round(finalDamage * fire_rate)
      };

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
    'Instala e calibra o sistema de armas secundárias ativado pela tecla Shift.',
    {
      type: z.any().optional().nullable().describe('Tipo de arma secundária (homing_missiles, emp_burst, drone_escort, none)'),
      blast_radius: z.any().optional().nullable().describe('Raio de explosão em pixels'),
      cooldown_seconds: z.any().optional().nullable().describe('Tempo de recarga em segundos')
    },
    async (args) => {
      const rawType = String(args?.type || 'homing_missiles').toLowerCase();
      const blast_radius = Number(args?.blast_radius) || 80;
      const cooldown_seconds = Number(args?.cooldown_seconds) || 2;

      let damage = 0;
      let type: 'homing_missiles' | 'emp_burst' | 'drone_escort' | 'none' = 'homing_missiles';

      if (rawType.includes('emp')) {
        type = 'emp_burst';
        damage = 60;
      } else if (rawType.includes('drone')) {
        type = 'drone_escort';
        damage = 30;
      } else if (rawType.includes('none')) {
        type = 'none';
        damage = 0;
      } else {
        type = 'homing_missiles';
        damage = 100;
      }

      const result = {
        type,
        damage,
        blast_radius,
        cooldown_seconds,
        status: 'ARMED'
      };

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
