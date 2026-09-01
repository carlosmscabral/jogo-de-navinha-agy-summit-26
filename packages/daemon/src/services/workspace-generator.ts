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
  PrimaryWeaponType,
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

/**
 * O mesmo para os canhões primários. As três frases descrevem o que `PRIMARY_PROFILES`
 * (`packages/mcps/src/weapons-arsenal.ts`) de fato produz — dano por tiro, velocidade do projétil
 * e leque — em linguagem de pilotagem, não de estatística: o piloto escolhe antes de ver número
 * nenhum, e o número exato ainda depende do slider de Ataque dele.
 *
 * O vulcan dispara `BALANCE.weapons.primary.vulcan_pellet_count` pelotas em leque; as externas
 * passam ao largo de um alvo distante (`combat-model.ts`), e é por isso que a frase fala em
 * distância em vez de prometer o dano somado.
 */
const PRIMARY_WEAPON_TRADEOFFS: Record<PrimaryWeaponType, string> = {
  // Não diga "tiro rápido": `fire_rate` não faz parte do perfil do tipo (`weapons-arsenal.ts`
  // PRIMARY_PROFILES) nem do backfill de `computeBaselineWeapons` — vem do argumento do agente,
  // default 8, igual para os três. O que o laser realmente tem é `bullet_speed` 750 contra 650 do
  // plasma, e 25 de dano contra 35. A opção descreve o que o MCP escreve, não o que soa bem.
  laser: 'projétil mais veloz e preciso; menos dano por acerto, rende no fogo sustentado',
  plasma: 'maior dano por acerto e projétil mais lento; recompensa mirar em vez de varrer',
  vulcan_spread: 'várias pelotas em leque; cobre muito espaço de perto e desperdiça de longe'
};

/** Monta as linhas `N-Rótulo → "slug"` da tabela de conversão que o agente precisa gravar. */
function slugRows<T extends string>(order: T[], label: (key: T) => string, indent: string): string {
  return order.map((key, i) => `${indent}${i + 1}-${label(key)} → "${key}"`).join('\n');
}

/** Uma pergunta do Fast-Grill-Me no formato que a ferramenta builtin `ask_question` espera. */
interface GrillMeQuestion {
  question: string;
  options: string[];
  is_multi_select: false;
}

/**
 * Monta uma das perguntas do Fast-Grill-Me.
 *
 * As opções NÃO são numeradas aqui: o `ask_question` do `agy` imprime `1.`, `2.`, `3.` sozinho e
 * desenha o cursor `>` que anda com as setas. Numerar de novo produziria `1. 1) Laser`.
 *
 * `blurb` é opcional porque a cor é a única das quatro perguntas sem descrição: o rótulo já é a
 * descrição, e seis frases explicando o que é "Rosa Choque" custariam segundos do SLA sem informar
 * nada. As outras três descrevem, e é por isso que a pergunta existe — sem a frase o piloto escolhe
 * no escuro entre três nomes.
 *
 * O texto sai dos catálogos pelo mesmo motivo que `rangeRow()` lê `BALANCE.ranges`: o prompt não
 * pode oferecer uma opção que o schema depois rejeita, nem descrevê-la de um jeito que os números
 * do MCP desmintam.
 */
function grillMeQuestion<T extends string>(
  question: string,
  order: T[],
  label: (key: T) => string,
  blurb?: (key: T) => string
): GrillMeQuestion {
  return {
    question,
    options: order.map((key) =>
      // O ponto final some porque os catálogos discordam entre si: `VISUAL_THEMES[].blurb` é uma
      // frase pontuada e os compromissos de arma não são. Numa lista de opções essa diferença
      // aparece, e o piloto lê as quatro perguntas em sequência.
      blurb ? `${label(key)} — ${blurb(key).replace(/\.$/, '')}` : label(key)
    ),
    is_multi_select: false
  };
}

const GRILL_ME_QUESTIONS: GrillMeQuestion[] = [
  grillMeQuestion(
    'Qual vai ser o canhão primário da sua nave?',
    PRIMARY_WEAPON_ORDER,
    (k) => PRIMARY_WEAPON_LABELS[k],
    (k) => PRIMARY_WEAPON_TRADEOFFS[k]
  ),
  grillMeQuestion(
    'E a arma secundária, no Shift?',
    GRILL_ME_SECONDARY_ORDER,
    (k) => SECONDARY_WEAPON_LABELS[k],
    (k) => SECONDARY_WEAPON_TRADEOFFS[k]
  ),
  grillMeQuestion(
    'Qual o formato do casco?',
    VISUAL_THEME_ORDER,
    (k) => VISUAL_THEMES[k].label,
    (k) => VISUAL_THEMES[k].blurb
  ),
  grillMeQuestion('Qual a cor de destaque?', ACCENT_COLOR_ORDER, (k) => ACCENT_COLORS[k].label)
];

const QUESTION_COUNT = GRILL_ME_QUESTIONS.length;

/**
 * O argumento literal da chamada, serializado com `JSON.stringify` em vez de montado à mão: as
 * descrições têm travessão, ponto-e-vírgula e acento, e uma aspa mal escapada aqui derrubaria a
 * chamada inteira no estande.
 *
 * As quatro perguntas vão numa chamada só, e não uma por turno como até 2026-08-31: o CLI caminha
 * `Question 1/4` a `4/4` localmente, sem voltar ao modelo entre elas. Quatro idas e voltas ao
 * Gemini viram uma, e é esse relógio que `AGY_PRE_MCP_SILENCE_TIMEOUT_MS` mede.
 */
const askQuestionPayload = JSON.stringify({ questions: GRILL_ME_QUESTIONS }, null, 2);

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
A sessão principal (Orquestrador) já invocou as ferramentas MCP desta sessão e vai te fornecer, no
prompt de invocação, os valores exatos do armamento desta nave (dano, cadência, leque, cooldown) e
os dois tipos que o piloto escolheu (\`primary_weapon\` e \`secondary_weapon\`). Você NÃO deve
invocar nenhuma ferramenta MCP por conta própria — os valores já foram obtidos pelo Orquestrador.

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
A sessão principal (Orquestrador) já invocou as ferramentas MCP desta sessão e vai te fornecer, no
prompt de invocação, os valores exatos retornados (velocidade, HP, raio de colisão, capacidade de
escudo, sinergias desbloqueadas), mais os dois tipos de arma que o piloto escolheu
(\`primary_weapon\` e \`secondary_weapon\`). Você NÃO deve
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

Uma exceção que vale mais que qualquer um dos marcadores acima: **se \`secondary_weapon\` for
\`emp_burst\`**, uma das suas duas dicas — e só uma — tem que ser sobre ela. O EMP **não** fere o
boss; serve para limpar enxame e para apagar os projéteis inimigos dentro do raio. É o único fato
desta nave que o piloto não consegue deduzir olhando a tela, e ninguém mais vai contar a ele.
Se a secundária for \`homing_missiles\`, não gaste dica com isso: mantenha as duas sobre casco,
velocidade, hitbox e escudo.

Devolva **só** as duas frases, uma por linha, sem numeração, sem marcador e sem preâmbulo — o
Orquestrador vai gravá-las em \`build_metadata.pilot_tips\`.
`;
      fs.writeFileSync(path.join(agentsDir, 'systems-engineer.md'), systemsContent, 'utf8');
    }
  }

  private static generateGeminiInstructions(sessionDir: string, config: SessionWorkspaceConfig): void {
    const { pilot, energy_sliders, selected_mcps, selected_subagents } = config;
    // O `Set` não é higiene defensiva: `EnergySlidersBuilder.tsx:229` já inclui o designer na lista
    // que envia, e sem deduplicar a tabela abaixo mandava o agente gravar "aesthetic-designer" duas
    // vezes — o que ele fazia, obediente, porque a linha diz "Exatamente". O prefixo continua
    // necessário para o default do daemon (`index.ts:335`) e para chamadores que só mandam o tático.
    const activeSubagents = [...new Set<SubagentName>(['aesthetic-designer', ...selected_subagents])];

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
o que o piloto quer, sem anunciar quantas perguntas vêm pela frente e sem chamar nenhuma ferramenta
MCP antes delas. A primeira coisa que aparece na tela é o seletor da
\`Question 1/${QUESTION_COUNT}\`, sozinho.

Campos do \`ship_spec.json\` que pertencem a um MCP **fora** da lista acima (ex.: \`weapons.*\` se
\`weapons-arsenal\` não estiver listado, \`attributes.max_hp\`/\`speed_px_s\`/\`hitbox_radius\` se
\`hull-propulsion\` não estiver listado, ou \`attributes.shield_capacity\` se
\`cybernetics-shields\` não estiver listado) **NÃO fazem parte desta sessão — simplesmente
OMITA-os do arquivo final.** O jogo preenche esses campos automaticamente a partir da alocação de
energia do piloto. Isso NÃO é uma violação da REGRA ZERO: você só é proibido de inventar valores
para os MCPs que ESTÃO ativos.

### PROTOCOLO RÍGIDO DE 5 PASSOS:
1. **PASSO 1 - FAST GRILL-ME:** Faça as ${QUESTION_COUNT} perguntas com **uma única chamada** da
   ferramenta \`ask_question\`, levando as ${QUESTION_COUNT} de uma vez no array \`questions\`.
   O CLI apresenta uma por vez (\`Question 1/${QUESTION_COUNT}\` até \`${QUESTION_COUNT}/${QUESTION_COUNT}\`),
   o piloto escolhe com as setas e Enter, e as ${QUESTION_COUNT} respostas voltam juntas.

   Essa chamada tem que ser a **ÚNICA** do turno: chame \`ask_question\` e **pare de gerar
   imediatamente**, para o CLI conseguir bloquear esperando o piloto. Nada de saudação antes, nada
   de comentário depois.

   O argumento é EXATAMENTE este — não reescreva as perguntas, não reordene as opções, não corte
   as descrições e não numere nada (o CLI numera sozinho e desenha o cursor):

\`\`\`json
${askQuestionPayload}
\`\`\`

   Tratamento das respostas:

   - O CLI acrescenta sozinho uma opção final de texto livre (\`Write-in...\`). Ela não está no
     array acima e você não deve mencioná-la. Se o piloto usar essa opção e o texto **não**
     corresponder a nenhuma das opções oferecidas, aquela resposta é inválida.
   - Se alguma resposta voltar vazia ou marcada como pulada, também é inválida.
   - Havendo resposta inválida, chame \`ask_question\` **uma vez só**, levando no array
     **exatamente as perguntas inválidas** — todas elas juntas, na ordem original. Repita a
     pergunta com as mesmas opções de antes. As respostas válidas ficam como estão: não repergunte
     o que o piloto já respondeu, nunca adivinhe o que ele quis dizer com o texto livre, e nunca
     repita as ${QUESTION_COUNT} por causa de uma. Se a rodada nova trouxer resposta inválida de
     novo, repita este mesmo tratamento.
   - Se, e somente se, a ferramenta \`ask_question\` não estiver disponível nesta sessão, faça as
     ${QUESTION_COUNT} perguntas como texto, uma por turno, uma opção por linha, com as mesmas
     descrições do JSON acima. É um plano B — a ferramenta é o caminho normal.

   Com as ${QUESTION_COUNT} respostas em mãos, vá **direto** ao PASSO 2: sem resumo das escolhas,
   sem confirmar, sem perguntar se pode começar.

   Grave as respostas em \`build_metadata.fast_grill_me_choices\` com EXATAMENTE estas QUATRO
   chaves, usando estes slugs em inglês (nunca o texto em português, nunca outro nome de campo).
   O rótulo de cada opção é o que vem **antes** do travessão — \`${PRIMARY_WEAPON_LABELS.laser} — ${PRIMARY_WEAPON_TRADEOFFS.laser.split(';')[0]}…\`
   é \`"laser"\`:

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

   No prompt de **todo** sub-agente tático, inclua também \`primary_weapon\` e \`secondary_weapon\`
   como o piloto os escolheu no PASSO 1 — inclusive quando o \`weapons-arsenal\` não estiver na
   lista de servidores acima. Esses dois vieram da resposta do piloto, não de ferramenta nenhuma,
   então você sempre os tem, e sem eles o especialista não sabe o que a tecla Shift faz nesta nave.

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
