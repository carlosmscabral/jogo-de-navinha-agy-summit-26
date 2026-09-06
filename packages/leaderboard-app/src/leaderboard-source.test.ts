import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mergeLeaderboardState,
  pickSource,
  applyAccurateCounts,
  subscribeWithRetry,
  subscribeToLeaderboard,
  type SourceStatus
} from './firestore-source.js';
import {
  enqueueCelebration,
  isCelebrationWorthy,
  CELEBRATION_QUEUE_MAX,
  type Celebration
} from './celebration-queue.js';
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

/**
 * Dois estandes tornam empate e fila drenada em atraso eventos rotineiros, não curiosidades.
 * Estes testes travam as duas coisas que o visitante enxerga: a ordem do pódio não pode oscilar
 * entre as duas TVs, e o "LIVE FEED" não pode ser tomado por partidas velhas.
 */
describe('mergeLeaderboardState — dois estandes', () => {
  it('desempata score igual pela partida mais antiga', () => {
    const matches = [
      makeMatch({ match_id: 'booth-b', final_score: 5000, created_at: '2026-01-01T10:05:00.000Z' }),
      makeMatch({ match_id: 'booth-a', final_score: 5000, created_at: '2026-01-01T10:00:00.000Z' })
    ];

    const s = mergeLeaderboardState(matches, []);

    expect(s.topPilots.map((p) => p.match_id)).toEqual(['booth-a', 'booth-b']);
  });

  it('desempata score E horário iguais pelo match_id, para as duas TVs concordarem', () => {
    // O caso real: os dois Macs enviam, a nuvem carimba `created_at` com o MESMO
    // `serverTimestamp` e o único critério que resta tem que ser total.
    const mesmoInstante = '2026-01-01T10:00:00.000Z';
    const matches = [
      makeMatch({ match_id: 'zzz', final_score: 5000, created_at: mesmoInstante }),
      makeMatch({ match_id: 'aaa', final_score: 5000, created_at: mesmoInstante })
    ];

    const direta = mergeLeaderboardState(matches, []);
    const invertida = mergeLeaderboardState([...matches].reverse(), []);

    expect(direta.topPilots.map((p) => p.match_id)).toEqual(['aaa', 'zzz']);
    expect(invertida.topPilots.map((p) => p.match_id)).toEqual(['aaa', 'zzz']);
  });

  it('a ordem do pódio não depende da ordem em que os dois snapshots chegaram', () => {
    // A entrada real vem de um Map que mescla o snapshot por score com o por recência, e a ordem
    // de inserção nesse Map muda conforme qual dos dois listeners entregou por último.
    const matches = [
      makeMatch({ match_id: 'c', final_score: 100, created_at: '2026-01-01T00:00:03.000Z' }),
      makeMatch({ match_id: 'a', final_score: 100, created_at: '2026-01-01T00:00:01.000Z' }),
      makeMatch({ match_id: 'b', final_score: 100, created_at: '2026-01-01T00:00:02.000Z' })
    ];

    const esperado = ['a', 'b', 'c'];
    for (const permutacao of [matches, [...matches].reverse(), [matches[1], matches[0], matches[2]]]) {
      expect(mergeLeaderboardState(permutacao, []).topPilots.map((p) => p.match_id)).toEqual(esperado);
    }
  });

  it('ordena o ticker por played_at, não pela hora em que a nuvem ingeriu', () => {
    // O estande B ficou sem rede e drenou a fila agora: `created_at` é recentíssimo, mas as
    // partidas são antigas. Sem isto, o "LIVE FEED" abre com dez partidas velhas no topo.
    const matches = [
      makeMatch({
        match_id: 'drenada-atrasada',
        played_at: '2026-01-01T09:00:00.000Z',
        created_at: '2026-01-01T12:00:00.000Z'
      }),
      makeMatch({
        match_id: 'acabou-de-jogar',
        played_at: '2026-01-01T11:59:00.000Z',
        created_at: '2026-01-01T11:59:05.000Z'
      })
    ];

    const s = mergeLeaderboardState(matches, []);

    expect(s.recentMatches.map((m) => m.match_id)).toEqual(['acabou-de-jogar', 'drenada-atrasada']);
  });

  it('cai para created_at nas partidas anteriores ao played_at, sem misturar as duas escalas', () => {
    const matches = [
      makeMatch({ match_id: 'antiga-sem-campo', created_at: '2026-01-01T10:00:00.000Z' }),
      makeMatch({
        match_id: 'nova-com-campo',
        played_at: '2026-01-01T11:00:00.000Z',
        created_at: '2026-01-01T11:00:02.000Z'
      })
    ];

    const s = mergeLeaderboardState(matches, []);

    expect(s.recentMatches.map((m) => m.match_id)).toEqual(['nova-com-campo', 'antiga-sem-campo']);
  });

  it('leva played_at até o ticker, que é quem mostra o horário na TV', () => {
    const s = mergeLeaderboardState(
      [makeMatch({ match_id: 'm', played_at: '2026-01-01T09:00:00.000Z', created_at: '2026-01-01T12:00:00.000Z' })],
      []
    );

    expect(s.recentMatches[0].played_at).toBe('2026-01-01T09:00:00.000Z');
  });

  it('uma data ilegível não embaralha o ticker inteiro', () => {
    const matches = [
      makeMatch({ match_id: 'torta', created_at: 'não é data' }),
      makeMatch({ match_id: 'boa', created_at: '2026-01-01T10:00:00.000Z' })
    ];

    const s = mergeLeaderboardState(matches, []);

    expect(s.recentMatches.map((m) => m.match_id)).toEqual(['boa', 'torta']);
  });
});

describe('fila de celebração', () => {
  const entry = (id: string, rank = 1): Celebration => ({
    match: {
      match_id: id,
      callsign: id.toUpperCase(),
      company_canonical: 'ACME',
      final_score: 1000,
      created_at: '2026-01-01T00:00:00.000Z'
    },
    rank
  });

  it('não perde nenhum item numa rajada dentro dos 7s do modal', () => {
    // O caso que motivou a fila: os dois estandes fecham partida quase juntos, e o slot único
    // fazia a segunda celebração apagar a primeira no meio da animação.
    let queue: Celebration[] = [];
    queue = enqueueCelebration(queue, entry('booth-a'));
    queue = enqueueCelebration(queue, entry('booth-b'));

    expect(queue.map((c) => c.match.match_id)).toEqual(['booth-a', 'booth-b']);
  });

  it('descarta duplicata pelo match_id — uma reinscrição do listener reentrega tudo como added', () => {
    let queue = enqueueCelebration([], entry('m1'));
    const mesmaReferencia = enqueueCelebration(queue, entry('m1'));

    expect(mesmaReferencia).toBe(queue);
    expect(mesmaReferencia).toHaveLength(1);
  });

  it('para de enfileirar no teto, em vez de sequestrar o telão por minutos', () => {
    let queue: Celebration[] = [];
    for (let i = 0; i < CELEBRATION_QUEUE_MAX + 3; i++) {
      queue = enqueueCelebration(queue, entry(`m${i}`));
    }

    expect(queue).toHaveLength(CELEBRATION_QUEUE_MAX);
    expect(queue[0].match.match_id).toBe('m0');
  });

  it('preserva o rank de cada item — a fila não é só uma lista de partidas', () => {
    let queue = enqueueCelebration([], entry('primeiro', 1));
    queue = enqueueCelebration(queue, entry('terceiro', 3));

    expect(queue.map((c) => c.rank)).toEqual([1, 3]);
  });

  it('só o pódio celebra; fora do top 3 e fora do top 10 não entram', () => {
    expect(isCelebrationWorthy(1)).toBe(true);
    expect(isCelebrationWorthy(3)).toBe(true);
    expect(isCelebrationWorthy(4)).toBe(false);
    // 0 é o que a fonte devolve quando a partida não entrou no top 10 — nunca um "rank válido".
    expect(isCelebrationWorthy(0)).toBe(false);
  });
});

describe('pickSource', () => {
  it('prefere a nuvem quando o Firestore está configurado e responde', () => {
    expect(pickSource('offline', 'CLOUD_SNAPSHOT')).toBe('cloud');
  });

  it('acusa SEM SINAL quando o Firestore não entrega o snapshot inicial no prazo', () => {
    expect(pickSource('cloud', 'CLOUD_TIMEOUT')).toBe('offline');
    expect(pickSource('offline', 'CLOUD_TIMEOUT')).toBe('offline');
  });

  it('acusa SEM SINAL quando o Firestore reporta erro', () => {
    expect(pickSource('cloud', 'CLOUD_ERROR')).toBe('offline');
  });

  it('acusa SEM SINAL quando o snapshot passa a vir do cache — rede caída', () => {
    // O caso que motivou o evento CLOUD_CACHE: perder a rede não chama o callback de erro do
    // onSnapshot, então sem isto o telão exibiria "NUVEM" sobre números congelados. Ver o
    // comentário no topo de firestore-source.ts.
    expect(pickSource('cloud', 'CLOUD_CACHE')).toBe('offline');
  });

  it('volta para a nuvem sozinho no primeiro snapshot que vier do servidor de novo', () => {
    expect(pickSource('offline', 'CLOUD_SNAPSHOT')).toBe('cloud');
  });

  it('reporta a fonte local quando o bridge é a única fonte e entrega dados', () => {
    expect(pickSource('local', 'LOCAL_SNAPSHOT')).toBe('local');
    expect(pickSource('offline', 'LOCAL_SNAPSHOT')).toBe('local');
  });

  it('acusa SEM SINAL quando o bridge, fonte única, para de responder', () => {
    expect(pickSource('local', 'LOCAL_FAILURE')).toBe('offline');
    expect(pickSource('offline', 'LOCAL_FAILURE')).toBe('offline');
  });

  it('NÃO mistura as duas fontes: cada evento decide sozinho, sem olhar o estado anterior', () => {
    // A partir de 2026-08-24 as fontes são exclusivas (Firestore OU bridge, escolhido na
    // montagem). Se alguém reintroduzir uma queda de uma para a outra, os ramos que
    // dependiam de `current` voltam junto — e este teste quebra antes disso passar batido.
    const todos: SourceStatus[] = ['cloud', 'local', 'offline'];
    for (const partida of todos) {
      expect(pickSource(partida, 'CLOUD_SNAPSHOT')).toBe('cloud');
      expect(pickSource(partida, 'LOCAL_SNAPSHOT')).toBe('local');
      expect(pickSource(partida, 'CLOUD_CACHE')).toBe('offline');
      expect(pickSource(partida, 'LOCAL_FAILURE')).toBe('offline');
    }
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
    // (o estado intermediário depois do erro é 'offline' — não há mais segunda fonte)
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

    // O erro permanente derruba o selo para SEM SINAL...
    expect(status).toBe('offline');

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
/** As opções passadas em cada chamada de `onSnapshot`, na ordem — usado para provar o
 *  `includeMetadataChanges`, sem o qual a detecção de rede caída nunca dispara. */
const onSnapshotOptions: unknown[] = [];

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({}))
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  collection: vi.fn((_db: unknown, name: string) => ({ __collection: name })),
  query: vi.fn((...args: unknown[]) => args[0]),
  orderBy: vi.fn(),
  limit: vi.fn(),
  onSnapshot: vi.fn(
    (
      _query: unknown,
      options: unknown,
      onNext: (v: any) => void,
      onError: (e: any) => void
    ) => {
      onSnapshotOptions.push(options);
      onSnapshotHandlers.push({ next: onNext, error: onError });
      return () => {};
    }
  ),
  getCountFromServer: vi.fn(async () => ({ data: () => ({ count: 0 }) }))
}));

function fakeMatchSnapshot(docsData: unknown[], fromCache = false) {
  return {
    docs: docsData.map((data) => ({ data: () => data })),
    docChanges: () => [],
    metadata: { fromCache, hasPendingWrites: false }
  };
}

/** Como `fakeMatchSnapshot`, mas com `docChanges()` de verdade — é o que dispara a celebração. */
function fakeSnapshotWithAdded(docsData: unknown[], addedData: unknown[], fromCache = false) {
  return {
    ...fakeMatchSnapshot(docsData, fromCache),
    docChanges: () => addedData.map((data) => ({ type: 'added', doc: { data: () => data } }))
  };
}

/** Índices dos três listeners, na ordem em que `subscribeToLeaderboard` os registra. */
const SCORE_LISTENER = 0;
const RECENCY_LISTENER = 1;

describe('subscribeToLeaderboard (Firestore mockado)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'test-project');
    onSnapshotHandlers.length = 0;
    onSnapshotOptions.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('Finding 3: não acusa falha durante silêncio normal depois do snapshot inicial', () => {
    const onSourceChange = vi.fn();
    const unsubscribe = subscribeToLeaderboard({ onData: vi.fn(), onSourceChange });

    // As três queries (score, recência, rankings) entregam seu primeiro snapshot.
    onSnapshotHandlers.forEach((h) => h.next(fakeMatchSnapshot([])));
    expect(onSourceChange).toHaveBeenCalledWith('cloud');

    onSourceChange.mockClear();
    // Bem além do antigo watchdog de 5s — um intervalo real entre partidas no estande.
    vi.advanceTimersByTime(60_000);

    expect(onSourceChange).not.toHaveBeenCalled();

    unsubscribe();
  });

  it('Finding 3: continua SEM SINAL, e deixa registro, se o PRIMEIRO snapshot nunca chegar', () => {
    // O selo já nasce 'offline', então o watchdog não tem estado novo a anunciar — por isso
    // `onSourceChange` NÃO é chamado, e a única saída dele é o aviso no console. Ver o
    // comentário em armWatchdog(): ele virou diagnóstico, não correção.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onSourceChange = vi.fn();
    const unsubscribe = subscribeToLeaderboard({ onData: vi.fn(), onSourceChange });

    // Nenhum onSnapshotHandlers[].next() é chamado — simula a conexão inicial nunca completando.
    vi.advanceTimersByTime(5_000);

    expect(onSourceChange).not.toHaveBeenCalledWith('cloud');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('No initial Firestore snapshot')
    );

    warn.mockRestore();
    unsubscribe();
  });

  it('assina com includeMetadataChanges — sem isso, rede caída não gera evento nenhum', () => {
    const unsubscribe = subscribeToLeaderboard({ onData: vi.fn(), onSourceChange: vi.fn() });

    expect(onSnapshotOptions).toHaveLength(3);
    for (const options of onSnapshotOptions) {
      expect(options).toEqual({ includeMetadataChanges: true });
    }

    unsubscribe();
  });

  it('vira SEM SINAL quando os snapshots passam a vir do cache, e volta para NUVEM sozinho', () => {
    // O cenário do Bloco 15: telão hospedado, Wi-Fi cai. O onSnapshot NÃO chama o callback de
    // erro; o SDK só passa a servir do cache. Antes desta correção o selo continuava "NUVEM"
    // sobre números congelados por tempo indeterminado.
    const onData = vi.fn();
    const onSourceChange = vi.fn();
    const unsubscribe = subscribeToLeaderboard({ onData, onSourceChange });

    onSnapshotHandlers.forEach((h) => h.next(fakeMatchSnapshot([])));
    expect(onSourceChange).toHaveBeenLastCalledWith('cloud');

    onData.mockClear();
    onSnapshotHandlers[0].next(fakeMatchSnapshot([], true));
    expect(onSourceChange).toHaveBeenLastCalledWith('offline');
    // Os últimos dados conhecidos continuam sendo emitidos: a tela não esvazia, só o selo muda.
    expect(onData).toHaveBeenCalled();

    onSnapshotHandlers[0].next(fakeMatchSnapshot([], false));
    expect(onSourceChange).toHaveBeenLastCalledWith('cloud');

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

  /**
   * A corrida do rank. `onNewMatch` sai do listener por RECÊNCIA, e o rank vinha do listener por
   * SCORE — dois `onSnapshot` independentes, sem ordem garantida entre eles. Se o de recência
   * chegasse primeiro (metade das vezes, e mais que isso com o dobro de partidas), o rank era
   * calculado sobre um estado que ainda não continha a partida nova: `findIndex` devolvia -1,
   * `rank` virava 0, e a celebração simplesmente não acontecia.
   */
  it('resolve o rank pelo estado já mesclado, mesmo se o listener por score ainda não entregou nada', () => {
    const onNewMatch = vi.fn();
    const unsubscribe = subscribeToLeaderboard({ onData: vi.fn(), onSourceChange: vi.fn(), onNewMatch });

    // Primeiro snapshot do listener de recência: só marca "já inicializado", não celebra nada.
    onSnapshotHandlers[RECENCY_LISTENER].next(fakeMatchSnapshot([]));
    expect(onNewMatch).not.toHaveBeenCalled();

    const recorde = {
      match_id: 'novo-recorde',
      callsign: 'NOVA',
      company_canonical: 'ACME',
      final_score: 9000,
      created_at: '2026-01-01T10:00:00.000Z'
    };
    // Repare: o listener por score NUNCA foi acionado nesta assinatura.
    onSnapshotHandlers[RECENCY_LISTENER].next(fakeSnapshotWithAdded([recorde], [recorde]));

    expect(onNewMatch).toHaveBeenCalledTimes(1);
    const [entrada, rank] = onNewMatch.mock.calls[0];
    expect(entrada.match_id).toBe('novo-recorde');
    expect(rank).toBe(1);

    unsubscribe();
  });

  it('devolve rank 0 para quem não entrou no top 10, em vez de celebrar por engano', () => {
    const onNewMatch = vi.fn();
    const unsubscribe = subscribeToLeaderboard({ onData: vi.fn(), onSourceChange: vi.fn(), onNewMatch });

    const dezGrandes = Array.from({ length: 10 }, (_, i) => ({
      match_id: `top-${i}`,
      callsign: `T${i}`,
      company_canonical: 'ACME',
      final_score: 100_000 - i,
      created_at: '2026-01-01T09:00:00.000Z'
    }));
    onSnapshotHandlers[SCORE_LISTENER].next(fakeMatchSnapshot(dezGrandes));
    onSnapshotHandlers[RECENCY_LISTENER].next(fakeMatchSnapshot([]));

    const modesta = {
      match_id: 'modesta',
      callsign: 'ZERO',
      company_canonical: 'ACME',
      final_score: 10,
      created_at: '2026-01-01T10:00:00.000Z'
    };
    onSnapshotHandlers[RECENCY_LISTENER].next(fakeSnapshotWithAdded([modesta], [modesta]));

    expect(onNewMatch).toHaveBeenCalledTimes(1);
    expect(onNewMatch.mock.calls[0][1]).toBe(0);

    unsubscribe();
  });

  it('emite o estado ANTES de notificar a partida nova — o telão não mostra pódio velho sob o modal', () => {
    const ordem: string[] = [];
    const unsubscribe = subscribeToLeaderboard({
      onData: () => ordem.push('onData'),
      onSourceChange: vi.fn(),
      onNewMatch: () => ordem.push('onNewMatch')
    });

    onSnapshotHandlers[RECENCY_LISTENER].next(fakeMatchSnapshot([]));
    ordem.length = 0;

    const recorde = {
      match_id: 'm',
      callsign: 'NOVA',
      company_canonical: 'ACME',
      final_score: 9000,
      created_at: '2026-01-01T10:00:00.000Z'
    };
    onSnapshotHandlers[RECENCY_LISTENER].next(fakeSnapshotWithAdded([recorde], [recorde]));

    expect(ordem).toEqual(['onData', 'onNewMatch']);

    unsubscribe();
  });

  it('duas partidas na mesma entrega geram duas notificações, cada uma com seu rank', () => {
    // Dois estandes fechando partida quase juntos: o Firestore pode entregar as duas no mesmo
    // snapshot. O slot único do telão perdia uma delas antes da fila.
    const onNewMatch = vi.fn();
    const unsubscribe = subscribeToLeaderboard({ onData: vi.fn(), onSourceChange: vi.fn(), onNewMatch });

    onSnapshotHandlers[RECENCY_LISTENER].next(fakeMatchSnapshot([]));

    const base = { callsign: 'X', company_canonical: 'ACME', created_at: '2026-01-01T10:00:00.000Z' };
    const a = { ...base, match_id: 'booth-a', final_score: 9000 };
    const b = { ...base, match_id: 'booth-b', final_score: 8000 };
    onSnapshotHandlers[RECENCY_LISTENER].next(fakeSnapshotWithAdded([a, b], [a, b]));

    expect(onNewMatch).toHaveBeenCalledTimes(2);
    expect(onNewMatch.mock.calls.map((c) => [c[0].match_id, c[1]])).toEqual([
      ['booth-a', 1],
      ['booth-b', 2]
    ]);

    unsubscribe();
  });
});
