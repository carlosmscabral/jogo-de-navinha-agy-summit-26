import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ACCENT_COLOR_ORDER,
  ACCENT_COLORS,
  BALANCE,
  BOOTH_KICKOFF_PROMPT,
  EnergySliders,
  FALLBACK_PRESETS,
  GRILL_ME_SECONDARY_ORDER,
  McpServerName,
  PRIMARY_WEAPON_LABELS,
  PRIMARY_WEAPON_ORDER,
  SECONDARY_WEAPON_LABELS,
  SecondaryWeaponType,
  SubagentName,
  VISUAL_THEME_ORDER,
  VISUAL_THEMES
} from '@jogo/shared';

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

/**
 * Compromisso de cada arma secundária, em uma frase. É o único texto do menu que não sai direto
 * de um catálogo: os rótulos vêm de `SECONDARY_WEAPON_LABELS`, e isto é a consequência de jogo
 * que o piloto precisa saber ANTES de escolher.
 *
 * A nota do EMP não é enfeite. Ele causa dano zero ao boss por construção — `computeEmpDamage`
 * decai com a distância e o boss fica sempre fora do raio (`packages/sim/src/combat-model.ts`,
 * já isentado no balance-gate) — e até 2026-08-30 ninguém podia escolhê-lo, então a limitação
 * nunca precisou ser dita. Agora precisa.
 */
const SECONDARY_WEAPON_TRADEOFFS: Record<SecondaryWeaponType, string> = {
  homing_missiles: 'dano alto e mira sozinho; é a única secundária que fere o boss',
  emp_burst: 'dano em área, limpa enxame e apaga projéteis inimigos; NÃO fere o boss',
  none: 'sem arma secundária'
};

/** Monta uma linha de menu numerada: `1-Rótulo  2-Rótulo`. O índice + 1 é o que o piloto digita. */
function menuOptions<T extends string>(order: T[], label: (key: T) => string): string {
  return order.map((key, i) => `${i + 1}-${label(key)}`).join('  ');
}

/** Monta as linhas `N-Rótulo → "slug"` da tabela de conversão que o agente precisa gravar. */
function slugRows<T extends string>(order: T[], label: (key: T) => string, indent: string): string {
  return order.map((key, i) => `${indent}${i + 1}-${label(key)} → "${key}"`).join('\n');
}

/**
 * Recuo das linhas de continuação de um menu, alinhado sob a primeira opção. Os quatro rótulos
 * (`Canhão primário:`, `Arma secundária:`, `Estilo do casco:`, `Cor de destaque:`) têm 16
 * caracteres de propósito, então uma única constante alinha os quatro.
 */
const MENU_INDENT = ' '.repeat(25);

/** Quebra uma lista de opções já numeradas em linhas de no máximo `perLine` itens. */
function menuLines(options: string[], perLine: number): string {
  const lines: string[] = [];
  for (let i = 0; i < options.length; i += perLine) {
    lines.push(options.slice(i, i + perLine).join('  '));
  }
  return lines.join(`\n${MENU_INDENT}`);
}

const primaryOptions = menuOptions(PRIMARY_WEAPON_ORDER, (k) => PRIMARY_WEAPON_LABELS[k]);
const themeOptions = menuOptions(VISUAL_THEME_ORDER, (k) => VISUAL_THEMES[k].label);

/** A secundária ganha uma linha por opção porque cada uma carrega seu compromisso de jogo. */
const secondaryOptionsBlock = menuLines(
  GRILL_ME_SECONDARY_ORDER.map(
    (k, i) => `${i + 1}-${SECONDARY_WEAPON_LABELS[k]} (${SECONDARY_WEAPON_TRADEOFFS[k]})`
  ),
  1
);

/** Seis cores em duas linhas de três — uma linha só passaria da largura do terminal do estande. */
const accentOptionsBlock = menuLines(
  ACCENT_COLOR_ORDER.map((k, i) => `${i + 1}-${ACCENT_COLORS[k].label}`),
  3
);

const primarySlugRows = slugRows(PRIMARY_WEAPON_ORDER, (k) => PRIMARY_WEAPON_LABELS[k], '     ');
const secondarySlugRows = slugRows(
  GRILL_ME_SECONDARY_ORDER,
  (k) => SECONDARY_WEAPON_LABELS[k],
  '     '
);
const themeSlugRows = slugRows(VISUAL_THEME_ORDER, (k) => VISUAL_THEMES[k].label, '     ');
const accentSlugRows = slugRows(ACCENT_COLOR_ORDER, (k) => ACCENT_COLORS[k].label, '     ');

/**
 * Paleta base de cada tema, em hex. Antes disto o prompt só nomeava os três temas e o modelo
 * inventava a paleta a cada sessão, então duas naves "Cyberpunk Gold" saíam de cores diferentes.
 */
const THEME_PALETTE_ROWS = VISUAL_THEME_ORDER.map((key) => {
  const theme = VISUAL_THEMES[key];
  const { primary_color, secondary_color, engine_trail_color } = theme.palette;
  return `- **${theme.label}** (\`${key}\`): ${theme.blurb}
  Paleta base: \`primary_color\` \`${primary_color}\`, \`secondary_color\` \`${secondary_color}\`, \`engine_trail_color\` \`${engine_trail_color}\`.`;
}).join('\n');

/** As seis cores de destaque com o hex exato, para o destaque não virar "um rosa qualquer". */
const ACCENT_HEX_ROWS = ACCENT_COLOR_ORDER.map(
  (key) => `- ${ACCENT_COLORS[key].label} (\`${key}\`): \`${ACCENT_COLORS[key].hex}\``
).join('\n');

/**
 * Exemplo de resposta de quatro dígitos exibido no prompt. Os dígitos são clampados ao tamanho real
 * de cada catálogo para que o exemplo continue válido se alguém acrescentar ou remover uma opção —
 * um exemplo inválido no prompt é pior que nenhum exemplo.
 */
const grillMeExample = [
  { picks: 2, order: PRIMARY_WEAPON_ORDER as string[] },
  { picks: 1, order: GRILL_ME_SECONDARY_ORDER as string[] },
  { picks: 3, order: VISUAL_THEME_ORDER as string[] },
  { picks: 5, order: ACCENT_COLOR_ORDER as string[] }
]
  .map(({ picks, order }) => Math.min(picks, order.length))
  .join(' ');

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
O Orquestrador vai te informar duas escolhas do piloto: o **tema** (\`visual_theme\`) e a **cor de
destaque** (\`accent_color\`). As duas são obrigatórias e cada uma governa uma coisa diferente.

## O tema governa a GEOMETRIA

${THEME_PALETTE_ROWS}

A silhueta, a composição e a identidade estrutural vêm do tema e **não** mudam por causa da cor.
Duas naves do mesmo tema com cores diferentes têm que continuar reconhecivelmente do mesmo tema.

## A cor de destaque governa a PALETA

${ACCENT_HEX_ROWS}

Parta da paleta base do tema e aplique o destaque: o hex da cor escolhida **deve** aparecer em
\`primary_color\` **ou** em \`engine_trail_color\` (nos dois, se ficar melhor). O terceiro campo
permanece na paleta base do tema, ou num tom derivado dela que não brigue com o destaque. Exemplo:
Dark Void Stealth com destaque Rosa Choque continua uma nave Dark Void Stealth — base escura,
painéis angulares —, só que com \`#ff2d95\` no lugar do roxo padrão.

Os três campos são hex de seis dígitos no formato \`#rrggbb\`; qualquer outro formato faz o
validador do jogo rejeitar a nave inteira.

## O nome de batismo

\`style_name\` é o único texto livre seu que o piloto lê: aparece como **Classe** na tela de pré-voo.
Escreva um nome próprio de 2 a 4 palavras, em Maiúsculas De Título, com no máximo 40 caracteres.
Pelo menos uma palavra tem que vir da **build** — a arma escolhida, o casco, a velocidade, o escudo —
e não só do tema: dois pilotos que escolherem o mesmo tema com naves diferentes precisam sair daqui
com nomes diferentes.

Estes três são nomes de OUTRAS naves, aqui só para você ver a forma. NÃO copie nenhum deles, nem
mesmo o que combinar com o tema do piloto: \`${FALLBACK_PRESETS.interceptor.visuals.style_name}\`,
\`${FALLBACK_PRESETS.vanguard.visuals.style_name}\`, \`${FALLBACK_PRESETS.striker.visuals.style_name}\`.

NUNCA devolva o slug do tema (${VISUAL_THEME_ORDER.map((k) => `\`${k}\``).join(', ')}) neste campo: o
slug é um identificador interno, e ler "synthwave_80s" na tela é pior que não ler nada.
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
tipo de arma secundária, dano e cooldown). Você NÃO deve invocar nenhuma ferramenta MCP por conta
própria — os valores já foram obtidos pelo Orquestrador.

Sua tarefa é produzir **exatamente 2 dicas de pilotagem** para este build específico. Cada dica:
uma frase, no imperativo, em português, no máximo 140 caracteres, dirigida ao piloto.

Diga **o que fazer com o joystick e com as teclas**, não o que os números são — o piloto já vê os
números na tela. Derive cada dica dos valores que o Orquestrador te passou:

- cadência alta pede tiro sustentado; cadência baixa com dano alto pede tiro escolhido;
- leque largo (\`spread_angle\`) rende de perto e desperdiça de longe;
- \`homing_missiles\` é a **única** secundária que fere o boss — vale guardar para ele;
- \`emp_burst\` **não** fere o boss: use contra enxame e para apagar os projéteis inimigos no raio;
- cooldown longo significa que errar o momento do Shift custa a próxima janela inteira.

Devolva **só** as duas frases, uma por linha, sem numeração, sem marcador e sem preâmbulo — o
Orquestrador vai gravá-las em \`build_metadata.pilot_tips\`.
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
(velocidade, HP, raio de colisão, capacidade de escudo, sinergias desbloqueadas). Você NÃO deve
invocar nenhuma ferramenta MCP por conta própria — os valores já foram obtidos pelo Orquestrador.

Sua tarefa é produzir **exatamente 2 dicas de pilotagem** para este build específico. Cada dica:
uma frase, no imperativo, em português, no máximo 140 caracteres, dirigida ao piloto.

Diga **o que fazer com o joystick e com as teclas**, não o que os números são — o piloto já vê os
números na tela. Derive cada dica dos valores que o Orquestrador te passou:

- casco baixo pede fuga constante e uso dos corredores laterais em vez de troca de tiro de frente;
- casco alto permite avançar pelo meio da tela e sustentar posição;
- velocidade alta permite reposicionar entre ondas; velocidade baixa exige escolher um lado cedo;
- hitbox pequena permite **passar entre** os padrões de tiro em vez de contorná-los;
- escudo é uma segunda vida que recarrega: vale gastá-lo para atravessar uma parede de projéteis.

Devolva **só** as duas frases, uma por linha, sem numeração, sem marcador e sem preâmbulo — o
Orquestrador vai gravá-las em \`build_metadata.pilot_tips\`.
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
      '| `build_metadata.fast_grill_me_choices` | EXATAMENTE `{ primary_weapon, secondary_weapon, visual_theme, accent_color }`, as quatro obrigatórias (ver PASSO 1 para os slugs) — o campo `weapon_focus` não existe mais | — |',
      '| `build_metadata.pilot_tips` | Dicas devolvidas pelos sub-agentes táticos no PASSO 3, na ordem de invocação | máx. 3 itens, até 140 caracteres cada, em português. Campo OPCIONAL: se nenhum sub-agente devolver dica, **omita o campo** em vez de inventar uma. |'
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
      contractRows.push('| `weapons.primary.type` | O canhão escolhido no PASSO 1 — o mesmo valor de `fast_grill_me_choices.primary_weapon`, não uma escolha sua | laser, plasma ou vulcan_spread |');
      contractRows.push(`| \`weapons.primary.damage\` | Retorno de \`weapons-arsenal\` | ${rangeRow('weapons.primary.damage')} |`);
      contractRows.push(`| \`weapons.primary.fire_rate\` | Retorno de \`weapons-arsenal\` | ${rangeRow('weapons.primary.fire_rate')} |`);
      contractRows.push(`| \`weapons.primary.bullet_speed\` | Retorno de \`weapons-arsenal\` | ${rangeRow('weapons.primary.bullet_speed')} |`);
      contractRows.push(`| \`weapons.primary.spread_angle\` | Retorno de \`weapons-arsenal\` | ${rangeRow('weapons.primary.spread_angle')} |`);
      contractRows.push('| `weapons.secondary.type` | A secundária escolhida no PASSO 1 — o mesmo valor de `fast_grill_me_choices.secondary_weapon`, não uma escolha sua | homing_missiles ou emp_burst |');
      contractRows.push(`| \`weapons.secondary.damage\` | Retorno de \`weapons-arsenal\` | ${rangeRow('weapons.secondary.damage')} |`);
      contractRows.push(`| \`weapons.secondary.cooldown_seconds\` | Retorno de \`weapons-arsenal\` | ${rangeRow('weapons.secondary.cooldown_seconds')} |`);
    }

    // Visuals are always included (aesthetic-designer is always active)
    contractRows.push(
      `| \`visuals.style_name\` | \`aesthetic-designer\` | Nome de batismo da nave: 2 a 4 palavras em Maiúsculas De Título, até 40 caracteres (ex.: \`${FALLBACK_PRESETS.interceptor.visuals.style_name}\`). NUNCA o slug do tema |`
    );
    contractRows.push('| `visuals.primary_color`, `secondary_color`, `engine_trail_color` | `aesthetic-designer` (paleta do tema + a cor de destaque escolhida no PASSO 1) | hex `#rrggbb` |');
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

### COMO A SESSÃO COMEÇA

A primeira mensagem do piloto é sempre exatamente esta frase, injetada pelo estande:

> ${BOOTH_KICKOFF_PROMPT}

Ela não contém nenhuma escolha — a escolha acontece no PASSO 1. A resposta correta é **começar o
PASSO 1 imediatamente**: sem saudação, sem se apresentar, sem resumir este protocolo, sem perguntar
o que o piloto quer e sem chamar nenhuma ferramenta MCP antes do menu. A primeira coisa que o piloto
lê na tela é o menu das quatro perguntas.

Campos do \`ship_spec.json\` que pertencem a um MCP **fora** da lista acima (ex.: \`weapons.*\` se
\`weapons-arsenal\` não estiver listado, \`attributes.max_hp\`/\`speed_px_s\`/\`hitbox_radius\` se
\`hull-propulsion\` não estiver listado, ou \`attributes.shield_capacity\` se
\`cybernetics-shields\` não estiver listado) **NÃO fazem parte desta sessão — simplesmente
OMITA-os do arquivo final.** O jogo preenche esses campos automaticamente a partir da alocação de
energia do piloto. Isso NÃO é uma violação da REGRA ZERO: você só é proibido de inventar valores
para os MCPs que ESTÃO ativos.

### PROTOCOLO RÍGIDO DE 5 PASSOS:
1. **PASSO 1 - FAST GRILL-ME:** Faça as QUATRO perguntas abaixo de uma vez só, em UM único turno,
   exatamente como estão escritas. Não faça uma pergunta por turno, não acrescente perguntas, não
   ofereça opções que não estejam nesta lista. Aceite a resposta em qualquer formato (\`${grillMeExample}\`,
   \`${grillMeExample.split(' ').join(',')}\`, ou uma resposta por vez); se o piloto responder com o
   rótulo em português em vez do número, aceite igual.

   [1] Canhão primário:  ${primaryOptions}
   [2] Arma secundária:  ${secondaryOptionsBlock}
   [3] Estilo do casco:  ${themeOptions}
   [4] Cor de destaque:  ${accentOptionsBlock}

   Grave as respostas em \`build_metadata.fast_grill_me_choices\` com EXATAMENTE estas QUATRO
   chaves, usando estes slugs em inglês (nunca o texto em português, nunca outro nome de campo):

   \`primary_weapon\`:
${primarySlugRows}

   \`secondary_weapon\`:
${secondarySlugRows}

   \`visual_theme\` (o nome do campo é \`visual_theme\`, NUNCA \`aesthetic_style\`):
${themeSlugRows}

   \`accent_color\`:
${accentSlugRows}

   As quatro chaves são **obrigatórias** e o objeto não aceita nenhuma outra. Em particular, o
   campo \`weapon_focus\` **não existe mais** — se você o gravar, o arquivo inteiro é rejeitado.
   \`primary_weapon\` e \`secondary_weapon\` são os mesmos valores que vão para \`weapons.primary.type\`
   e \`weapons.secondary.type\`: a escolha do piloto é o tipo de arma que a nave recebe, sem
   tradução no meio.
2. **PASSO 2 - EXECUÇÃO DIRETA DAS FERRAMENTAS MCP:** Você mesmo (a sessão principal) DEVE invocar
   diretamente as ferramentas de cada servidor MCP ativo — não delegue esta etapa a nenhum
   sub-agente. O jogo verifica \`mcp_audit.log\` antes de aceitar a nave: **sem registro de execução,
   a nave é rejeitada.**
3. **PASSO 3 - BRIEFING DOS ESPECIALISTAS:** Com os valores já obtidos no Passo 2 em mãos, invoque
   os sub-agentes em \`.agents/agents/\` via \`invoke_subagent\` (opção de workspace \`inherit\`),
   incluindo no prompt inicial de cada um os valores exatos que você obteve. Eles NÃO devem invocar
   nenhuma ferramenta MCP por conta própria.

   O \`aesthetic-designer\` devolve os dados visuais. Cada sub-agente **tático**
   (\`combat-strategist\`, \`systems-engineer\`) devolve uma **lista de dicas de pilotagem** — uma
   frase por linha. Concatene as listas na ordem em que você invocou os sub-agentes e guarde o
   resultado para o PASSO 4; não reescreva, não resuma e não numere as frases.
4. **PASSO 4 - CRIAÇÃO DO ARQUIVO:** Use sua ferramenta de escrita para gravar
   \`${sessionDir}/ship_spec.json\` com os valores que as ferramentas retornaram, incluindo as dicas
   do PASSO 3 em \`build_metadata.pilot_tips\`. Tudo vai na **mesma escrita**: o jogo libera a nave
   assim que o arquivo é válido, então uma segunda escrita para acrescentar as dicas chega tarde
   demais e o piloto decola sem elas.
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
