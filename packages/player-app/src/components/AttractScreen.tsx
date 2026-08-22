import React, { useEffect, useRef, useState } from 'react';
import { Rocket, Trophy, Sparkles, Zap, Shield, Play, Terminal, ChevronRight } from 'lucide-react';
import { audioManager } from '../game/audio/AudioManager.js';
import { ENDPOINTS } from '../config.js';

interface AttractScreenProps {
  onStart: () => void;
}

interface TopPilotEntry {
  rank: number;
  match_id: string;
  callsign: string;
  company_canonical: string;
  final_score: number;
  created_at: string;
  ship_style_name?: string;
}

// Refresh cadence for the idle attract screen: fresh enough to reflect the
// last visitor's match without hammering the daemon between bouts.
const LEADERBOARD_REFRESH_MS = 45000;

// Visual treatment for the top 3 rows, preserved 1:1 from the previous
// hardcoded markup (medal, container classes, label/value emphasis).
const ROW_STYLES = [
  {
    medal: '🥇',
    container: 'flex justify-between items-center p-2.5 rounded-xl bg-[#ff9e0b]/10 border border-[#ff9e0b]/30 text-[#ff9e0b]',
    label: 'font-bold',
    value: 'font-black'
  },
  {
    medal: '🥈',
    container: 'flex justify-between items-center p-2.5 rounded-xl bg-slate-800/40 border border-slate-700/40 text-slate-200',
    label: '',
    value: 'font-bold'
  },
  {
    medal: '🥉',
    container: 'flex justify-between items-center p-2.5 rounded-xl bg-slate-800/40 border border-slate-700/40 text-slate-300',
    label: '',
    value: 'font-bold'
  }
];

export function AttractScreen({ onStart }: AttractScreenProps) {
  const [topPilots, setTopPilots] = useState<TopPilotEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Tracks whether ANY fetch (mount or periodic poll) has ever succeeded.
  // A ref (not state) because it's only read/written inside the effect's
  // async closure and must not trigger its own re-render.
  const hasLoadedOnceRef = useRef(false);

  // Fetch the real leaderboard for the Hall of Fame preview card. This screen
  // is shown repeatedly between visitors, so we refresh periodically too
  // (not just on mount) to reflect whoever just finished a run.
  useEffect(() => {
    let cancelled = false;

    const fetchLeaderboard = async () => {
      try {
        const res = await fetch(`${ENDPOINTS.bridgeBase}/api/leaderboard`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setTopPilots(Array.isArray(data?.topPilots) ? data.topPilots : []);
          hasLoadedOnceRef.current = true;
        }
      } catch (err) {
        console.warn('[AttractScreen] Falha ao buscar o leaderboard:', err);
        // Only wipe the list on failure if we've never had a good fetch yet.
        // A transient hiccup on a background poll (e.g. during a reset
        // cycle) must not erase an already-displayed, still-valid
        // leaderboard — that would flash the "seja o primeiro" placeholder
        // over real data. The next successful poll self-heals regardless.
        if (!cancelled && !hasLoadedOnceRef.current) {
          setTopPilots([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchLeaderboard();
    const interval = setInterval(fetchLeaderboard, LEADERBOARD_REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Enter') {
        audioManager.unlockAudio();
        onStart();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onStart]);

  const topThree = topPilots.slice(0, 3);

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 relative overflow-hidden select-none font-sans">
      {/* Flight Deck Header Tag */}
      <div className="text-center space-y-4 z-10 max-w-2xl">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#38bdf8]/10 border border-[#38bdf8]/30 text-[#38bdf8] text-xs font-bold tracking-widest uppercase mb-2 font-mono">
          <Terminal className="w-4 h-4 text-[#ff9e0b]" /> Google Cloud Summit 2026 // Avionics Forge
        </div>

        <h1 className="text-5xl md:text-6xl font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-b from-[#ffffff] via-[#f1f5f9] to-[#94a3b8] drop-shadow-[0_0_30px_rgba(56,189,248,0.3)]">
          STARFIGHTER
        </h1>

        <p className="text-base text-[#ff9e0b] font-black tracking-widest uppercase text-glow-amber">
          FORJA AEROESPACIAL COM AGENTES DE IA & MCP
        </p>

        <p className="text-xs text-slate-400 max-w-lg mx-auto leading-relaxed">
          Calibre a matriz de energia da fuselagem, configure canhões e escudos no <b>Antigravity CLI</b> e dispute o topo do ranking corporativo!
        </p>
      </div>

      {/* Hall of Fame Preview Card */}
      <div className="my-7 z-10 w-full max-w-md flight-panel p-5 rounded-3xl border border-slate-700/60 shadow-2xl space-y-3">
        <div className="flex items-center justify-between pb-3 border-b border-slate-700/60">
          <span className="text-xs font-bold text-[#ff9e0b] flex items-center gap-2 font-mono">
            <Trophy className="w-4 h-4 text-[#ff9e0b]" /> RECORDE DO ESTANDE
          </span>
          <span className="text-[10px] text-slate-400 font-mono">TOP PILOTOS</span>
        </div>

        <div className="space-y-2 text-xs font-mono">
          {topThree.length === 0 ? (
            <div className="flex justify-center items-center p-3 rounded-xl bg-slate-800/40 border border-slate-700/40 text-slate-400 text-center">
              <span>
                {isLoading ? 'Carregando recordes do estande...' : 'Seja o primeiro a registrar um recorde!'}
              </span>
            </div>
          ) : (
            topThree.map((pilot, index) => {
              const style = ROW_STYLES[index];
              return (
                <div key={pilot.match_id ?? pilot.rank} className={style.container}>
                  <span className={style.label}>
                    {style.medal} {pilot.rank}. {pilot.callsign} ({pilot.company_canonical})
                  </span>
                  <span className={style.value}>{pilot.final_score.toLocaleString()} PTS</span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Solar Amber Action Button */}
      <div className="z-10 text-center space-y-3">
        <button
          onClick={() => {
            audioManager.unlockAudio();
            onStart();
          }}
          className="px-9 py-4 rounded-2xl bg-gradient-to-r from-[#ff9e0b] to-[#f59e0b] text-black font-black text-xs tracking-widest uppercase hover:scale-105 transition-all shadow-[0_0_30px_rgba(255,158,11,0.5)] flex items-center gap-3 mx-auto"
        >
          <Play className="w-4 h-4 fill-black" />
          <span>PRESSIONE ESPAÇO PARA INICIAR</span>
          <ChevronRight className="w-4 h-4 stroke-[3]" />
        </button>
        <p className="text-[11px] text-slate-500 font-mono">Duração estimada da missão: ~2 minutos e 30 segundos</p>
      </div>
    </div>
  );
}
