/**
 * Data source for the telão (TV leaderboard): Firestore `onSnapshot` as the
 * primary path, the local bridge (fetch + WebSocket) as the safety net.
 * Spec 05 §7.2 — a frozen scoreboard is worse than one a few seconds behind.
 *
 * This file has two clearly separated halves:
 *   1. Pure logic (`mergeLeaderboardState`, `pickSource`) — no Firestore, no
 *      network, no timers. Unit-tested directly in `leaderboard-source.test.ts`.
 *   2. Side-effecting plumbing (`subscribeToLeaderboard` and below) — the three
 *      `onSnapshot` listeners, the bridge fetch/WebSocket fallback (moved here
 *      from `App.tsx`, not duplicated), and the timers that decide when to
 *      switch between them. Exercised manually against the Firestore emulator
 *      (see task report), not by the unit tests.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  type Firestore,
  type Unsubscribe
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
 */
export function mergeLeaderboardState(
  matches: MatchDocument[],
  rankings: CompanyRankingDocument[]
): LeaderboardState {
  const byScoreDesc = [...matches].sort((a, b) => b.final_score - a.final_score);
  const byRecencyDesc = [...matches].sort(
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

  const distinctPilots = new Set(matches.map((m) => m.pilot_id)).size;

  return {
    topPilots,
    companyRankings,
    recentMatches,
    stats: {
      total_pilots: distinctPilots,
      total_matches: matches.length,
      top_score: topPilots.length > 0 ? topPilots[0].final_score : 0
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
// Side-effecting plumbing — Firestore onSnapshot + local bridge fallback.
// ---------------------------------------------------------------------------

const CLOUD_WATCHDOG_MS = 5000;

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
  let watchdogHandle: ReturnType<typeof setTimeout> | null = null;
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
    handlers.onData(mergeLeaderboardState(Array.from(merged.values()), rankings));
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
  const unsubscribers: Unsubscribe[] = [];

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
      onSnapshot(
        topByScoreQuery,
        (snap) => {
          matchesByScore = snap.docs.map((d) => d.data() as MatchDocument);
          onCloudSuccess();
        },
        onCloudError('matches-by-score')
      )
    );

    const topByRecencyQuery = query(
      collection(db, 'matches'),
      orderBy(field<MatchDocument>('created_at'), 'desc'),
      limit(RECENT_MATCHES_LIMIT)
    );
    unsubscribers.push(
      onSnapshot(
        topByRecencyQuery,
        (snap) => {
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
        onCloudError('matches-by-recency')
      )
    );

    const rankingsQuery = query(
      collection(db, 'company_rankings'),
      orderBy(field<CompanyRankingDocument>('total_score'), 'desc'),
      limit(TOP_COMPANIES_LIMIT)
    );
    unsubscribers.push(
      onSnapshot(
        rankingsQuery,
        (snap) => {
          rankings = snap.docs.map((d) => d.data() as CompanyRankingDocument);
          onCloudSuccess();
        },
        onCloudError('company-rankings')
      )
    );
  } else {
    console.warn('[leaderboard-source] Firebase project id not configured, using local bridge only');
    startLocalFallback();
  }

  return () => {
    clearWatchdog();
    stopLocalFallback();
    unsubscribers.forEach((unsub) => unsub());
  };
}
