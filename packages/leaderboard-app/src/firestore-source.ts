/**
 * Data source for the telão (TV leaderboard): Firestore `onSnapshot` as the
 * primary path, the local bridge (fetch + WebSocket) as the safety net.
 * Spec 05 §7.2 — a frozen scoreboard is worse than one a few seconds behind.
 *
 * This file has three clearly separated sections:
 *   1. Pure logic (`mergeLeaderboardState`, `applyAccurateCounts`, `pickSource`)
 *      — no Firestore, no network, no timers. Unit-tested directly in
 *      `leaderboard-source.test.ts`.
 *   2. `subscribeWithRetry` — a generic capped-exponential-backoff retry
 *      wrapper around any `onSnapshot`-shaped subscription. Deliberately
 *      Firestore-agnostic so it's unit-tested with fake timers and a fake
 *      `subscribe` function, no emulator involved.
 *   3. Side-effecting plumbing (`subscribeToLeaderboard` and below) — the
 *      three `onSnapshot` listeners (wrapped in `subscribeWithRetry`), the
 *      periodic exact-count refresh (`getCountFromServer`), and the bridge
 *      fetch/WebSocket fallback (moved here from `App.tsx`, not duplicated).
 *      Exercised manually against the Firestore emulator (see task report),
 *      not by the unit tests.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  getCountFromServer,
  type Firestore,
  type QuerySnapshot,
  type DocumentData
} from 'firebase/firestore';
import { DATABASE_ID, field, type MatchDocument, type CompanyRankingDocument } from '@jogo/shared';
import type { TopPilotEntry } from './components/HallOfFame.js';
import type { CompanyRankEntry } from './components/CompanyDominance.js';
import type { RecentMatchEntry } from './components/LiveTickerFeed.js';
import { ENDPOINTS } from './config.js';

export interface LeaderboardState {
  topPilots: TopPilotEntry[];
  companyRankings: CompanyRankEntry[];
  recentMatches: RecentMatchEntry[];
  stats: {
    total_pilots: number;
    total_matches: number;
    top_score: number;
  };
}

export type SourceStatus = 'cloud' | 'local' | 'offline';

export interface LeaderboardHandlers {
  onData(state: LeaderboardState): void;
  onSourceChange(status: SourceStatus): void;
  /** Optional: fired for a newly-added match, used to trigger the celebration modal. */
  onNewMatch?(match: RecentMatchEntry): void;
}

// ---------------------------------------------------------------------------
// Pure logic — no Firestore, no network, no timers.
// ---------------------------------------------------------------------------

const TOP_PILOTS_LIMIT = 10;
const TOP_COMPANIES_LIMIT = 5;
const RECENT_MATCHES_LIMIT = 12;

/**
 * Builds the full `LeaderboardState` from raw documents. `matches` is expected
 * to be the union of whatever the "top by score" and "top by recency"
 * listeners have delivered so far (deduplicated by `match_id`) — this
 * function does its own sorting/truncation for both views, so the caller
 * doesn't need to pre-sort or pick which slice feeds which panel. Never
 * throws, even on empty input.
 *
 * Matches with `voided: true` (Task C7's admin panel) are dropped first, before
 * any sorting/slicing — this is the ONLY place that filters them out, so it
 * covers the Hall of Fame and the Live Ticker in one spot regardless of which
 * of the two `onSnapshot` listeners (by-score, by-recency) delivered the
 * document. Deliberately NOT a Firestore `where('voided', '!=', true)` query:
 * `ingestOne` (Task C3) never writes a `voided` field on a normal match, and
 * Firestore's `!=` excludes documents where the filtered field is absent
 * entirely — that query would return zero results for every never-voided
 * match and empty the whole leaderboard. `company_rankings` needs no such
 * filter here: `patchMatch` (Task C7) already recalculates that aggregate
 * excluding voided matches server-side.
 */
export function mergeLeaderboardState(
  matches: MatchDocument[],
  rankings: CompanyRankingDocument[]
): LeaderboardState {
  const activeMatches = matches.filter((m) => !m.voided);
  const byScoreDesc = [...activeMatches].sort((a, b) => b.final_score - a.final_score);
  const byRecencyDesc = [...activeMatches].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)
  );

  const topPilots: TopPilotEntry[] = byScoreDesc.slice(0, TOP_PILOTS_LIMIT).map((m, i) => ({
    rank: i + 1,
    match_id: m.match_id,
    callsign: m.callsign,
    company_canonical: m.company_canonical,
    final_score: m.final_score,
    created_at: m.created_at
  }));

  const companyRankings: CompanyRankEntry[] = [...rankings]
    .sort((a, b) => b.total_score - a.total_score)
    .slice(0, TOP_COMPANIES_LIMIT)
    .map((r, i) => ({
      rank: i + 1,
      company_canonical: r.company_canonical,
      total_score: r.total_score,
      pilots_count: r.pilots_count,
      top_individual_score: r.top_individual_score
    }));

  const recentMatches: RecentMatchEntry[] = byRecencyDesc.slice(0, RECENT_MATCHES_LIMIT).map((m) => ({
    match_id: m.match_id,
    callsign: m.callsign,
    company_canonical: m.company_canonical,
    final_score: m.final_score,
    created_at: m.created_at
  }));

  const distinctPilots = new Set(activeMatches.map((m) => m.pilot_id)).size;

  return {
    topPilots,
    companyRankings,
    recentMatches,
    stats: {
      total_pilots: distinctPilots,
      total_matches: activeMatches.length,
      top_score: topPilots.length > 0 ? topPilots[0].final_score : 0
    }
  };
}

export interface AccurateCounts {
  total_matches: number;
  total_pilots: number;
}

/**
 * Overrides only the aggregate counters in `state.stats` with exact counts
 * (see `refreshCounts` below, backed by `getCountFromServer`). `top_score` is
 * left untouched — it comes from the "top by score" query itself and is
 * exact regardless of collection size. `total_matches`/`total_pilots`, by
 * contrast, are what `mergeLeaderboardState` can only *estimate* from the
 * ≤22 documents its two windowed match queries see: once an event has more
 * matches than that, the windowed estimate stops reflecting reality and can
 * even move up and down as different matches enter/leave the windows — worse
 * than a stable, if briefly stale, exact number on a public display. Pure;
 * used by `subscribeToLeaderboard` and unit-tested directly.
 */
export function applyAccurateCounts(state: LeaderboardState, counts: AccurateCounts): LeaderboardState {
  return {
    ...state,
    stats: {
      ...state.stats,
      total_matches: counts.total_matches,
      total_pilots: counts.total_pilots
    }
  };
}

export type SourceEvent =
  | 'CLOUD_SNAPSHOT'
  | 'CLOUD_TIMEOUT'
  | 'CLOUD_ERROR'
  | 'LOCAL_SNAPSHOT'
  | 'LOCAL_FAILURE';

/**
 * Decides the next source status from the current one and the latest event.
 * Pure and synchronous: the timing (5s cloud watchdog, retry backoff) lives
 * in `subscribeToLeaderboard`, which feeds events into this reducer as they
 * happen. This is also what makes automatic recovery to the cloud trivial to
 * reason about and to test: `CLOUD_SNAPSHOT` always wins, from any state.
 */
export function pickSource(current: SourceStatus, event: SourceEvent): SourceStatus {
  switch (event) {
    case 'CLOUD_SNAPSHOT':
      return 'cloud';
    case 'CLOUD_TIMEOUT':
    case 'CLOUD_ERROR':
      return 'local';
    case 'LOCAL_SNAPSHOT':
      return current === 'cloud' ? current : 'local';
    case 'LOCAL_FAILURE':
      return current === 'cloud' ? current : 'offline';
    default:
      return current;
  }
}

// ---------------------------------------------------------------------------
// Generic retry wrapper — uses timers, but is Firestore-agnostic. Tested with
// fake timers and a fake `subscribe` function, no emulator involved.
// ---------------------------------------------------------------------------

export interface RetryableSubscriptionOptions<T> {
  /** Mirrors the shape of `onSnapshot`: starts a subscription, returns its unsubscribe function. */
  subscribe: (onNext: (value: T) => void, onError: (err: unknown) => void) => () => void;
  onNext: (value: T) => void;
  /** Called on every failed attempt, in addition to the automatic retry this function schedules. */
  onError: (err: unknown) => void;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

/**
 * Wraps a Firestore-style subscription (`onSnapshot`) with capped exponential
 * backoff retry. Firestore's `onSnapshot` error callback fires for permanent
 * failures (e.g. a security-rules permission hiccup) — and once it does, the
 * SDK will never call that listener again on its own. Without this wrapper,
 * "automatic recovery to the cloud" would silently stop working after any
 * such error until a manual page reload. Deliberately generic (no Firestore
 * import in this function) so it's unit-testable without an emulator.
 */
export function subscribeWithRetry<T>(options: RetryableSubscriptionOptions<T>): () => void {
  const baseDelayMs = options.baseDelayMs ?? 2000;
  const maxDelayMs = options.maxDelayMs ?? 30000;
  let stopped = false;
  let unsubscribeCurrent: (() => void) | null = null;
  let retryHandle: ReturnType<typeof setTimeout> | null = null;
  let consecutiveFailures = 0;

  function start() {
    if (stopped) return;
    unsubscribeCurrent = options.subscribe(
      (value) => {
        consecutiveFailures = 0;
        options.onNext(value);
      },
      (err) => {
        options.onError(err);
        if (stopped) return;
        const delay = Math.min(baseDelayMs * 2 ** consecutiveFailures, maxDelayMs);
        consecutiveFailures += 1;
        retryHandle = setTimeout(start, delay);
      }
    );
  }

  start();

  return () => {
    stopped = true;
    if (retryHandle) clearTimeout(retryHandle);
    if (unsubscribeCurrent) unsubscribeCurrent();
  };
}

// ---------------------------------------------------------------------------
// Side-effecting plumbing — Firestore onSnapshot + local bridge fallback.
// ---------------------------------------------------------------------------

const CLOUD_WATCHDOG_MS = 5000;
const COUNT_REFRESH_MS = 15000;

let cachedApp: FirebaseApp | null = null;
let cachedDb: Firestore | null = null;

/**
 * Lazily builds the Firebase app/Firestore singleton from Vite env vars.
 * Returns null when the project isn't configured (e.g. local dev without
 * `.env`), in which case `subscribeToLeaderboard` skips straight to the
 * local bridge.
 */
function getFirestoreDb(): Firestore | null {
  const env = import.meta.env;
  const projectId = env.VITE_FIREBASE_PROJECT_ID;
  if (!projectId) {
    return null;
  }
  if (!cachedDb) {
    cachedApp =
      cachedApp ??
      initializeApp({
        apiKey: env.VITE_FIREBASE_API_KEY,
        authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId,
        storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
        appId: env.VITE_FIREBASE_APP_ID
      });
    // Named database, never (default) — Spec 08 §6.3. Getting this wrong
    // means the telão silently reads an empty database with no error.
    cachedDb = getFirestore(cachedApp, DATABASE_ID);
  }
  return cachedDb;
}

interface LocalBridgeHandlers {
  onData(state: LeaderboardState): void;
  onNewMatch?(match: RecentMatchEntry): void;
  onFailure(): void;
}

/**
 * The pre-existing polling + WebSocket bridge client, moved here verbatim
 * from `App.tsx` (not duplicated) and adapted to report success/failure to
 * the source-switching logic instead of writing straight into React state.
 */
function subscribeToLocalBridge(handlers: LocalBridgeHandlers): () => void {
  let stopped = false;
  let ws: WebSocket | null = null;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  async function fetchLeaderboard() {
    try {
      const res = await fetch(`${ENDPOINTS.bridgeBase}/api/leaderboard`);
      if (!res.ok) {
        handlers.onFailure();
        return;
      }
      const json = (await res.json()) as LeaderboardState;
      handlers.onData(json);
    } catch (err) {
      console.warn('[leaderboard-source] Local bridge fetch failed', err);
      handlers.onFailure();
    }
  }

  function connectWs() {
    if (stopped) return;
    try {
      ws = new WebSocket(ENDPOINTS.bridgeWsUrl);

      ws.onopen = () => {
        console.log('[leaderboard-source] Connected to local bridge WebSocket');
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'EVENT_LEADERBOARD_UPDATE') {
            handlers.onData(msg.data);
            if (msg.newMatch && handlers.onNewMatch) {
              handlers.onNewMatch(msg.newMatch);
            }
          }
        } catch (err) {
          console.warn('[leaderboard-source] Failed to parse local bridge WebSocket message', err);
        }
      };

      ws.onclose = () => {
        if (!stopped) {
          reconnectTimeout = setTimeout(connectWs, 3000);
        }
      };
    } catch (err) {
      console.warn('[leaderboard-source] Failed to open local bridge WebSocket', err);
      if (!stopped) {
        reconnectTimeout = setTimeout(connectWs, 3000);
      }
    }
  }

  fetchLeaderboard();
  pollInterval = setInterval(fetchLeaderboard, 3000);
  connectWs();

  return () => {
    stopped = true;
    if (pollInterval) clearInterval(pollInterval);
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    if (ws) ws.close();
  };
}

/**
 * Wires Firestore `onSnapshot` (primary) and the local bridge (fallback)
 * together and reports both the merged leaderboard data and the active
 * source to `handlers`. Returns a single cleanup function.
 */
export function subscribeToLeaderboard(handlers: LeaderboardHandlers): () => void {
  let status: SourceStatus = 'offline';
  let matchesByScore: MatchDocument[] = [];
  let matchesByRecency: MatchDocument[] = [];
  let rankings: CompanyRankingDocument[] = [];
  let latestCounts: AccurateCounts | null = null;
  let watchdogHandle: ReturnType<typeof setTimeout> | null = null;
  let countsIntervalHandle: ReturnType<typeof setInterval> | null = null;
  let localUnsubscribe: (() => void) | null = null;
  let recencyInitialized = false;

  function setStatus(event: SourceEvent) {
    const next = pickSource(status, event);
    const changed = next !== status;
    status = next;
    if (changed) {
      handlers.onSourceChange(status);
    }
  }

  function emitMerged() {
    const merged = new Map<string, MatchDocument>();
    for (const m of matchesByScore) merged.set(m.match_id, m);
    for (const m of matchesByRecency) merged.set(m.match_id, m);
    let state = mergeLeaderboardState(Array.from(merged.values()), rankings);
    if (latestCounts) {
      state = applyAccurateCounts(state, latestCounts);
    }
    handlers.onData(state);
  }

  /**
   * Exact `total_matches`/`total_pilots` via `getCountFromServer`, run on its
   * own timer independent of the (much chattier) per-document listeners —
   * once per mount and then every `COUNT_REFRESH_MS`. A single aggregation
   * read per collection is cheap; 15s keeps a live public display close to
   * real-time without hammering Firestore on every match/company update.
   * Failures are logged and skipped — the next tick tries again, and the
   * three onSnapshot listeners remain the authority on source health, so a
   * transient count-fetch failure doesn't flip the NUVEM/LOCAL badge.
   */
  async function refreshCounts(firestoreDb: Firestore) {
    try {
      const [matchesCount, pilotsCount] = await Promise.all([
        getCountFromServer(collection(firestoreDb, 'matches')),
        getCountFromServer(collection(firestoreDb, 'pilots'))
      ]);
      latestCounts = {
        total_matches: matchesCount.data().count,
        total_pilots: pilotsCount.data().count
      };
      emitMerged();
    } catch (err) {
      console.warn('[leaderboard-source] Failed to refresh exact stats counts from Firestore', err);
    }
  }

  function armWatchdog() {
    clearWatchdog();
    watchdogHandle = setTimeout(() => {
      console.warn('[leaderboard-source] No Firestore snapshot within watchdog window, falling back to local bridge');
      setStatus('CLOUD_TIMEOUT');
      startLocalFallback();
    }, CLOUD_WATCHDOG_MS);
  }

  function clearWatchdog() {
    if (watchdogHandle) {
      clearTimeout(watchdogHandle);
      watchdogHandle = null;
    }
  }

  function stopLocalFallback() {
    if (localUnsubscribe) {
      localUnsubscribe();
      localUnsubscribe = null;
    }
  }

  function startLocalFallback() {
    if (localUnsubscribe) return; // already running
    localUnsubscribe = subscribeToLocalBridge({
      onData: (state) => {
        setStatus('LOCAL_SNAPSHOT');
        handlers.onData(state);
      },
      onNewMatch: handlers.onNewMatch,
      onFailure: () => setStatus('LOCAL_FAILURE')
    });
  }

  const db = getFirestoreDb();
  const unsubscribers: (() => void)[] = [];

  if (db) {
    armWatchdog();

    const onCloudSuccess = () => {
      clearWatchdog();
      setStatus('CLOUD_SNAPSHOT');
      stopLocalFallback();
      armWatchdog(); // Re-arm: a mid-session stall must also trip the fallback.
      emitMerged();
    };

    const onCloudError = (context: string) => (err: unknown) => {
      console.error(`[leaderboard-source] Firestore ${context} listener error`, err);
      setStatus('CLOUD_ERROR');
      startLocalFallback();
    };

    const topByScoreQuery = query(
      collection(db, 'matches'),
      orderBy(field<MatchDocument>('final_score'), 'desc'),
      limit(TOP_PILOTS_LIMIT)
    );
    unsubscribers.push(
      subscribeWithRetry<QuerySnapshot<DocumentData>>({
        subscribe: (onNext, onError) => onSnapshot(topByScoreQuery, onNext, onError),
        onNext: (snap) => {
          matchesByScore = snap.docs.map((d) => d.data() as MatchDocument);
          onCloudSuccess();
        },
        onError: onCloudError('matches-by-score')
      })
    );

    const topByRecencyQuery = query(
      collection(db, 'matches'),
      orderBy(field<MatchDocument>('created_at'), 'desc'),
      limit(RECENT_MATCHES_LIMIT)
    );
    unsubscribers.push(
      subscribeWithRetry<QuerySnapshot<DocumentData>>({
        subscribe: (onNext, onError) => {
          // Every (re)subscription — including retries after a permanent
          // error — starts a brand new Firestore listener whose FIRST
          // snapshot lists all currently-existing docs as "added". Resetting
          // this here (not just once at mount) stops a post-error
          // resubscription from replaying the celebration modal for matches
          // that already existed before the hiccup.
          recencyInitialized = false;
          return onSnapshot(topByRecencyQuery, onNext, onError);
        },
        onNext: (snap) => {
          matchesByRecency = snap.docs.map((d) => d.data() as MatchDocument);
          // Skip the initial snapshot (pre-existing docs) so the celebration
          // modal only fires for matches that arrive while the telão is up.
          if (recencyInitialized && handlers.onNewMatch) {
            for (const change of snap.docChanges()) {
              if (change.type === 'added') {
                const m = change.doc.data() as MatchDocument;
                handlers.onNewMatch({
                  match_id: m.match_id,
                  callsign: m.callsign,
                  company_canonical: m.company_canonical,
                  final_score: m.final_score,
                  created_at: m.created_at
                });
              }
            }
          }
          recencyInitialized = true;
          onCloudSuccess();
        },
        onError: onCloudError('matches-by-recency')
      })
    );

    const rankingsQuery = query(
      collection(db, 'company_rankings'),
      orderBy(field<CompanyRankingDocument>('total_score'), 'desc'),
      limit(TOP_COMPANIES_LIMIT)
    );
    unsubscribers.push(
      subscribeWithRetry<QuerySnapshot<DocumentData>>({
        subscribe: (onNext, onError) => onSnapshot(rankingsQuery, onNext, onError),
        onNext: (snap) => {
          rankings = snap.docs.map((d) => d.data() as CompanyRankingDocument);
          onCloudSuccess();
        },
        onError: onCloudError('company-rankings')
      })
    );

    refreshCounts(db);
    countsIntervalHandle = setInterval(() => refreshCounts(db), COUNT_REFRESH_MS);
  } else {
    console.warn('[leaderboard-source] Firebase project id not configured, using local bridge only');
    startLocalFallback();
  }

  return () => {
    clearWatchdog();
    if (countsIntervalHandle) clearInterval(countsIntervalHandle);
    stopLocalFallback();
    unsubscribers.forEach((unsub) => unsub());
  };
}
