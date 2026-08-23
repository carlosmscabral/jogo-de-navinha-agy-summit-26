import { describe, it, expect } from 'vitest';
import { mergeLeaderboardState, pickSource } from './firestore-source.js';
import type { MatchDocument, CompanyRankingDocument } from '@jogo/shared';

function makeMatch(overrides: Partial<MatchDocument> = {}): MatchDocument {
  return {
    schema_version: 1,
    match_id: overrides.match_id ?? 'match-default',
    pilot_id: 'pilot-1',
    callsign: 'CALLSIGN',
    company_raw: 'Acme',
    company_canonical: 'ACME',
    company_confidence: 1,
    final_score: 0,
    score_breakdown: {} as MatchDocument['score_breakdown'],
    telemetry: {} as MatchDocument['telemetry'],
    ship_spec_snapshot: {} as MatchDocument['ship_spec_snapshot'],
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

function makeRanking(overrides: Partial<CompanyRankingDocument> = {}): CompanyRankingDocument {
  return {
    schema_version: 1,
    company_canonical: 'ACME',
    total_score: 0,
    pilots_count: 1,
    top_individual_score: 0,
    last_updated: '2026-01-01T00:00:00.000Z',
    ...overrides
  };
}

describe('mergeLeaderboardState', () => {
  it('ordena o top 10 por score decrescente', () => {
    const matches = [
      makeMatch({ match_id: 'a', final_score: 100 }),
      makeMatch({ match_id: 'b', final_score: 500 }),
      makeMatch({ match_id: 'c', final_score: 250 })
    ];

    const s = mergeLeaderboardState(matches, []);

    expect(s.topPilots.map((p) => p.match_id)).toEqual(['b', 'c', 'a']);
    expect(s.topPilots[0].rank).toBe(1);
    expect(s.topPilots[1].rank).toBe(2);
    expect(s.topPilots[2].rank).toBe(3);
  });

  it('trunca o hall da fama em 10 e o corporativo em 5', () => {
    const matches = Array.from({ length: 15 }, (_, i) =>
      makeMatch({ match_id: `m${i}`, final_score: i })
    );
    const rankings = Array.from({ length: 8 }, (_, i) =>
      makeRanking({ company_canonical: `COMPANY_${i}`, total_score: i })
    );

    const s = mergeLeaderboardState(matches, rankings);

    expect(s.topPilots).toHaveLength(10);
    expect(s.companyRankings).toHaveLength(5);
    // Highest scores/totals survive the truncation.
    expect(s.topPilots[0].match_id).toBe('m14');
    expect(s.companyRankings[0].company_canonical).toBe('COMPANY_7');
  });

  it('ordena o ticker pelas partidas mais recentes', () => {
    const matches = [
      makeMatch({ match_id: 'old', created_at: '2026-01-01T00:00:00.000Z', final_score: 999 }),
      makeMatch({ match_id: 'new', created_at: '2026-01-03T00:00:00.000Z', final_score: 1 }),
      makeMatch({ match_id: 'mid', created_at: '2026-01-02T00:00:00.000Z', final_score: 2 })
    ];

    const s = mergeLeaderboardState(matches, []);

    expect(s.recentMatches.map((m) => m.match_id)).toEqual(['new', 'mid', 'old']);
  });

  it('trunca o ticker em 12 partidas recentes', () => {
    const matches = Array.from({ length: 20 }, (_, i) =>
      makeMatch({
        match_id: `m${i}`,
        created_at: new Date(2026, 0, i + 1).toISOString(),
        final_score: i
      })
    );

    const s = mergeLeaderboardState(matches, []);

    expect(s.recentMatches).toHaveLength(12);
    expect(s.recentMatches[0].match_id).toBe('m19');
  });

  it('sobrevive a uma coleção vazia sem quebrar as estatísticas', () => {
    const s = mergeLeaderboardState([], []);
    expect(s.stats.top_score).toBe(0);
    expect(s.topPilots).toEqual([]);
    expect(s.companyRankings).toEqual([]);
    expect(s.recentMatches).toEqual([]);
    expect(s.stats.total_matches).toBe(0);
    expect(s.stats.total_pilots).toBe(0);
  });

  it('calcula total_pilots como a contagem de pilotos distintos e top_score como o maior score', () => {
    const matches = [
      makeMatch({ match_id: 'a', pilot_id: 'p1', final_score: 100 }),
      makeMatch({ match_id: 'b', pilot_id: 'p1', final_score: 200 }),
      makeMatch({ match_id: 'c', pilot_id: 'p2', final_score: 50 })
    ];

    const s = mergeLeaderboardState(matches, []);

    expect(s.stats.total_pilots).toBe(2);
    expect(s.stats.total_matches).toBe(3);
    expect(s.stats.top_score).toBe(200);
  });
});

describe('pickSource', () => {
  it('prefere a nuvem quando o Firestore está configurado e responde', () => {
    expect(pickSource('offline', 'CLOUD_SNAPSHOT')).toBe('cloud');
  });

  it('cai para o bridge local quando o Firestore não entrega snapshot no prazo', () => {
    expect(pickSource('cloud', 'CLOUD_TIMEOUT')).toBe('local');
    expect(pickSource('offline', 'CLOUD_TIMEOUT')).toBe('local');
  });

  it('cai para o bridge local quando o Firestore reporta erro', () => {
    expect(pickSource('cloud', 'CLOUD_ERROR')).toBe('local');
  });

  it('sinaliza offline quando nenhuma das duas fontes responde', () => {
    expect(pickSource('local', 'LOCAL_FAILURE')).toBe('offline');
    expect(pickSource('offline', 'LOCAL_FAILURE')).toBe('offline');
  });

  it('permanece local quando o bridge local entrega dados com sucesso', () => {
    expect(pickSource('local', 'LOCAL_SNAPSHOT')).toBe('local');
    expect(pickSource('offline', 'LOCAL_SNAPSHOT')).toBe('local');
  });

  it('volta para a nuvem sozinho quando o Firestore reaparece', () => {
    expect(pickSource('local', 'CLOUD_SNAPSHOT')).toBe('cloud');
    expect(pickSource('offline', 'CLOUD_SNAPSHOT')).toBe('cloud');
  });

  it('ignora um snapshot local tardio depois que a nuvem já assumiu', () => {
    expect(pickSource('cloud', 'LOCAL_SNAPSHOT')).toBe('cloud');
  });

  it('ignora uma falha local tardia depois que a nuvem já assumiu', () => {
    expect(pickSource('cloud', 'LOCAL_FAILURE')).toBe('cloud');
  });
});
