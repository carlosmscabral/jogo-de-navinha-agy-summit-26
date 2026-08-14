import { describe, it, expect } from 'vitest';
import { EnergySliders, McpServerName, applySynergies, FALLBACK_PRESETS } from '@jogo/shared';
import { detectSynergyPreview } from './synergy-preview';

const ALL_MCPS: McpServerName[] = ['weapons-arsenal', 'hull-propulsion', 'cybernetics-shields'];
const NO_SHIELDS: McpServerName[] = ['weapons-arsenal', 'hull-propulsion'];

function sliders(partial: Partial<EnergySliders>): EnergySliders {
  return { offense: 25, speed: 25, defense: 25, tech: 25, ...partial };
}

describe('detectSynergyPreview', () => {
  it('promete o bônus quando o MCP dono está selecionado', () => {
    const r = detectSynergyPreview(sliders({ offense: 45, speed: 25, defense: 15, tech: 15 }), ALL_MCPS);
    expect(r.unlocked).toBe(true);
    expect(r.none).toBe(false);
    expect(r.label).toBe('⚡ Glass Cannon (+30% DPS)');
  });

  it('nunca promete um bônus numérico quando cybernetics-shields não foi selecionado', () => {
    // A regressão que este teste trava: o crachá anunciava "+30% DPS" para qualquer build cujos
    // sliders batessem, mesmo sem o MCP que é o único capaz de desbloquear a sinergia -- e desde
    // a correção da revisão final da branch, essa build voa SEM sinergia e SEM o bônus de placar.
    for (const preset of [
      { offense: 45, speed: 25, defense: 15, tech: 15 },
      { offense: 25, speed: 45, defense: 15, tech: 15 },
      { offense: 15, speed: 20, defense: 45, tech: 20 },
      { offense: 25, speed: 25, defense: 25, tech: 25 }
    ]) {
      const r = detectSynergyPreview(sliders(preset), NO_SHIELDS);
      expect(r.unlocked).toBe(false);
      expect(r.label).toContain('🔒');
      expect(r.label).toContain('requer cybernetics-shields');
      expect(r.label).not.toMatch(/\+\d+%/);
    }
  });

  it('mostra a sinergia bloqueada pelo nome, para que a escolha do MCP seja informada', () => {
    const r = detectSynergyPreview(sliders({ offense: 15, speed: 20, defense: 45, tech: 20 }), NO_SHIELDS);
    expect(r.label).toContain('Titan Fortress');
  });

  it('cai para "Custom Build" quando nenhum limiar é atingido, com ou sem o MCP', () => {
    const off = sliders({ offense: 35, speed: 35, defense: 15, tech: 15 });
    for (const mcps of [ALL_MCPS, NO_SHIELDS]) {
      const r = detectSynergyPreview(off, mcps);
      expect(r.none).toBe(true);
      expect(r.unlocked).toBe(false);
      expect(r.label).toBe('Custom Build');
    }
  });

  it('só promete o que a engine entrega: build sem o MCP dono não recebe sinergia nenhuma', () => {
    // Amarra o crachá ao comportamento real de `applySynergies` em vez de a uma string.
    const preview = detectSynergyPreview(sliders({ offense: 45, speed: 25, defense: 15, tech: 15 }), NO_SHIELDS);

    const shipWithoutShieldsMcp = structuredClone(FALLBACK_PRESETS.interceptor);
    shipWithoutShieldsMcp.build_metadata.selected_mcps = [...NO_SHIELDS];
    // O que o daemon entrega para esta seleção (applyBaselineForUnselectedMcps zera o campo).
    shipWithoutShieldsMcp.build_metadata.synergies_unlocked = [];

    expect(applySynergies(shipWithoutShieldsMcp).applied).toEqual([]);
    expect(preview.unlocked).toBe(false);
  });
});
