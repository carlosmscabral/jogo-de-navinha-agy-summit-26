import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { logMcpToolExecution } from './utils/audit-logger.js';

export function createCyberneticsShieldsServer(): McpServer {
  const server = new McpServer({
    name: 'cybernetics-shields',
    version: '1.0.0'
  });

  server.tool(
    'calibrate_energy_barrier',
    'Calibra o campo de força energético e a capacidade de escudos da nave.',
    {
      tech_level: z.number().min(10).max(50).describe('Nível do slider de tecnologia/tech (10 a 50)'),
      shield_type: z.enum(['plasma_bubble', 'hardlight_barrier', 'deflector_mesh']).describe('Tipo de escudo')
    },
    async ({ tech_level, shield_type }) => {
      let shield_capacity = 0;
      if (tech_level < 20) shield_capacity = 0;
      else if (tech_level >= 20 && tech_level < 35) shield_capacity = 1;
      else if (tech_level >= 35 && tech_level < 45) shield_capacity = 2;
      else shield_capacity = 3;

      const result = {
        shield_capacity,
        shield_type,
        absorb_efficiency: '100%',
        recharge_rate_s: 20
      };

      logMcpToolExecution('cybernetics-shields', 'calibrate_energy_barrier', { tech_level, shield_type }, result);

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
    'install_overclock_module',
    'Configura módulos cibernéticos e computa sinergias ativadas entre componentes.',
    {
      synergy_candidate: z.string().describe('Nome da sinergia candidata (ex: Glass Cannon, Titan Fortress, Ghost Interceptor, Balanced Ace)'),
      active_sliders: z.object({
        offense: z.number(),
        speed: z.number(),
        defense: z.number(),
        tech: z.number()
      })
    },
    async ({ synergy_candidate, active_sliders }) => {
      let isUnlocked = false;
      let multiplier = 1.0;

      if (synergy_candidate === 'Glass Cannon' && active_sliders.offense >= 40) {
        isUnlocked = true;
        multiplier = 1.3;
      } else if (synergy_candidate === 'Titan Fortress' && active_sliders.defense >= 40) {
        isUnlocked = true;
        multiplier = 1.25;
      } else if (synergy_candidate === 'Ghost Interceptor' && active_sliders.speed >= 40) {
        isUnlocked = true;
        multiplier = 1.2;
      } else if (
        synergy_candidate === 'Balanced Ace' &&
        active_sliders.offense >= 20 && active_sliders.offense <= 30 &&
        active_sliders.speed >= 20 && active_sliders.speed <= 30 &&
        active_sliders.defense >= 20 && active_sliders.defense <= 30
      ) {
        isUnlocked = true;
        multiplier = 1.15;
      }

      const result = {
        synergy_name: synergy_candidate,
        status: isUnlocked ? 'UNLOCKED' : 'LOCKED',
        modifier_applied: isUnlocked ? `+${Math.round((multiplier - 1) * 100)}%` : 'none',
        bonus_score_pts: isUnlocked ? 1500 : 0
      };

      logMcpToolExecution('cybernetics-shields', 'install_overclock_module', { synergy_candidate, active_sliders }, result);

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
if (process.argv[1]?.endsWith('cybernetics-shields.js') || process.argv[1]?.endsWith('cybernetics-shields.ts')) {
  const server = createCyberneticsShieldsServer();
  const transport = new StdioServerTransport();
  server.connect(transport).catch((err) => {
    console.error('Fatal error starting cybernetics-shields MCP:', err);
    process.exit(1);
  });
}
