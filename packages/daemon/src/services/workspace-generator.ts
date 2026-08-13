import * as fs from 'node:fs';
import * as path from 'node:path';
import { BALANCE, EnergySliders, McpServerName, SubagentName } from '@jogo/shared';

/**
 * Renderiza a faixa numérica de `key` (fonte única: `BALANCE.ranges`, ver
 * Tarefa B1/B2 -- D14) no formato usado pela tabela de contrato do GEMINI.md,
 * para que o prompt nunca anuncie ao agente uma faixa diferente da que o
 * schema realmente aceita.
 */
function rangeRow(key: keyof typeof BALANCE.ranges): string {
  const r = BALANCE.ranges[key];
  return r.integer ? `inteiro de ${r.min} a ${r.max}` : `${r.min} a ${r.max}`;
}

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

    // 5. Initialize empty mcp_audit.log
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
---
Você é o Projetista Visual da nave espacial.
Gere exclusivamente elementos vetoriais SVG (viewBox 0 0 128 128) com estética anos 80 Synthwave, Dark Void ou Cyberpunk Gold.
O \`svg_path_data\` deve conter APENAS o valor do atributo \`d\` de um \`<path>\`: comandos M/L/C/Q/Z (maiúsculos ou
minúsculos) e números, nada além disso — nunca a tag \`<svg>\` em si, nenhum atributo (\`fill\`, \`stroke\`, \`id\` etc.)
e nenhuma referência \`url()\`.
O tema escolhido (Synthwave 80s, Dark Void Stealth ou Cyberpunk Gold) governa a estrutura geral do SVG,
a composição e a identidade estilística — isso não muda.

Personalização de cor (opcional): se o piloto mencionar uma cor de destaque da lista curada (Rosa
Choque, Ciano Elétrico, Verde Ácido, Vermelho Sangue, Dourado Royal ou Branco Gélido), adapte
\`primary_color\`, \`secondary_color\` e \`engine_trail_color\` em direção a essa cor, mantendo intacta a
identidade estrutural/geométrica do tema escolhido — por exemplo, uma nave "Dark Void Stealth" com
destaque "Rosa Choque" continua estruturalmente uma nave Dark Void Stealth (base escura, painéis
angulares stealth etc.), apenas recolorida em tons de rosa/magenta em vez da paleta padrão
roxo/violeta desse tema. Se nenhuma cor de destaque for mencionada, ou se a cor citada não estiver na
lista curada, use a paleta padrão/característica do tema exatamente como hoje — esta é uma refinação
opcional, não uma escolha obrigatória.
`;
    fs.writeFileSync(path.join(agentsDir, 'aesthetic-designer.md'), aestheticContent, 'utf8');

    // 2. Conditionally add Combat Strategist
    if (selectedSubagents.includes('combat-strategist')) {
      const combatContent = `---
name: combat-strategist
description: Estrategista tático focado em calibrar sistemas de canhões primários, armas secundárias e cálculo de DPS.
---
Você é o Estrategista Tático de Armas.
A sessão principal (Orquestrador) já invocou as ferramentas do servidor MCP 'weapons-arsenal' e vai
te fornecer, no prompt de invocação, os valores exatos retornados (tipo de canhão, dano, cadência,
tipo de arma secundária, dano e cooldown). Sua tarefa é analisar esses valores JÁ OBTIDOS e produzir
uma avaliação tática breve (1 a 2 frases, em português) sobre o perfil de combate resultante, para
exibição no terminal. Você NÃO deve invocar nenhuma ferramenta MCP por conta própria — os valores já
foram obtidos pelo Orquestrador.
`;
      fs.writeFileSync(path.join(agentsDir, 'combat-strategist.md'), combatContent, 'utf8');
    }

    // 3. Conditionally add Systems Engineer
    if (selectedSubagents.includes('systems-engineer')) {
      const systemsContent = `---
name: systems-engineer
description: Engenheiro de propulsão, blindagem estrutural e matrizes de escudos energéticos.
---
Você é o Engenheiro de Sistemas e Blindagem.
A sessão principal (Orquestrador) já invocou as ferramentas dos servidores MCP 'hull-propulsion' e
'cybernetics-shields' e vai te fornecer, no prompt de invocação, os valores exatos retornados
(velocidade, HP, raio de colisão, capacidade de escudo, sinergias desbloqueadas). Sua tarefa é
analisar esses valores JÁ OBTIDOS e produzir uma avaliação técnica breve (1 a 2 frases, em português)
sobre a configuração estrutural resultante, para exibição no terminal. Você NÃO deve invocar nenhuma
ferramenta MCP por conta própria — os valores já foram obtidos pelo Orquestrador.
`;
      fs.writeFileSync(path.join(agentsDir, 'systems-engineer.md'), systemsContent, 'utf8');
    }
  }

  private static generateGeminiInstructions(sessionDir: string, config: SessionWorkspaceConfig): void {
    const { pilot, energy_sliders, selected_mcps, selected_subagents } = config;
    const activeSubagents = ['aesthetic-designer', ...selected_subagents];

    // Build contract table rows dynamically based on selected MCPs
    const contractRows = [
      '| `pilot.callsign`, `pilot.company_raw`, `pilot.company_canonical` | Dados do piloto acima — NUNCA um campo único `pilot.company` | — |',
      `| \`build_metadata.selected_mcps\` | Exatamente: ${JSON.stringify(selected_mcps)} | — |`,
      `| \`build_metadata.selected_subagents\` | Exatamente: ${JSON.stringify(activeSubagents)} | — |`,
      '| `build_metadata.energy_sliders` | Objeto com EXATAMENTE as chaves `offense`, `speed`, `defense`, `tech` (não `attack`) | soma = 100 |',
      '| `build_metadata.fast_grill_me_choices` | EXATAMENTE `{ weapon_focus, visual_theme }` (ver PASSO 1 para os slugs) — NUNCA inclui `accent_color` | — |'
    ];

    // Conditionally add rows based on selected MCPs
    if (selected_mcps.includes('cybernetics-shields')) {
      contractRows.push('| `build_metadata.synergies_unlocked` | Retorno de `cybernetics-shields` | — |');
      contractRows.push(`| \`attributes.shield_capacity\` | Retorno de \`cybernetics-shields\` | ${rangeRow('attributes.shield_capacity')} |`);
    }
    if (selected_mcps.includes('hull-propulsion')) {
      contractRows.push(`| \`attributes.max_hp\` | Retorno de \`hull-propulsion\` | ${rangeRow('attributes.max_hp')} |`);
      contractRows.push(`| \`attributes.speed_px_s\` | Retorno de \`hull-propulsion\` | ${rangeRow('attributes.speed_px_s')} |`);
      contractRows.push(`| \`attributes.hitbox_radius\` | Retorno de \`hull-propulsion\` | ${rangeRow('attributes.hitbox_radius')} |`);
    }
    if (selected_mcps.includes('weapons-arsenal')) {
      contractRows.push('| `weapons.primary.type` | Retorno de `weapons-arsenal` | laser, plasma ou vulcan_spread |');
      contractRows.push(`| \`weapons.primary.damage\` | Retorno de \`weapons-arsenal\` | ${rangeRow('weapons.primary.damage')} |`);
      contractRows.push(`| \`weapons.primary.fire_rate\` | Retorno de \`weapons-arsenal\` | ${rangeRow('weapons.primary.fire_rate')} |`);
      contractRows.push(`| \`weapons.primary.bullet_speed\` | Retorno de \`weapons-arsenal\` | ${rangeRow('weapons.primary.bullet_speed')} |`);
      contractRows.push(`| \`weapons.primary.spread_angle\` | Retorno de \`weapons-arsenal\` | ${rangeRow('weapons.primary.spread_angle')} |`);
      contractRows.push('| `weapons.secondary.type` | Retorno de `weapons-arsenal` | homing_missiles ou emp_burst |');
      contractRows.push(`| \`weapons.secondary.damage\` | Retorno de \`weapons-arsenal\` | ${rangeRow('weapons.secondary.damage')} |`);
      contractRows.push(`| \`weapons.secondary.cooldown_seconds\` | Retorno de \`weapons-arsenal\` | ${rangeRow('weapons.secondary.cooldown_seconds')} |`);
    }

    // Visuals are always included (aesthetic-designer is always active)
    contractRows.push('| `visuals.style_name` | `aesthetic-designer` | texto curto |');
    contractRows.push('| `visuals.primary_color`, `secondary_color`, `engine_trail_color` | `aesthetic-designer` (tema + cor de destaque opcional) | hex `#rrggbb` |');
    contractRows.push('| `visuals.svg_path_data` | `aesthetic-designer` | Path SVG em viewBox `0 0 128 128`, nariz apontando para cima (y menor), apenas comandos M/L/C/Q/Z e números. Sem `<svg>`, sem atributos, sem `url()`. |');

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
- Callsign: "${pilot.callsign}" → grave em \`pilot.callsign\`
- Empresa: "${pilot.company_canonical}" → grave em **DOIS** campos separados: \`pilot.company_raw\` E \`pilot.company_canonical\` (ambos com este mesmo valor). NUNCA grave um único campo \`pilot.company\` — esse nome não existe no schema.

### ALOCAÇÃO DE ENERGIA (Total 100 PU):
- Ataque: ${energy_sliders.offense} PU → grave em \`build_metadata.energy_sliders.offense\` (NUNCA \`attack\`)
- Velocidade: ${energy_sliders.speed} PU → grave em \`build_metadata.energy_sliders.speed\`
- Defesa: ${energy_sliders.defense} PU → grave em \`build_metadata.energy_sliders.defense\`
- Tecnologia: ${energy_sliders.tech} PU → grave em \`build_metadata.energy_sliders.tech\`

### SERVIDORES MCP ATIVOS: ${selected_mcps.join(', ')}
### SUB-AGENTES ATIVOS: ${activeSubagents.join(', ')}

Estes são os únicos MCPs e sub-agentes disponíveis nesta sessão. Não referencie nenhum outro.

Campos do \`ship_spec.json\` que pertencem a um MCP **fora** da lista acima (ex.: \`weapons.*\` se
\`weapons-arsenal\` não estiver listado, \`attributes.max_hp\`/\`speed_px_s\`/\`hitbox_radius\` se
\`hull-propulsion\` não estiver listado, ou \`attributes.shield_capacity\` se
\`cybernetics-shields\` não estiver listado) **NÃO fazem parte desta sessão — simplesmente
OMITA-os do arquivo final.** O jogo preenche esses campos automaticamente a partir da alocação de
energia do piloto. Isso NÃO é uma violação da REGRA ZERO: você só é proibido de inventar valores
para os MCPs que ESTÃO ativos.

### PROTOCOLO RÍGIDO DE 5 PASSOS:
1. **PASSO 1 - FAST GRILL-ME:** Pergunte ao piloto em 1 turno (ou leia seu prompt inicial):
   - [1] Foco de Armas: 1-Laser Perfurante, 2-Chuva de Mísseis, 3-Vulcan Espalhado
   - [2] Estilo Estético: 1-Synthwave 80s, 2-Dark Void Stealth, 3-Cyberpunk Gold
       (Opcional: cite uma cor de destaque entre Rosa Choque, Ciano Elétrico, Verde Ácido,
       Vermelho Sangue, Dourado Royal ou Branco Gélido — o Projetista Visual vai aplicá-la
       dentro do estilo escolhido, sem abandonar sua identidade estrutural.)

   Grave as respostas em \`build_metadata.fast_grill_me_choices\` com EXATAMENTE estas duas chaves,
   usando estes slugs em inglês (nunca o texto em português, nunca outro nome de campo):

   \`weapon_focus\` (grave exatamente uma destas strings):
     1-Laser Perfurante   → "laser_piercing"
     2-Chuva de Mísseis   → "missile_barrage"
     3-Vulcan Espalhado   → "vulcan_spread"

   \`visual_theme\` (grave exatamente uma destas strings — o nome do campo é \`visual_theme\`,
   NUNCA \`aesthetic_style\` ou qualquer outro nome):
     1-Synthwave 80s      → "synthwave_80s"
     2-Dark Void Stealth  → "dark_void_stealth"
     3-Cyberpunk Gold     → "cyberpunk_gold"

   A cor de destaque (se citada) **NÃO** entra em \`fast_grill_me_choices\` — esse objeto aceita
   apenas \`weapon_focus\` e \`visual_theme\`, mais nenhuma chave (\`accent_color\` incluído). A cor de
   destaque só deve influenciar \`visuals.primary_color\`, \`visuals.secondary_color\` e
   \`visuals.engine_trail_color\`, através do sub-agente \`aesthetic-designer\`.
2. **PASSO 2 - EXECUÇÃO DIRETA DAS FERRAMENTAS MCP:** Você mesmo (a sessão principal) DEVE invocar
   diretamente as ferramentas de cada servidor MCP ativo — não delegue esta etapa a nenhum
   sub-agente. O jogo verifica \`mcp_audit.log\` antes de aceitar a nave: **sem registro de execução,
   a nave é rejeitada.**
3. **PASSO 3 - NARRATIVA DOS ESPECIALISTAS:** Com os valores já obtidos no Passo 2 em mãos, invoque
   os sub-agentes em \`.agents/agents/\` via \`invoke_subagent\` (opção de workspace \`inherit\`),
   incluindo no prompt inicial de cada um os valores exatos que você obteve. Cada sub-agente deve
   produzir uma breve análise (1 a 2 frases) sobre o resultado, para exibição no terminal — eles NÃO
   devem invocar nenhuma ferramenta MCP por conta própria.
4. **PASSO 4 - CRIAÇÃO DO ARQUIVO:** Use sua ferramenta de escrita para gravar
   \`${sessionDir}/ship_spec.json\` com os valores que as ferramentas retornaram.
5. **VERIFIQUE A ACEITAÇÃO.** Depois de gravar o \`ship_spec.json\`, aguarde 2 segundos e verifique se
   o arquivo \`spec_errors.txt\` existe neste diretório. Se existir, leia-o, corrija exatamente os
   campos citados, apague o \`spec_errors.txt\` e reescreva o \`ship_spec.json\`. Repita até que ele não
   reapareça.

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
