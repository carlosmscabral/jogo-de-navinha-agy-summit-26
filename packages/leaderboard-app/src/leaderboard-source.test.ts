import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mergeLeaderboardState,
  pickSource,
  applyAccurateCounts,
  subscribeWithRetry,
  subscribeToLeaderboard,
  type SourceStatus
} from './firestore-source.js';
import type { MatchDocument, CompanyRankingDocument } from '@jogo/shared';

/** A minimal stand-in for a Firestore `Timestamp` — only `.toDate()` is used by the code under test. */
function fakeTimestamp(iso: string): { toDate: () => Date } {
  return { toDate: () => new Date(iso) };
}

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

  it('exclui partidas anuladas (voided) do hall da fama e do ticker (Tarefa C7)', () => {
    const matches = [
      makeMatch({
        match_id: 'recordista-anulado',
        pilot_id: 'p1',
        final_score: 999_999,
        created_at: '2026-01-05T00:00:00.000Z',
        voided: true
      }),
      makeMatch({ match_id: 'legitima-1', pilot_id: 'p2', final_score: 500, created_at: '2026-01-01T00:00:00.000Z' }),
      makeMatch({ match_id: 'legitima-2', pilot_id: 'p3', final_score: 300, created_at: '2026-01-02T00:00:00.000Z' })
    ];

    const s = mergeLeaderboardState(matches, []);

    expect(s.topPilots.map((p) => p.match_id)).not.toContain('recordista-anulado');
    expect(s.topPilots.map((p) => p.match_id)).toEqual(['legitima-1', 'legitima-2']);
    expect(s.recentMatches.map((m) => m.match_id)).not.toContain('recordista-anulado');
    expect(s.recentMatches.map((m) => m.match_id)).toEqual(['legitima-2', 'legitima-1']);
    expect(s.stats.top_score).toBe(500);
    expect(s.stats.total_matches).toBe(2);
    expect(s.stats.total_pilots).toBe(2);
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

describe('applyAccurateCounts', () => {
  it('substitui total_matches e total_pilots, preservando o resto do estado intacto', () => {
    const base = mergeLeaderboardState(
      [makeMatch({ match_id: 'a', pilot_id: 'p1', final_score: 500 })],
      [makeRanking({ company_canonical: 'ACME', total_score: 500 })]
    );

    const result = applyAccurateCounts(base, { total_matches: 240, total_pilots: 87 });

    expect(result.stats.total_matches).toBe(240);
    expect(result.stats.total_pilots).toBe(87);
    // top_score comes from the exact "top by score" query, not the estimate — untouched.
    expect(result.stats.top_score).toBe(base.stats.top_score);
    expect(result.topPilots).toEqual(base.topPilots);
    expect(result.companyRankings).toEqual(base.companyRankings);
    expect(result.recentMatches).toEqual(base.recentMatches);
  });

  it('funciona mesmo sobre um estado vazio', () => {
    const base = mergeLeaderboardState([], []);
    const result = applyAccurateCounts(base, { total_matches: 1000, total_pilots: 300 });
    expect(result.stats).toEqual({ total_matches: 1000, total_pilots: 300, top_score: 0 });
  });
});

describe('subscribeWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('entrega dados normalmente quando a assinatura nunca falha', () => {
    const onNext = vi.fn();
    subscribeWithRetry<number>({
      subscribe: (next) => {
        next(1);
        return () => {};
      },
      onNext,
      onError: vi.fn()
    });
    expect(onNext).toHaveBeenCalledWith(1);
  });

  it('depois de um erro permanente do onSnapshot, tenta de novo após o backoff e volta a entregar dados — sem intervenção do chamador', () => {
    let attempts = 0;
    const onNext = vi.fn();
    const onError = vi.fn();

    subscribeWithRetry<number>({
      subscribe: (next, err) => {
        attempts += 1;
        if (attempts === 1) {
          err(new Error('permission hiccup'));
        } else {
          next(42);
        }
        return () => {};
      },
      onNext,
      onError,
      baseDelayMs: 1000,
      maxDelayMs: 4000
    });

    // Primeira tentativa falha; nada foi entregue ainda.
    expect(attempts).toBe(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onNext).not.toHaveBeenCalled();

    // O wrapper reagenda sozinho, sem o chamador fazer nada.
    vi.advanceTimersByTime(1000);

    expect(attempts).toBe(2);
    expect(onNext).toHaveBeenCalledWith(42);
  });

  it('dobra o backoff a cada falha consecutiva, até o teto de maxDelayMs', () => {
    let attempts = 0;
    subscribeWithRetry<number>({
      subscribe: (_next, err) => {
        attempts += 1;
        err(new Error('still broken'));
        return () => {};
      },
      onNext: vi.fn(),
      onError: vi.fn(),
      baseDelayMs: 1000,
      maxDelayMs: 3000
    });

    expect(attempts).toBe(1);
    vi.advanceTimersByTime(1000); // 2ª tentativa: delay base (1000ms)
    expect(attempts).toBe(2);
    vi.advanceTimersByTime(2000); // 3ª tentativa: delay dobrado (2000ms)
    expect(attempts).toBe(3);
    vi.advanceTimersByTime(3000); // 4ª tentativa: teto de 3000ms (dobraria para 4000)
    expect(attempts).toBe(4);
  });

  it('para de tentar de novo depois que o cancelamento é chamado', () => {
    let attempts = 0;
    const unsubscribe = subscribeWithRetry<number>({
      subscribe: (_next, err) => {
        attempts += 1;
        err(new Error('boom'));
        return () => {};
      },
      onNext: vi.fn(),
      onError: vi.fn(),
      baseDelayMs: 1000
    });

    expect(attempts).toBe(1);
    unsubscribe();
    vi.advanceTimersByTime(60_000);
    expect(attempts).toBe(1);
  });

  it('reseta o backoff depois de uma entrega bem-sucedida: uma falha subsequente na mesma inscrição tenta de novo no delay base', () => {
    let subscribeCalls = 0;
    let capturedErr: ((e: unknown) => void) | null = null;
    const onNext = vi.fn();

    subscribeWithRetry<number>({
      subscribe: (next, err) => {
        subscribeCalls += 1;
        capturedErr = err;
        next(subscribeCalls); // toda (re)inscrição, aqui, entrega com sucesso de cara
        return () => {};
      },
      onNext,
      onError: vi.fn(),
      baseDelayMs: 1000,
      maxDelayMs: 8000
    });

    expect(subscribeCalls).toBe(1);
    expect(onNext).toHaveBeenCalledWith(1);

    // A MESMA inscrição, já bem-sucedida, mais tarde chama seu callback de
    // erro — comportamento real do onSnapshot: um erro pode vir depois de
    // vários snapshots bem-sucedidos na mesma inscrição, não só na primeira
    // tentativa.
    capturedErr!(new Error('later permanent error'));

    // Se o backoff não tivesse sido resetado por aquele sucesso anterior, o
    // próximo retry só dispararia depois de mais que baseDelayMs. Como foi
    // resetado, baseDelayMs (1000ms) já é suficiente.
    vi.advanceTimersByTime(1000);
    expect(subscribeCalls).toBe(2);
  });

  it('recupera a fonte sozinho para "cloud" depois de um erro permanente do onSnapshot, sem o chamador fazer nada', () => {
    let status: SourceStatus = 'offline';
    let callCount = 0;

    subscribeWithRetry<string>({
      subscribe: (next, err) => {
        callCount += 1;
        if (callCount === 1) {
          err(new Error('permission-denied'));
        } else {
          next('snapshot-data');
        }
        return () => {};
      },
      onNext: () => {
        status = pickSource(status, 'CLOUD_SNAPSHOT');
      },
      onError: () => {
        status = pickSource(status, 'CLOUD_ERROR');
      },
      baseDelayMs: 1000
    });

    // O erro permanente derruba para local...
    expect(status).toBe('local');

    // ...e o wrapper reinscreve sozinho depois do backoff, sem o chamador
    // precisar reagir ao erro manualmente.
    vi.advanceTimersByTime(1000);

    expect(status).toBe('cloud');
  });
});

// ---------------------------------------------------------------------------
// subscribeToLeaderboard — Firestore `onSnapshot` mocked, exercises the actual
// watchdog wiring (Finding 3) and the Timestamp-to-ISO read boundary (Finding 2),
// neither of which `pickSource`/`subscribeWithRetry`'s isolated tests above cover.
// ---------------------------------------------------------------------------

type FakeSnapshotHandler = { next: (v: any) => void; error: (e: any) => void };

const onSnapshotHandlers: FakeSnapshotHandler[] = [];

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({}))
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  collection: vi.fn((_db: unknown, name: string) => ({ __collection: name })),
  query: vi.fn((...args: unknown[]) => args[0]),
  orderBy: vi.fn(),
  limit: vi.fn(),
  onSnapshot: vi.fn((_query: unknown, onNext: (v: any) => void, onError: (e: any) => void) => {
    onSnapshotHandlers.push({ next: onNext, error: onError });
    return () => {};
  }),
  getCountFromServer: vi.fn(async () => ({ data: () => ({ count: 0 }) }))
}));

function fakeMatchSnapshot(docsData: unknown[]) {
  return {
    docs: docsData.map((data) => ({ data: () => data })),
    docChanges: () => []
  };
}

describe('subscribeToLeaderboard (Firestore mockado)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'test-project');
    onSnapshotHandlers.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('Finding 3: não cai para o bridge local durante silêncio normal depois do snapshot inicial', () => {
    const onSourceChange = vi.fn();
    const unsubscribe = subscribeToLeaderboard({ onData: vi.fn(), onSourceChange });

    // As três queries (score, recência, rankings) entregam seu primeiro snapshot.
    onSnapshotHandlers.forEach((h) => h.next(fakeMatchSnapshot([])));
    expect(onSourceChange).toHaveBeenCalledWith('cloud');

    onSourceChange.mockClear();
    // Bem além do antigo watchdog de 5s — um intervalo real entre partidas no estande.
    vi.advanceTimersByTime(60_000);

    expect(onSourceChange).not.toHaveBeenCalledWith('local');

    unsubscribe();
  });

  it('Finding 3: ainda cai para o bridge local se o PRIMEIRO snapshot nunca chegar', () => {
    const onSourceChange = vi.fn();
    const unsubscribe = subscribeToLeaderboard({ onData: vi.fn(), onSourceChange });

    // Nenhum onSnapshotHandlers[].next() é chamado — simula a conexão inicial nunca completando.
    vi.advanceTimersByTime(5_000);

    expect(onSourceChange).toHaveBeenCalledWith('local');

    unsubscribe();
  });

  it('Finding 2: converte um created_at Timestamp do Firestore em ISO antes de emitir o estado', () => {
    const onData = vi.fn();
    const unsubscribe = subscribeToLeaderboard({ onData, onSourceChange: vi.fn() });

    const matchWithTimestamp: MatchDocument = {
      schema_version: 1,
      match_id: 'm1',
      pilot_id: 'p1',
      callsign: 'CALLSIGN',
      company_raw: 'Acme',
      company_canonical: 'ACME',
      company_confidence: 1,
      final_score: 100,
      score_breakdown: {} as MatchDocument['score_breakdown'],
      telemetry: {} as MatchDocument['telemetry'],
      ship_spec_snapshot: {} as MatchDocument['ship_spec_snapshot'],
      created_at: fakeTimestamp('2026-08-22T10:00:00.000Z') as unknown as string
    };

    // Todas as 3 queries usam a mesma fixture de snapshot aqui — só a de score/recência carrega matches.
    onSnapshotHandlers.forEach((h) => h.next(fakeMatchSnapshot([matchWithTimestamp])));

    const lastState = onData.mock.calls.at(-1)![0];
    expect(lastState.topPilots).toHaveLength(1);
    expect(typeof lastState.topPilots[0].created_at).toBe('string');
    expect(Number.isNaN(Date.parse(lastState.topPilots[0].created_at))).toBe(false);
    expect(lastState.topPilots[0].created_at).toBe('2026-08-22T10:00:00.000Z');

    unsubscribe();
  });
});
