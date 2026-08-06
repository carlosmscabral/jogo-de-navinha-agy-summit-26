import React from 'react';
import { Trophy, Crown, Medal, Flame, Zap, Shield, Sparkles } from 'lucide-react';

export interface TopPilotEntry {
  rank: number;
  match_id: string;
  callsign: string;
  company_canonical: string;
  final_score: number;
  created_at: string;
}

interface HallOfFameProps {
  pilots: TopPilotEntry[];
}

export function HallOfFame({ pilots }: HallOfFameProps) {
  const getRankBadge = (rank: number) => {
    if (rank === 1) {
      return (
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#ffd700] to-[#ffaa00] text-black font-black text-sm flex items-center justify-center shadow-[0_0_15px_rgba(255,215,0,0.6)]">
          <Crown className="w-5 h-5 fill-black" />
        </div>
      );
    }
    if (rank === 2) {
      return (
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#e0e7ff] to-[#94a3b8] text-black font-black text-sm flex items-center justify-center shadow-[0_0_12px_rgba(224,231,255,0.5)]">
          <Medal className="w-5 h-5 fill-black" />
        </div>
      );
    }
    if (rank === 3) {
      return (
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#f97316] to-[#b45309] text-black font-black text-sm flex items-center justify-center shadow-[0_0_12px_rgba(249,115,22,0.5)]">
          <Medal className="w-5 h-5 fill-black" />
        </div>
      );
    }
    return (
      <div className="w-9 h-9 rounded-xl bg-white/[0.05] border border-white/10 text-gray-400 font-mono font-bold text-xs flex items-center justify-center">
        #{rank}
      </div>
    );
  };

  return (
    <div className="glass-panel p-6 rounded-3xl border border-[#00f3ff]/20 shadow-2xl flex flex-col h-full space-y-4">
      {/* Section Header */}
      <div className="flex items-center justify-between pb-3 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-[#ffd700]/10 border border-[#ffd700]/30 text-[#ffd700]">
            <Trophy className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h2 className="text-lg font-black text-white tracking-wider uppercase font-sans">
              HALL DA FAMA // TOP 10 PILOTOS
            </h2>
            <p className="text-[11px] text-gray-400">Pontuações individuais mais altas do Summit</p>
          </div>
        </div>

        <span className="text-[10px] font-bold px-2.5 py-1 rounded-md bg-[#00f3ff]/10 text-[#00f3ff] border border-[#00f3ff]/30 uppercase tracking-widest font-mono">
          60 FPS LIVE
        </span>
      </div>

      {/* Pilots List */}
      <div className="flex-1 space-y-2.5 overflow-hidden">
        {pilots.slice(0, 10).map((pilot) => {
          const isTop1 = pilot.rank === 1;
          const isTop3 = pilot.rank <= 3;

          return (
            <div
              key={pilot.match_id || pilot.rank}
              className={`p-3.5 rounded-2xl transition-all flex items-center justify-between gap-3 ${
                isTop1
                  ? 'bg-gradient-to-r from-[#ffd700]/20 via-[#ffd700]/10 to-black/60 border border-[#ffd700]/60 neon-border-gold scale-[1.01]'
                  : isTop3
                  ? 'bg-gradient-to-r from-white/[0.08] to-black/40 border border-white/20'
                  : 'bg-black/40 border border-white/5 hover:border-white/15'
              }`}
            >
              {/* Left: Rank & Callsign */}
              <div className="flex items-center gap-3 min-w-0">
                {getRankBadge(pilot.rank)}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm font-black tracking-wide truncate ${
                        isTop1 ? 'text-[#ffd700] neon-text-gold' : 'text-white'
                      }`}
                    >
                      {pilot.callsign}
                    </span>
                    {isTop1 && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#ffd700]/20 text-[#ffd700] border border-[#ffd700]/40 uppercase tracking-wider">
                        LÍDER
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 font-sans truncate block">
                    {pilot.company_canonical}
                  </span>
                </div>
              </div>

              {/* Right: Score */}
              <div className="text-right flex-shrink-0">
                <div
                  className={`text-base font-black font-mono tracking-tight ${
                    isTop1 ? 'text-[#ffd700]' : isTop3 ? 'text-[#00f3ff]' : 'text-gray-200'
                  }`}
                >
                  {pilot.final_score.toLocaleString()} <span className="text-[10px] text-gray-400 font-normal">PTS</span>
                </div>
                <div className="text-[9px] text-gray-500 font-mono">
                  {new Date(pilot.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
