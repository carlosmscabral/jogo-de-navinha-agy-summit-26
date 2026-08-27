import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { logMcpToolExecution } from './utils/audit-logger.js';
import { MCP_CATALOG, type McpServerName } from '@jogo/shared';

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

export function createCyberneticsShieldsServer(): McpServer {
  const server = new McpServer({
    name: 'cybernetics-shields',
    version: '1.0.0'
  });

  server.tool(
    'calibrate_energy_barrier',
    toolBlurb('cybernetics-shields', 'calibrate_energy_barrier'),
    {
      tech_level: z.any().optional().nullable().describe('Nível do slider de tecnologia/tech (10 a 50)'),
      shield_type: z.any().optional().nullable().describe('Tipo de escudo (plasma_bubble, hardlight_barrier, deflector_mesh)')
    },
    async (args) => {
      const techNum = typeof args?.tech_level === 'number' ? args.tech_level : Number(args?.tech_level) || 25;
      const shieldType = args?.shield_type ? String(args.shield_type) : 'deflector_mesh';

      let shield_capacity = 0;
      if (techNum < 20) shield_capacity = 0;
      else if (techNum >= 20 && techNum < 35) shield_capacity = 1;
      else if (techNum >= 35 && techNum < 45) shield_capacity = 2;
      else shield_capacity = 3;

      const result = {
        shield_capacity,
        shield_type: shieldType,
        absorb_efficiency: '100%',
        recharge_rate_s: 20
      };

      logMcpToolExecution('cybernetics-shields', 'calibrate_energy_barrier', args, result);

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
    toolBlurb('cybernetics-shields', 'install_overclock_module'),
    {
      synergy_candidate: z.any().optional().nullable().describe('Nome da sinergia candidata (ex: Glass Cannon, Titan Fortress, Ghost Interceptor, Balanced Ace)'),
      active_sliders: z.any().optional().nullable().describe('Sliders de energia atuais ou valor de overclock'),
      offense: z.any().optional().nullable().describe('Nível de ataque'),
      speed: z.any().optional().nullable().describe('Nível de velocidade'),
      defense: z.any().optional().nullable().describe('Nível de defesa'),
      tech: z.any().optional().nullable().describe('Nível de tecnologia')
    },
    async (args) => {
      const synergyCandidate = args?.synergy_candidate ? String(args.synergy_candidate) : 'Balanced Ace';

      let off = Number(args?.offense) || 25;
      let spd = Number(args?.speed) || 25;
      let def = Number(args?.defense) || 25;
      let tch = Number(args?.tech) || 25;

      if (typeof args?.active_sliders === 'number') {
        off = args.active_sliders;
      } else if (typeof args?.active_sliders === 'object' && args?.active_sliders !== null) {
        off = Number(args.active_sliders.offense) || off;
        spd = Number(args.active_sliders.speed) || spd;
        def = Number(args.active_sliders.defense) || def;
        tch = Number(args.active_sliders.tech) || tch;
      }

      let isUnlocked = false;
      let multiplier = 1.0;

      if (synergyCandidate.toLowerCase().includes('glass') && off >= 35) {
        isUnlocked = true;
        multiplier = 1.3;
      } else if (synergyCandidate.toLowerCase().includes('titan') && def >= 35) {
        isUnlocked = true;
        multiplier = 1.25;
      } else if (synergyCandidate.toLowerCase().includes('ghost') && spd >= 35) {
        isUnlocked = true;
        multiplier = 1.2;
      } else {
        // Balanced or default synergy unlock
        isUnlocked = true;
        multiplier = 1.15;
      }

      const result = {
        synergy_name: synergyCandidate,
        status: isUnlocked ? 'UNLOCKED' : 'LOCKED',
        modifier_applied: isUnlocked ? `+${Math.round((multiplier - 1) * 100)}%` : 'none',
        bonus_score_pts: isUnlocked ? 1500 : 0
      };

      logMcpToolExecution('cybernetics-shields', 'install_overclock_module', args, result);

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
