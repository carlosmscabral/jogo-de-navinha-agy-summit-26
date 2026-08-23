import { describe, it, expect } from 'vitest';
import { buildMatchRecord } from './match-record.js';
import { FALLBACK_PRESETS } from '@jogo/shared';
import type { MatchTelemetry, PilotInfo, ScoreBreakdown } from '@jogo/shared';

function fakeTelemetry(): MatchTelemetry {
  return {
    duration_s: 90,
    enemies_killed: 20,
    boss_defeated: true,
    damage_taken: 1,
    accuracy_pct: 70,
    shots_fired: 100,
    shots_hit: 70,
    fallback_used: false,
    seed: 42,
    boss_ttk_s: 30,
    boss_fight_min_fps: 59.5,
    boss_damage_dealt: 500,
    boss_phase_reached: 3
  };
}

function fakeBreakdown(): ScoreBreakdown {
  return {
    combatScore: 1000,
    bossBonus: 500,
    timeBonus: 100,
    survivalBonus: 50,
    bossDamageBonus: 0,
    bossPhaseBonus: 0,
    synergyBonus: 0,
    mcpMultiplier: 1.1
  };
}

describe('buildMatchRecord', () => {
  it('inclui company_raw, company_confidence e score_breakdown no registro enviado a POST /api/matches', () => {
    const pilot: PilotInfo = {
      callsign: 'CYBER_ACE',
      company_raw: 'gogle',
      company_canonical: 'Google',
      company_confidence: 0.82
    };
    const breakdown = fakeBreakdown();

    const record = buildMatchRecord(pilot, 'pilot-123', FALLBACK_PRESETS.interceptor, {
      finalScore: 5000,
      victory: true,
      breakdown,
      telemetry: fakeTelemetry()
    });

    expect(record.company_raw).toBe('gogle');
    expect(record.company_confidence).toBe(0.82);
    expect(record.score_breakdown).toEqual(breakdown);
    // O nome antigo do campo não deve sobreviver ao rename.
    expect((record as unknown as { breakdown?: unknown }).breakdown).toBeUndefined();
  });

  it('assume confiança 1.0 quando o piloto ainda não recebeu confiança do daemon', () => {
    const pilot: PilotInfo = {
      callsign: 'CYBER_ACE',
      company_raw: 'Google',
      company_canonical: 'Google'
      // company_confidence ausente de propósito -- estado inicial antes do primeiro
      // round-trip de /api/session/start.
    };

    const record = buildMatchRecord(pilot, 'pilot-123', FALLBACK_PRESETS.interceptor, {
      finalScore: 1,
      victory: false,
      breakdown: fakeBreakdown(),
      telemetry: fakeTelemetry()
    });

    expect(record.company_confidence).toBe(1.0);
  });

  it('preserva o campo victory, ainda lido pela DebriefScreen', () => {
    const pilot: PilotInfo = { callsign: 'X', company_raw: 'Y', company_canonical: 'Y' };
    const record = buildMatchRecord(pilot, 'pilot-1', FALLBACK_PRESETS.interceptor, {
      finalScore: 1,
      victory: true,
      breakdown: fakeBreakdown(),
      telemetry: fakeTelemetry()
    });

    expect(record.victory).toBe(true);
  });

  it('gera um match_id novo (UUID v4) a cada chamada', () => {
    const pilot: PilotInfo = { callsign: 'X', company_raw: 'Y', company_canonical: 'Y' };
    const args = [pilot, 'pilot-1', FALLBACK_PRESETS.interceptor, {
      finalScore: 1,
      victory: true,
      breakdown: fakeBreakdown(),
      telemetry: fakeTelemetry()
    }] as const;

    const a = buildMatchRecord(...args);
    const b = buildMatchRecord(...args);
    expect(a.match_id).not.toEqual(b.match_id);
  });
});
