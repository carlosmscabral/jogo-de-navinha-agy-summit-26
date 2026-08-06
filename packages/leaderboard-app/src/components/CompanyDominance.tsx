import React from 'react';
import { Building2, Users, Flame, Award, TrendingUp } from 'lucide-react';

export interface CompanyRankEntry {
  rank: number;
  company_canonical: string;
  total_score: number;
  pilots_count: number;
  top_individual_score: number;
}

interface CompanyDominanceProps {
  companies: CompanyRankEntry[];
}

export function CompanyDominance({ companies }: CompanyDominanceProps) {
  const maxScore = companies.length > 0 ? companies[0].total_score : 1;

  const getCompanyColor = (rank: number) => {
    switch (rank) {
      case 1:
        return { bar: 'from-[#00f3ff] to-[#38bdf8]', text: 'text-[#00f3ff]', border: 'border-[#00f3ff]/40' };
      case 2:
        return { bar: 'from-[#ffd700] to-[#f59e0b]', text: 'text-[#ffd700]', border: 'border-[#ffd700]/40' };
      case 3:
        return { bar: 'from-[#ff0055] to-[#f43f5e]', text: 'text-[#ff0055]', border: 'border-[#ff0055]/40' };
      case 4:
        return { bar: 'from-[#00ff88] to-[#10b981]', text: 'text-[#00ff88]', border: 'border-[#00ff88]/40' };
      default:
        return { bar: 'from-[#8b00ff] to-[#a855f7]', text: 'text-[#8b00ff]', border: 'border-[#8b00ff]/40' };
    }
  };

  return (
    <div className="glass-panel p-6 rounded-3xl border border-[#ffd700]/20 shadow-2xl flex flex-col h-full space-y-4">
      {/* Section Header */}
      <div className="flex items-center justify-between pb-3 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-[#00f3ff]/10 border border-[#00f3ff]/30 text-[#00f3ff]">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-black text-white tracking-wider uppercase font-sans">
              BATALHA CORPORATIVA // TOP 5
            </h2>
            <p className="text-[11px] text-gray-400">Pontuação total agregada por empresa</p>
          </div>
        </div>

        <span className="text-[10px] font-bold px-2.5 py-1 rounded-md bg-[#ffd700]/10 text-[#ffd700] border border-[#ffd700]/30 uppercase tracking-widest font-mono">
          RANKING EMPRESAS
        </span>
      </div>

      {/* Companies List */}
      <div className="flex-1 space-y-3.5 flex flex-col justify-around">
        {companies.slice(0, 5).map((comp) => {
          const colors = getCompanyColor(comp.rank);
          const percentage = Math.max(15, Math.round((comp.total_score / maxScore) * 100));

          return (
            <div
              key={comp.company_canonical}
              className={`p-4 rounded-2xl bg-black/40 border transition-all ${
                comp.rank === 1 ? 'border-[#00f3ff]/50 bg-[#00f3ff]/5' : 'border-white/10'
              }`}
            >
              {/* Header Info */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2.5">
                  <span className={`w-6 h-6 rounded-lg bg-white/5 border border-white/10 text-xs font-black font-mono flex items-center justify-center ${colors.text}`}>
                    {comp.rank}
                  </span>
                  <span className="text-sm font-black text-white tracking-wide">
                    {comp.company_canonical}
                  </span>
                  <span className="text-[10px] text-gray-400 flex items-center gap-1 font-mono">
                    <Users className="w-3 h-3 text-gray-500" /> {comp.pilots_count} {comp.pilots_count === 1 ? 'piloto' : 'pilotos'}
                  </span>
                </div>

                <div className="text-right font-mono">
                  <span className={`text-sm font-black ${colors.text}`}>
                    {comp.total_score.toLocaleString()} <span className="text-[10px] text-gray-400 font-normal">PTS</span>
                  </span>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-white/5 rounded-full h-3 overflow-hidden p-0.5 border border-white/10">
                <div
                  className={`bg-gradient-to-r ${colors.bar} h-full rounded-full transition-all duration-1000 shadow-sm`}
                  style={{ width: `${percentage}%` }}
                />
              </div>

              {/* Footer Meta */}
              <div className="flex justify-between text-[10px] text-gray-400 mt-1.5 font-mono">
                <span>Top Individual: <b className="text-gray-200">+{comp.top_individual_score.toLocaleString()}</b></span>
                <span>{percentage}% do líder</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
