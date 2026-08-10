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

    // 1. Clean contents inside sessionDir WITHOUT deleting the root directory inode (prevents uv_cwd ENOENT in open terminals)
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    } else {
      try {
        const entries = fs.readdirSync(sessionDir);
        for (const entry of entries) {
          fs.rmSync(path.join(sessionDir, entry), { recursive: true, force: true });
        }
      } catch (err) {
        console.warn('[WorkspaceGenerator] Warning cleaning existing session files:', err);
      }
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
    const activeSubagents = ['aesthetic-designer', ...selected_subagents];

    // Build contract table rows dynamically based on selected MCPs
    const contractRows = [
      '| `pilot.*` | Dados do piloto acima, copiados literalmente | — |',
      `| \`build_metadata.selected_mcps\` | Exatamente: ${JSON.stringify(selected_mcps)} | — |`,
      `| \`build_metadata.selected_subagents\` | Exatamente: ${JSON.stringify(activeSubagents)} | — |`,
      '| `build_metadata.energy_sliders` | Alocação de energia acima, copiada literalmente | soma = 100 |',
      '| `build_metadata.fast_grill_me_choices` | Respostas do piloto no PASSO 1 | — |'
    ];

    // Conditionally add rows based on selected MCPs
    if (selected_mcps.includes('cybernetics-shields')) {
      contractRows.push('| `build_metadata.synergies_unlocked` | Retorno de `cybernetics-shields` | — |');
      contractRows.push('| `attributes.shield_capacity` | Retorno de `cybernetics-shields` | inteiro de 0 a 3 |');
    }
    if (selected_mcps.includes('hull-propulsion')) {
      contractRows.push('| `attributes.max_hp` | Retorno de `hull-propulsion` | inteiro de 2 a 5 |');
      contractRows.push('| `attributes.speed_px_s` | Retorno de `hull-propulsion` | 180 a 380 |');
      contractRows.push('| `attributes.hitbox_radius` | Retorno de `hull-propulsion` | 8 a 16 |');
    }
    if (selected_mcps.includes('weapons-arsenal')) {
      contractRows.push('| `weapons.primary.type` | Retorno de `weapons-arsenal` | laser, plasma ou vulcan_spread |');
      contractRows.push('| `weapons.primary.damage` | Retorno de `weapons-arsenal` | 15 a 45 |');
      contractRows.push('| `weapons.primary.fire_rate` | Retorno de `weapons-arsenal` | 5 a 12 |');
      contractRows.push('| `weapons.secondary.type` | Retorno de `weapons-arsenal` | homing_missiles ou emp_burst |');
      contractRows.push('| `weapons.secondary.damage` | Retorno de `weapons-arsenal` | 60 a 150 |');
      contractRows.push('| `weapons.secondary.cooldown_seconds` | Retorno de `weapons-arsenal` | 3 a 12 |');
    }

    // Visuals are always included (aesthetic-designer is always active)
    contractRows.push('| `visuals.style_name` | `aesthetic-designer` | texto curto |');
    contractRows.push('| `visuals.primary_color`, `secondary_color`, `engine_trail_color` | `aesthetic-designer` | hex `#rrggbb` |');
    contractRows.push('| `visuals.svg_path_data` | `aesthetic-designer` | viewBox 0 0 128 128 |');

    const contractTable = contractRows.join('\n');

    const geminiContent = `# PROTOCOLO DE CONSTRUÇÃO DE NAVE: FORJA ESPACIAL AGY

Você é o Orquestrador Chefe da Forja no Antigravity CLI para o evento Google Cloud Summit 2026.

## REGRA ZERO — PROIBIDO INVENTAR VALORES

Você **NÃO** tem permissão para gerar parâmetros numéricos, nomes de sinergia ou dados SVG por conta
própria. Todo número em \`ship_spec.json\` deve vir do retorno de uma ferramenta MCP, e todo dado
visual deve vir do sub-agente \`aesthetic-designer\`. Se uma ferramenta falhar, **relate a falha** e
pare — não preencha o campo com uma estimativa. Um arquivo com valores inventados é uma falha da
demonstração, não um sucesso parcial.

### DADOS DO PILOTO:
- Callsign: "${pilot.callsign}"
- Empresa: "${pilot.company_canonical}" (Raw: "${pilot.company_raw}")

### ALOCAÇÃO DE ENERGIA (Total 100 PU):
- Ataque: ${energy_sliders.offense} PU
- Velocidade: ${energy_sliders.speed} PU
- Defesa: ${energy_sliders.defense} PU
- Tecnologia: ${energy_sliders.tech} PU

### SERVIDORES MCP ATIVOS: ${selected_mcps.join(', ')}
### SUB-AGENTES ATIVOS: ${activeSubagents.join(', ')}

Estes são os únicos MCPs e sub-agentes disponíveis nesta sessão. Não referencie nenhum outro.

### PROTOCOLO RÍGIDO DE 4 PASSOS:
1. **PASSO 1 - FAST GRILL-ME:** Pergunte ao piloto em 1 turno (ou leia seu prompt inicial):
   - [1] Foco de Armas: 1-Laser Perfurante, 2-Chuva de Mísseis, 3-Vulcan Espalhado
   - [2] Estilo Estético: 1-Synthwave 80s, 2-Dark Void Stealth, 3-Cyberpunk Gold
2. **PASSO 2 - DELEGAÇÃO:** Invoque os sub-agentes em \`.agents/agents/\` para forjar a nave.
3. **PASSO 3 - EXECUÇÃO DE TOOLS:** Os sub-agentes DEVEM executar as ferramentas dos MCPs ativos. O
   jogo verifica \`mcp_audit.log\` antes de aceitar a nave: **sem registro de execução, a nave é
   rejeitada.**
4. **PASSO 4 - CRIAÇÃO DO ARQUIVO:** Use sua ferramenta de escrita para gravar
   \`${sessionDir}/ship_spec.json\` com os valores que as ferramentas retornaram.

### CONTRATO DO \`ship_spec.json\` (estrutura, não valores):

| Campo | Origem obrigatória | Faixa aceita |
| :--- | :--- | :--- |
${contractTable}

Valores fora das faixas acima fazem o arquivo ser rejeitado pelo validador do jogo.
`;

    fs.writeFileSync(path.join(sessionDir, 'GEMINI.md'), geminiContent, 'utf8');
    fs.writeFileSync(path.join(sessionDir, 'AGENTS.md'), geminiContent, 'utf8');
  }
}
