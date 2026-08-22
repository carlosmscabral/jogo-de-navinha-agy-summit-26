import React, { useState, useEffect } from 'react';
import { Trophy, Radio, Zap, Users, Flame, Shield, Globe, Terminal } from 'lucide-react';
import { HallOfFame, TopPilotEntry } from './components/HallOfFame.js';
import { CompanyDominance, CompanyRankEntry } from './components/CompanyDominance.js';
import { LiveTickerFeed, RecentMatchEntry } from './components/LiveTickerFeed.js';
import { RecordCelebrationModal } from './components/RecordCelebrationModal.js';
import { AttractQrCode } from './components/AttractQrCode.js';
import { ENDPOINTS } from './config.js';

interface LeaderboardState {
  topPilots: TopPilotEntry[];
  companyRankings: CompanyRankEntry[];
  recentMatches: RecentMatchEntry[];
  stats: {
    total_pilots: number;
    total_matches: number;
    top_score: number;
  };
}

export function App() {
  const [data, setData] = useState<LeaderboardState>({
    topPilots: [],
    companyRankings: [],
    recentMatches: [],
    stats: { total_pilots: 0, total_matches: 0, top_score: 0 }
  });

  const [celebrationMatch, setCelebrationMatch] = useState<{ match: any; rank: number } | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString());

  // Clock Ticker
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch initial leaderboard & polling fallback
  const fetchLeaderboard = async () => {
    try {
      const res = await fetch(`${ENDPOINTS.bridgeBase}/api/leaderboard`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {
      // Offline fallback
    }
  };

  useEffect(() => {
    fetchLeaderboard();
    const interval = setInterval(fetchLeaderboard, 3000);
    return () => clearInterval(interval);
  }, []);

  // WebSocket Live Updates
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: any = null;

    const connect = () => {
      try {
        ws = new WebSocket(ENDPOINTS.bridgeWsUrl);

        ws.onopen = () => {
          console.log('[Leaderboard WS] Connected to Daemon');
        };

        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'EVENT_LEADERBOARD_UPDATE') {
              setData(msg.data);

              // Check if new match is a record in Top 3
              if (msg.newMatch) {
                const rank = msg.data.topPilots.findIndex((p: any) => p.match_id === msg.newMatch.match_id) + 1;
                if (rank > 0 && rank <= 3) {
                  setCelebrationMatch({ match: msg.newMatch, rank });
                }
              }
            }
          } catch {
            // Ignored
          }
        };

        ws.onclose = () => {
          reconnectTimeout = setTimeout(connect, 3000);
        };
      } catch {
        reconnectTimeout = setTimeout(connect, 3000);
      }
    };

    connect();

    return () => {
      if (ws) ws.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen bg-[#07080c] text-white overflow-hidden select-none font-sans relative">
      {/* Background Solar Amber & Cobalt Gradients */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-[#38bdf8]/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-[#ff9e0b]/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 left-1/3 w-96 h-96 bg-[#10b981]/05 rounded-full blur-3xl pointer-events-none" />

      {/* Top Header Bar */}
      <header className="px-8 py-4 bg-slate-950/80 border-b border-slate-800 backdrop-blur-md flex items-center justify-between z-20 flex-shrink-0">
        {/* Left: Event Branding */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#38bdf8] to-[#ff9e0b] p-0.5 flex items-center justify-center shadow-[0_0_20px_rgba(56,189,248,0.4)]">
            <div className="w-full h-full bg-[#07080c] rounded-2xl flex items-center justify-center font-black text-xs text-[#38bdf8] font-mono">
              AGY
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black text-white tracking-widest uppercase font-sans">
                GOOGLE CLOUD SUMMIT 2026
              </h1>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#ff9e0b]/20 text-[#ff9e0b] border border-[#ff9e0b]/40 uppercase tracking-wider font-mono">
                LIVE ARENA
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono">
              Painel Oficial de Telemetria & Forja de Naves com Antigravity CLI
            </p>
          </div>
        </div>

        {/* Right: Live Meta Counters & Clock */}
        <div className="flex items-center gap-6 font-mono text-xs">
          <div className="px-4 py-2 rounded-2xl bg-slate-900/60 border border-slate-800 text-center">
            <div className="text-[10px] text-slate-400 uppercase">Pilotos Inscritos</div>
            <div className="text-sm font-black text-[#38bdf8] flex items-center justify-center gap-1">
              <Users className="w-3.5 h-3.5" /> {data.stats.total_pilots || data.topPilots.length}
            </div>
          </div>

          <div className="px-4 py-2 rounded-2xl bg-slate-900/60 border border-slate-800 text-center">
            <div className="text-[10px] text-slate-400 uppercase">Recorde do Dia</div>
            <div className="text-sm font-black text-[#ff9e0b] flex items-center justify-center gap-1">
              <Trophy className="w-3.5 h-3.5" /> {data.stats.top_score.toLocaleString()} PTS
            </div>
          </div>

          <div className="px-4 py-2 rounded-2xl bg-slate-900/60 border border-slate-800 text-center">
            <div className="text-[10px] text-slate-400 uppercase">Horário Oficial</div>
            <div className="text-sm font-black text-slate-200 font-mono">
              {currentTime}
            </div>
          </div>
        </div>
      </header>

      {/* Main Grid Content */}
      <main className="flex-1 p-6 grid grid-cols-1 md:grid-cols-12 gap-6 overflow-hidden z-10">
        {/* Left Column (7 Cols): Hall of Fame Top 10 Individual */}
        <div className="md:col-span-7 h-full overflow-hidden">
          <HallOfFame pilots={data.topPilots} />
        </div>

        {/* Right Column (5 Cols): Company Dominance + QR Code Callout */}
        <div className="md:col-span-5 flex flex-col gap-6 h-full overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <CompanyDominance companies={data.companyRankings} />
          </div>
          <div className="flex-shrink-0">
            <AttractQrCode />
          </div>
        </div>
      </main>

      {/* Bottom Ticker Feed */}
      <footer className="z-20 flex-shrink-0">
        <LiveTickerFeed recentMatches={data.recentMatches} />
      </footer>

      {/* Celebration Modal (When a new Top 3 score is homologated) */}
      {celebrationMatch && (
        <RecordCelebrationModal
          match={celebrationMatch.match}
          rank={celebrationMatch.rank}
          onDismiss={() => setCelebrationMatch(null)}
        />
      )}
    </div>
  );
}
