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
      type: z.enum(['plasma', 'laser', 'vulcan_spread']).describe('Tipo de armamento primário'),
      fire_rate: z.number().min(2).max(60).describe('Cadência de tiro em disparos por segundo'),
      damage_multiplier: z.number().min(0.5).max(2.0).describe('Multiplicador de dano baseado no slider de ataque')
    },
    async ({ type, fire_rate, damage_multiplier }) => {
      let baseDamage = 35;
      let bulletSpeed = 650;
      let spreadAngle = 0;

      if (type === 'laser') {
        baseDamage = 12; // Continuous raycast per tick
        bulletSpeed = 750;
        spreadAngle = 0;
      } else if (type === 'vulcan_spread') {
        baseDamage = 15;
        bulletSpeed = 600;
        spreadAngle = 15;
      } else if (type === 'plasma') {
        baseDamage = 35;
        bulletSpeed = 650;
        spreadAngle = 0;
      }

      const finalDamage = Math.round(baseDamage * damage_multiplier);
      const result = {
        type,
        damage: finalDamage,
        fire_rate,
        bullet_speed: bulletSpeed,
        spread_angle: spreadAngle,
        dps_estimate: Math.round(finalDamage * fire_rate)
      };

      logMcpToolExecution('weapons-arsenal', 'configure_primary_cannon', { type, fire_rate, damage_multiplier }, result);

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
      type: z.enum(['homing_missiles', 'emp_burst', 'drone_escort', 'none']).describe('Tipo de arma secundária'),
      blast_radius: z.number().min(0).max(100).describe('Raio de explosão em pixels'),
      cooldown_seconds: z.number().min(0).max(20).describe('Tempo de recarga em segundos')
    },
    async ({ type, blast_radius, cooldown_seconds }) => {
      let damage = 0;
      if (type === 'homing_missiles') damage = 120;
      else if (type === 'emp_burst') damage = 60;
      else if (type === 'drone_escort') damage = 15;

      const result = {
        type,
        damage,
        blast_radius,
        cooldown_seconds,
        status: 'ARMED'
      };

      logMcpToolExecution('weapons-arsenal', 'attach_secondary_ordnance', { type, blast_radius, cooldown_seconds }, result);

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
