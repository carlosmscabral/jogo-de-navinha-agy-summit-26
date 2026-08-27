import { describe, it, expect } from 'vitest';
import {
  BALANCE,
  EnergySliders,
  McpServerName,
  SynergyName,
  applySynergies,
  FALLBACK_PRESETS
} from '@jogo/shared';
import { detectSynergyPreview, SYNERGY_EFFECTS } from './synergy-preview';

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
    expect(r.label).toBe('⚡ Glass Cannon (+30% dano · casco 2)');
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

/**
 * `SYNERGY_EFFECTS` é a promessa que o visitante lê. `BALANCE.synergies` é o que
 * `applySynergies` executa. Estes testes existem porque as duas já divergiram uma vez: o crachá
 * anunciava "+20% Esquiva" e "+25% Blindagem" para efeitos que o balance nunca teve.
 */
describe('SYNERGY_EFFECTS', () => {
  /** `'Glass Cannon'` → `'glass_cannon'`, a chave correspondente em `BALANCE.synergies`. */
  function balanceKey(name: SynergyName): string {
    return name.toLowerCase().replace(/ /g, '_');
  }

  it('descreve exatamente as sinergias que o balance define', () => {
    const described = Object.keys(SYNERGY_EFFECTS).map((n) => balanceKey(n as SynergyName)).sort();
    expect(described).toEqual(Object.keys(BALANCE.synergies).sort());
  });

  it('não cita nenhum percentual que não venha de um fator do balance', () => {
    // Todo `*_factor` declarado no balance, virado em percentual do mesmo jeito que a UI faz.
    const permitido = new Set(
      Object.values(BALANCE.synergies as Record<string, Record<string, unknown>>)
        .flatMap((s) => Object.entries(s))
        .filter(([k, v]) => k.endsWith('_factor') && typeof v === 'number')
        .map(([, v]) => `+${Math.round(((v as number) - 1) * 100)}%`)
    );

    for (const [name, { effect }] of Object.entries(SYNERGY_EFFECTS)) {
      for (const cited of effect.match(/\+\d+%/g) ?? []) {
        expect(permitido, `${name} promete ${cited}, que não existe em BALANCE.synergies`)
          .toContain(cited);
      }
    }
  });

  it('descreve a Ghost Interceptor pelos extremos reais das faixas, não por esquiva', () => {
    // Ela não dá "+20% esquiva": trava velocidade no máximo e hitbox no mínimo (synergies.ts:69).
    expect(SYNERGY_EFFECTS['Ghost Interceptor'].effect).toContain(
      String(BALANCE.ranges['attributes.speed_px_s'].max)
    );
    expect(SYNERGY_EFFECTS['Ghost Interceptor'].effect).toContain(
      String(BALANCE.ranges['attributes.hitbox_radius'].min)
    );
    expect(SYNERGY_EFFECTS['Ghost Interceptor'].effect).not.toMatch(/%/);
  });

  it('descreve a Titan Fortress pelo casco travado, piso de escudo e regeneração', () => {
    const { effect } = SYNERGY_EFFECTS['Titan Fortress'];
    const s = BALANCE.synergies.titan_fortress;
    expect(effect).toContain(String(s.forced_max_hp));
    expect(effect).toContain(String(s.min_shield_capacity));
    expect(effect).toContain(`${s.regen_interval_s}s`);
    expect(effect).not.toMatch(/%/);
  });

  it('não deixa nenhuma descrição vazia', () => {
    for (const [name, { icon, effect }] of Object.entries(SYNERGY_EFFECTS)) {
      expect(icon.length, `${name} sem ícone`).toBeGreaterThan(0);
      expect(effect.trim().length, `${name} sem descrição`).toBeGreaterThan(0);
    }
  });
});
