import * as fs from 'node:fs';
import * as path from 'node:path';
import { EnergySliders, McpServerName, SubagentName } from '@jogo/shared';

export interface SessionWorkspaceConfig {
  sessionDir?: string;
  pilot: {
    callsign: string;
    company_raw: string;
    company_canonical: string;
  };
  energy_sliders: EnergySliders;
  selected_mcps: McpServerName[];
  selected_subagents: SubagentName[];
  mcpsDistDir: string; // absolute path to packages/mcps/dist
}

export class WorkspaceGeneratorService {
  static generateWorkspace(config: SessionWorkspaceConfig): string {
    const sessionDir = config.sessionDir || '/tmp/booth_session';

    // 1. Purge & Recreate session workspace
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
    fs.mkdirSync(path.join(sessionDir, '.agents', 'agents'), { recursive: true });

    // 2. Generate .agents/mcp_config.json
    this.generateMcpConfig(sessionDir, config.selected_mcps, config.mcpsDistDir);

    // 3. Generate .agents/agents/*.md (Dynamic selection)
    this.generateSubagents(sessionDir, config.selected_subagents);

    // 4. Generate GEMINI.md / AGENTS.md orchestrator instructions
    this.generateGeminiInstructions(sessionDir, config);

    // 5. Generate run_agy.sh helper script
    const runScript = `#!/bin/bash
echo "================================================================="
echo "  🚀 INICIANDO ANTIGRAVITY CLI PARA FORJA ESPACIAL (AGY 2026)   "
echo "================================================================="
echo "Piloto: ${config.pilot.callsign} | Empresa: ${config.pilot.company_canonical}"
echo ""
agy
`;
    fs.writeFileSync(path.join(sessionDir, 'run_agy.sh'), runScript, { mode: 0o755, encoding: 'utf8' });

    // 6. Initialize empty mcp_audit.log
    fs.writeFileSync(path.join(sessionDir, 'mcp_audit.log'), '', 'utf8');

    return sessionDir;
  }

  private static generateMcpConfig(sessionDir: string, selectedMcps: McpServerName[], mcpsDistDir: string): void {
    const mcpServers: Record<string, { command: string; args: string[] }> = {};

    for (const mcp of selectedMcps) {
      const scriptPath = path.join(mcpsDistDir, `${mcp}.js`);
      mcpServers[mcp] = {
        command: 'node',
        args: [scriptPath]
      };
    }

    const configContent = {
      mcpServers
    };

    fs.writeFileSync(
      path.join(sessionDir, '.agents', 'mcp_config.json'),
      JSON.stringify(configContent, null, 2),
      'utf8'
    );
  }

  private static generateSubagents(sessionDir: string, selectedSubagents: SubagentName[]): void {
    const agentsDir = path.join(sessionDir, '.agents', 'agents');

    // 1. Aesthetic Designer is ALWAYS included (SVG fuselage generator)
    const aestheticContent = `---
name: aesthetic-designer
description: Especialista em design aeroespacial, arte vetorial SVG e temas visuais retro-futuristas.
kind: local
enable_mcp_tools: false
enable_write_tools: true
---
Você é o Projetista Visual da nave espacial.
Gere exclusivamente elementos vetoriais SVG (viewBox 0 0 128 128) com estética anos 80 Synthwave, Dark Void ou Cyberpunk Gold.
`;
    fs.writeFileSync(path.join(agentsDir, 'aesthetic-designer.md'), aestheticContent, 'utf8');

    // 2. Conditionally add Combat Strategist
    if (selectedSubagents.includes('combat-strategist')) {
      const combatContent = `---
name: combat-strategist
description: Estrategista tático focado em calibrar sistemas de canhões primários, armas secundárias e cálculo de DPS.
kind: local
enable_mcp_tools: true
enable_write_tools: true
---
Você é o Estrategista Tático de Armas.
Você DEVE invocar as ferramentas do servidor MCP 'weapons-arsenal' (configure_primary_cannon e attach_secondary_ordnance) para computar os dados reais de dano e cadência.
`;
      fs.writeFileSync(path.join(agentsDir, 'combat-strategist.md'), combatContent, 'utf8');
    }

    // 3. Conditionally add Systems Engineer
    if (selectedSubagents.includes('systems-engineer')) {
      const systemsContent = `---
name: systems-engineer
description: Engenheiro de propulsão, blindagem estrutural e matrizes de escudos energéticos.
kind: local
enable_mcp_tools: true
enable_write_tools: true
---
Você é o Engenheiro de Sistemas e Blindagem.
Você DEVE invocar as ferramentas dos servidores MCP 'hull-propulsion' e 'cybernetics-shields' para computar os atributos de velocidade, HP, escudos e sinergias.
`;
      fs.writeFileSync(path.join(agentsDir, 'systems-engineer.md'), systemsContent, 'utf8');
    }
  }

  private static generateGeminiInstructions(sessionDir: string, config: SessionWorkspaceConfig): void {
    const { pilot, energy_sliders, selected_mcps, selected_subagents } = config;

    const geminiContent = `# PROTOCOLO DE CONSTRUÇÃO DE NAVE: FORJA ESPACIAL AGY

Você é o Orquestrador Chefe da Forja no Antigravity CLI para o evento Google Cloud Summit 2026.

### DADOS DO PILOTO:
- Callsign: "${pilot.callsign}"
- Empresa: "${pilot.company_canonical}" (Raw: "${pilot.company_raw}")

### ALOCAÇÃO DE ENERGIA (Total 100 PU):
- Ataque: ${energy_sliders.offense} PU
- Velocidade: ${energy_sliders.speed} PU
- Defesa: ${energy_sliders.defense} PU
- Tecnologia: ${energy_sliders.tech} PU

### SERVIDORES MCP ATIVOS: ${selected_mcps.join(', ')}
### SUB-AGENTES ATIVOS: ${['aesthetic-designer', ...selected_subagents].join(', ')}

### PROTOCOLO RÍGIDO DE 4 PASSOS:
1. **PASSO 1 - FAST GRILL-ME:** Pergunte ao piloto de imediato em 1 turno:
   - [1] Foco de Armas: 1-Laser Perfurante, 2-Chuva de Mísseis, 3-Vulcan Espalhado
   - [2] Estilo Estético: 1-Synthwave 80s, 2-Dark Void Stealth, 3-Cyberpunk Gold
2. **PASSO 2 - DELEGAÇÃO:** Invoque os sub-agentes em \`.agents/agents/\` para forjar a nave.
3. **PASSO 3 - EXECUÇÃO DE TOOLS:** Os sub-agentes DEVEM executar as ferramentas dos MCPs ativos.
4. **PASSO 4 - EMISSÃO DO JSON:** Grave o arquivo \`ship_spec.json\` na raiz do workspace obedecendo estritamente ao JSON Schema Draft-07.
`;

    fs.writeFileSync(path.join(sessionDir, 'GEMINI.md'), geminiContent, 'utf8');
    fs.writeFileSync(path.join(sessionDir, 'AGENTS.md'), geminiContent, 'utf8');
  }
}
