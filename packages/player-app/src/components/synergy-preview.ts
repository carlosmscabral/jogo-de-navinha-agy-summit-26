import {
  BALANCE,
  EnergySliders,
  McpServerName,
  SynergyName,
  canUnlockSynergies,
  SYNERGY_OWNER_MCP
} from '@jogo/shared';

/**
 * Crachá de sinergia da tela de forja (`EnergySlidersBuilder`).
 *
 * Duas coisas distintas, deliberadamente separadas:
 *
 *  - **Qual** sinergia os sliders sugerem. Isto é um palpite de PREVIEW, não um contrato: quem
 *    decide de verdade é o agente (que nomeia a `synergy_candidate`) mais o MCP
 *    `cybernetics-shields` (`install_overclock_module`, que exige o slider dono em 35+). Os
 *    limiares abaixo são propositalmente mais conservadores (40+) que os do MCP, para que o
 *    crachá erre para menos — prometer menos e entregar mais é aceitável; o inverso não.
 *  - **Se** ela pode ser desbloqueada. Isto é um contrato, e vem de `canUnlockSynergies` em
 *    `@jogo/shared`, a mesma função que o daemon usa para zerar `synergies_unlocked`. Sem o MCP
 *    dono selecionado a engine não aplica sinergia nenhuma e o bônus de placar não sai, então o
 *    crachá precisa mostrar a sinergia como BLOQUEADA em vez de prometer o bônus.
 */
export interface SynergyPreview {
  /** Texto exibido no crachá. */
  label: string;
  /** `false` quando a sinergia detectada não será entregue por falta do MCP dono. */
  unlocked: boolean;
  /** `true` quando os sliders não sugerem nenhuma sinergia conhecida. */
  none: boolean;
}

/** `1.30` → `+30%`. Nenhum percentual desta tela é digitado à mão. */
function pct(factor: number): string {
  return `+${Math.round((factor - 1) * 100)}%`;
}

/**
 * O que cada sinergia faz, derivado de `BALANCE.synergies` e de `BALANCE.ranges` — as mesmas
 * constantes que `applySynergies` consome.
 *
 * Antes daqui as descrições eram literais no crachá e duas das quatro estavam simplesmente
 * erradas: prometiam "+20% Esquiva" para a Ghost Interceptor (que na verdade trava velocidade no
 * máximo e hitbox no mínimo) e "+25% Blindagem" para a Titan Fortress (que trava o casco em 5,
 * garante um piso de escudo e liga a regeneração). Derivar do balance é o que impede a promessa
 * de tornar a divergir do que a engine entrega quando alguém ajustar um número.
 */
export const SYNERGY_EFFECTS: Record<SynergyName, { icon: string; effect: string }> = {
  'Glass Cannon': {
    icon: '⚡',
    effect: `${pct(BALANCE.synergies.glass_cannon.primary_damage_factor)} dano · casco ${
      BALANCE.synergies.glass_cannon.forced_max_hp
    }`
  },
  'Titan Fortress': {
    icon: '🛡️',
    effect: `casco ${BALANCE.synergies.titan_fortress.forced_max_hp} · escudo ≥${
      BALANCE.synergies.titan_fortress.min_shield_capacity
    } · regen ${BALANCE.synergies.titan_fortress.regen_interval_s}s`
  },
  'Ghost Interceptor': {
    icon: '💨',
    effect: `${BALANCE.ranges['attributes.speed_px_s'].max} px/s · hitbox ${
      BALANCE.ranges['attributes.hitbox_radius'].min
    }px`
  },
  'Balanced Ace': {
    icon: '🎯',
    effect: `${pct(BALANCE.synergies.balanced_ace.all_attributes_factor)} em tudo`
  }
};

/** Nome decorado da sinergia, sem o efeito. Usado onde só cabe o nome (pré-voo). */
export function synergyLabel(name: SynergyName): string {
  return `${SYNERGY_EFFECTS[name].icon} ${name}`;
}

const MATRIX: { name: SynergyName; matches: (s: EnergySliders) => boolean }[] = [
  { name: 'Glass Cannon', matches: (s) => s.offense >= 40 },
  { name: 'Ghost Interceptor', matches: (s) => s.speed >= 40 },
  { name: 'Titan Fortress', matches: (s) => s.defense >= 40 },
  {
    name: 'Balanced Ace',
    matches: (s) =>
      s.offense >= 20 && s.offense <= 30 &&
      s.speed >= 20 && s.speed <= 30 &&
      s.defense >= 20 && s.defense <= 30
  }
];

export function detectSynergyPreview(
  sliders: EnergySliders,
  selectedMcps: readonly McpServerName[]
): SynergyPreview {
  const hit = MATRIX.find((entry) => entry.matches(sliders));

  if (!hit) {
    return { label: 'Custom Build', unlocked: false, none: true };
  }

  if (!canUnlockSynergies(selectedMcps)) {
    return {
      label: `🔒 ${synergyLabel(hit.name)} — requer ${SYNERGY_OWNER_MCP}`,
      unlocked: false,
      none: false
    };
  }

  return {
    label: `${synergyLabel(hit.name)} (${SYNERGY_EFFECTS[hit.name].effect})`,
    unlocked: true,
    none: false
  };
}
