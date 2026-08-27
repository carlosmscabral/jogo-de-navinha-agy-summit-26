/**
 * Vocabulário único do que o visitante vê: nomes dos servidores MCP, das ferramentas,
 * dos sub-agentes e dos campos da nave.
 *
 * Antes disto a mesma informação existia em três lugares que não se falavam:
 *  - a descrição voltada ao **modelo**, no segundo argumento de cada `server.tool(...)`
 *    em `packages/mcps/src/*.ts`;
 *  - a descrição voltada ao **visitante**, em JSX literal no `EnergySlidersBuilder`;
 *  - o rótulo de cada estatística, repetido como literal em cinco componentes.
 *
 * A consequência prática era slug cru vazando para a tela — o jogador lia
 * `vulcan_spread` e `homing_missiles` no pré-voo — e `getServerBadge` classificando
 * servidor por `includes()` com um catch-all que rotulava qualquer nome desconhecido
 * como "cybernetics". Aqui as chaves são exatas e o compilador cobra a exaustividade
 * via `Record<McpServerName, …>`.
 *
 * As descrições foram copiadas do que já existia, não reescritas: `blurb` de servidor e
 * `visitorBlurb` vêm do builder, `blurb` de ferramenta vem do `server.tool(...)`
 * correspondente, e os sub-agentes vêm do front-matter gerado em
 * `packages/daemon/src/services/workspace-generator.ts`.
 */

import type {
  McpServerName,
  SubagentName,
  PrimaryWeaponType,
  SecondaryWeaponType
} from '../types/ship.js';

/** Campo do `ShipSpecification` que uma ferramenta MCP calibra. Alimenta o preview. */
export type AffectedField =
  | 'primary'
  | 'secondary'
  | 'max_hp'
  | 'shield_capacity'
  | 'speed_px_s'
  | 'hitbox_radius'
  | 'synergies';

export interface McpToolEntry {
  /** Nome exato registrado em `server.tool(...)`, e o que aparece em `mcp_audit.log`. */
  id: string;
  /** Rótulo curto para a tela. */
  label: string;
  /** Descrição — a mesma string passada ao modelo no registro da ferramenta. */
  blurb: string;
  affects: AffectedField[];
}

export interface McpServerEntry {
  label: string;
  /** Cor da paleta usada por este servidor em toda a UI. Ver `styles/theme.css`. */
  color: string;
  /** O que o servidor faz, em uma linha. */
  blurb: string;
  /** O que muda quando o visitante marca este servidor. */
  whenSelected: string;
  /** O que acontece quando ele não marca — o backfill de `computeBaselineWeapons`. */
  whenUnselected: string;
  tools: McpToolEntry[];
}

export const MCP_CATALOG: Record<McpServerName, McpServerEntry> = {
  'weapons-arsenal': {
    label: 'Arsenal de Armas',
    color: '#ff9e0b',
    blurb: 'Canhões primários (Laser, Vulcan, Plasma) e mísseis secundários.',
    whenSelected: 'Dano e cadência calibrados de verdade pela IA.',
    whenUnselected: 'Dano e cadência usam uma configuração padrão baseada no seu Ataque.',
    tools: [
      {
        id: 'configure_primary_cannon',
        label: 'Canhão primário',
        blurb:
          'Configura o canhão primário da nave calculando dano, cadência de tiro e velocidade dos projéteis.',
        affects: ['primary']
      },
      {
        id: 'attach_secondary_ordnance',
        label: 'Armamento secundário',
        blurb: 'Instala e calibra o sistema de armas secundárias ativado pela tecla Shift.',
        affects: ['secondary']
      }
    ]
  },
  'hull-propulsion': {
    label: 'Casco & Propulsão',
    color: '#38bdf8',
    blurb: 'Propulsores de esquiva rápida, aceleração turbo e peso do casco.',
    whenSelected: 'Velocidade e casco calibrados de verdade pela IA.',
    whenUnselected:
      'Velocidade e resistência do casco (HP) usam uma configuração padrão baseada em Velocidade/Defesa.',
    tools: [
      {
        id: 'tune_thrusters',
        label: 'Propulsores',
        blurb:
          'Calibra os propulsores de voo da nave, velocidade máxima de deslocamento e raio da hitbox central.',
        affects: ['speed_px_s', 'hitbox_radius']
      },
      {
        id: 'reinforce_plating',
        label: 'Blindagem',
        blurb: 'Instala blindagem estrutural na fuselagem para absorção de dano físico.',
        affects: ['max_hp']
      }
    ]
  },
  'cybernetics-shields': {
    label: 'Cibernética & Escudos',
    color: '#10b981',
    blurb: 'Camadas de escudos energéticos e módulos de sinergia matricial.',
    whenSelected: 'Escudo calibrado pela IA — e o ÚNICO servidor que desbloqueia sinergias.',
    whenUnselected:
      'Escudo padrão baseado na sua Tecnologia, e NENHUMA sinergia é desbloqueada.',
    tools: [
      {
        id: 'calibrate_energy_barrier',
        label: 'Barreira de energia',
        blurb: 'Calibra o campo de força energético e a capacidade de escudos da nave.',
        affects: ['shield_capacity']
      },
      {
        id: 'install_overclock_module',
        label: 'Módulo de sinergia',
        blurb: 'Configura módulos cibernéticos e computa sinergias ativadas entre componentes.',
        affects: ['synergies']
      }
    ]
  }
};

export interface SubagentEntry {
  label: string;
  blurb: string;
  /** Cor da paleta usada por este sub-agente na UI, no mesmo esquema dos servidores. */
  color: string;
  /**
   * `false` para o `aesthetic-designer`: ele é sempre gerado no workspace
   * (`WorkspaceGenerator.generateSubagents`) e sempre enviado no payload, então o
   * visitante não escolhe — mas continua merecendo aparecer na tela, porque é ele quem
   * desenha o casco.
   */
  selectable: boolean;
}

export const SUBAGENT_CATALOG: Record<SubagentName, SubagentEntry> = {
  'aesthetic-designer': {
    label: 'Projetista Visual',
    blurb: 'Desenha a fuselagem em SVG e escolhe a paleta. Sempre incluído.',
    color: '#a78bfa',
    selectable: false
  },
  'combat-strategist': {
    label: 'Estrategista Tático',
    blurb: 'Especialista em canhões, cadência e mísseis',
    color: '#ff9e0b',
    selectable: true
  },
  'systems-engineer': {
    label: 'Engenheiro de Sistemas',
    blurb: 'Especialista em blindagem, velocidade e escudos',
    color: '#10b981',
    selectable: true
  }
};

/** Rótulo em português de cada atributo da nave. Evita `max_hp` cru na tela. */
export const STAT_LABELS: Record<string, string> = {
  max_hp: 'Casco',
  shield_capacity: 'Escudo',
  speed_px_s: 'Velocidade',
  hitbox_radius: 'Perfil de colisão',
  damage: 'Dano',
  fire_rate: 'Cadência',
  bullet_speed: 'Velocidade do projétil',
  spread_angle: 'Abertura do leque',
  cooldown_seconds: 'Recarga'
};

/** Unidade de cada campo, quando existe. Concatenada depois do valor na UI. */
export const STAT_UNITS: Record<string, string> = {
  speed_px_s: 'px/s',
  hitbox_radius: 'px',
  fire_rate: '/s',
  bullet_speed: 'px/s',
  spread_angle: '°',
  cooldown_seconds: 's'
};

export const PRIMARY_WEAPON_LABELS: Record<PrimaryWeaponType, string> = {
  plasma: 'Canhão de Plasma',
  laser: 'Laser Contínuo',
  vulcan_spread: 'Vulcan em Leque'
};

export const SECONDARY_WEAPON_LABELS: Record<SecondaryWeaponType, string> = {
  homing_missiles: 'Mísseis Teleguiados',
  emp_burst: 'Pulso EMP',
  none: 'Sem armamento secundário'
};

/**
 * Traduz o `server` de uma linha do `mcp_audit.log`. Chave exata, sem heurística de
 * substring: um servidor desconhecido devolve `undefined` e a UI mostra o slug cru, que
 * é honesto — melhor que rotulá-lo como um servidor que ele não é.
 */
export function lookupMcpServer(server: string): McpServerEntry | undefined {
  return MCP_CATALOG[server as McpServerName];
}

/** Traduz o `tool` de uma linha do `mcp_audit.log`, procurando em todos os servidores. */
export function lookupMcpTool(tool: string): McpToolEntry | undefined {
  for (const entry of Object.values(MCP_CATALOG)) {
    const found = entry.tools.find((t) => t.id === tool);
    if (found) return found;
  }
  return undefined;
}

/** Rótulo de um atributo, com o slug cru como último recurso. */
export function statLabel(field: string): string {
  return STAT_LABELS[field] ?? field;
}
