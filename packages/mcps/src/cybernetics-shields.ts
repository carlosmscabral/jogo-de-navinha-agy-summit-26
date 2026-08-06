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
      tech_level: z.union([z.number(), z.string()]).optional().describe('Nível do slider de tecnologia/tech (10 a 50)'),
      shield_type: z.string().optional().describe('Tipo de escudo (plasma_bubble, hardlight_barrier, deflector_mesh)')
    },
    async (args) => {
      const techNum = Number(args.tech_level ?? 25);
      const shieldType = String(args.shield_type || 'deflector_mesh');

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
    'Configura módulos cibernéticos e computa sinergias ativadas entre componentes.',
    {
      synergy_candidate: z.string().optional().describe('Nome da sinergia candidata (ex: Glass Cannon, Titan Fortress, Ghost Interceptor, Balanced Ace)'),
      active_sliders: z.union([
        z.record(z.any()),
        z.number(),
        z.string()
      ]).optional().describe('Sliders de energia atuais ou valor de overclock'),
      offense: z.union([z.number(), z.string()]).optional().describe('Nível de ataque'),
      speed: z.union([z.number(), z.string()]).optional().describe('Nível de velocidade'),
      defense: z.union([z.number(), z.string()]).optional().describe('Nível de defesa'),
      tech: z.union([z.number(), z.string()]).optional().describe('Nível de tecnologia')
    },
    async (args) => {
      const synergyCandidate = String(args.synergy_candidate || 'Balanced Ace');

      let off = Number(args.offense ?? 25);
      let spd = Number(args.speed ?? 25);
      let def = Number(args.defense ?? 25);
      let tch = Number(args.tech ?? 25);

      if (typeof args.active_sliders === 'number') {
        off = args.active_sliders;
      } else if (typeof args.active_sliders === 'object' && args.active_sliders !== null) {
        off = Number((args.active_sliders as any).offense ?? off);
        spd = Number((args.active_sliders as any).speed ?? spd);
        def = Number((args.active_sliders as any).defense ?? def);
        tch = Number((args.active_sliders as any).tech ?? tch);
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
