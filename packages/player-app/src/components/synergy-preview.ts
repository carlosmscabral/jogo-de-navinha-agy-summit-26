import { EnergySliders, McpServerName, canUnlockSynergies, SYNERGY_OWNER_MCP } from '@jogo/shared';

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

const MATRIX: { name: string; bonus: string; matches: (s: EnergySliders) => boolean }[] = [
  { name: '⚡ Glass Cannon', bonus: '+30% DPS', matches: (s) => s.offense >= 40 },
  { name: '💨 Ghost Interceptor', bonus: '+20% Esquiva', matches: (s) => s.speed >= 40 },
  { name: '🛡️ Titan Fortress', bonus: '+25% Blindagem', matches: (s) => s.defense >= 40 },
  {
    name: '🎯 Balanced Ace',
    bonus: '+15% Geral',
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
    return { label: `🔒 ${hit.name} — requer ${SYNERGY_OWNER_MCP}`, unlocked: false, none: false };
  }

  return { label: `${hit.name} (${hit.bonus})`, unlocked: true, none: false };
}
