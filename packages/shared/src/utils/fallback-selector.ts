import { EnergySliders, ShipSpecification } from '../types/ship.js';
import { FALLBACK_PRESETS } from '../constants/fallback-presets.js';

export type FallbackPresetName = 'interceptor' | 'vanguard' | 'striker';

/**
 * Escolhe o preset de emergência mais próximo da alocação de energia do visitante.
 * A nave degradada ainda precisa refletir a escolha de quem a construiu.
 * Tecnologia é um atributo de suporte: conta meio ponto para os dois perfis que a usam.
 */
export function selectFallbackPreset(
  sliders: EnergySliders
): { name: FallbackPresetName; spec: ShipSpecification } {
  const affinity: Record<FallbackPresetName, number> = {
    striker: sliders.offense,
    interceptor: sliders.speed + sliders.tech * 0.5,
    vanguard: sliders.defense + sliders.tech * 0.5
  };

  // Ordem fixa garante desempate determinístico.
  const order: FallbackPresetName[] = ['striker', 'interceptor', 'vanguard'];
  let name: FallbackPresetName = order[0];
  for (const candidate of order) {
    if (affinity[candidate] > affinity[name]) name = candidate;
  }

  return { name, spec: structuredClone(FALLBACK_PRESETS[name]) };
}
