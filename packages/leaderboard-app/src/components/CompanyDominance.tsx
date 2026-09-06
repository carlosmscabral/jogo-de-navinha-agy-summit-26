import React from 'react';
import { Building2, Users, Flame, Award, TrendingUp } from 'lucide-react';
import { useAutoScroll } from '../use-auto-scroll.js';

export interface CompanyRankEntry {
  rank: number;
  company_canonical: string;
  total_score: number;
  pilots_count: number;
  top_individual_score: number;
}

interface CompanyDominanceProps {
  companies: CompanyRankEntry[];
  /** `false` enquanto a visão educativa está no ar: não há por que animar uma lista fora da tela. */
  scrolling: boolean;
}

export function CompanyDominance({ companies, scrolling }: CompanyDominanceProps) {
  const listRef = useAutoScroll<HTMLDivElement>(scrolling);
  const maxScore = companies.length > 0 ? companies[0].total_score : 1;

  const getCompanyColor = (rank: number) => {
    switch (rank) {
      case 1:
        return { bar: 'from-[#ff9e0b] to-[#f59e0b]', text: 'text-[#ff9e0b]', border: 'border-[#ff9e0b]/40' };
      case 2:
        return { bar: 'from-[#38bdf8] to-[#60a5fa]', text: 'text-[#38bdf8]', border: 'border-[#38bdf8]/40' };
      case 3:
        return { bar: 'from-[#10b981] to-[#34d399]', text: 'text-[#10b981]', border: 'border-[#10b981]/40' };
      case 4:
        return { bar: 'from-[#e2e8f0] to-[#94a3b8]', text: 'text-[#e2e8f0]', border: 'border-slate-600' };
      default:
        return { bar: 'from-[#f97316] to-[#ea580c]', text: 'text-[#f97316]', border: 'border-orange-500/40' };
    }
  };

  return (
    <div className="flight-panel p-6 rounded-3xl border border-slate-700/60 shadow-2xl flex flex-col h-full space-y-4">
      {/* Section Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-700/60">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-[#38bdf8]/10 border border-[#38bdf8]/30 text-[#38bdf8]">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-black text-white tracking-wider uppercase font-sans">
              BATALHA CORPORATIVA // TOP 15
            </h2>
            <p className="text-[11px] text-slate-400 font-mono">Pontuação total agregada por empresa</p>
          </div>
        </div>

        <span className="text-[10px] font-bold px-2.5 py-1 rounded-md bg-[#ff9e0b]/10 text-[#ff9e0b] border border-[#ff9e0b]/30 uppercase tracking-widest font-mono">
          RANKING EMPRESAS
        </span>
      </div>

      {/* Companies List — mesmo par pai/filho do hall da fama: o pai recorta, o filho rola.
          O `justify-around` de antes distribuía a folga de 5 cards numa coluna sobrando; com 15
          não há folga nenhuma, e ele brigaria com o `translateY` da rolagem. */}
      <div className="flex-1 overflow-hidden">
        <div ref={listRef} className="space-y-3.5 will-change-transform">
          {companies.map((comp) => {
            const colors = getCompanyColor(comp.rank);
            const percentage = Math.max(15, Math.round((comp.total_score / maxScore) * 100));

            return (
              <div
                key={comp.company_canonical}
                className={`p-4 rounded-2xl bg-slate-900/60 border transition-all ${
                  comp.rank === 1 ? 'border-[#ff9e0b]/40 bg-[#ff9e0b]/5' : 'border-slate-800'
                }`}
              >
                {/* Header Info */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2.5">
                    <span className={`w-6 h-6 rounded-lg bg-slate-950 border border-slate-800 text-xs font-black font-mono flex items-center justify-center ${colors.text}`}>
                      {comp.rank}
                    </span>
                    <span className="text-sm font-black text-white tracking-wide">
                      {comp.company_canonical}
                    </span>
                    <span className="text-[10px] text-slate-400 flex items-center gap-1 font-mono">
                      <Users className="w-3 h-3 text-slate-500" /> {comp.pilots_count} {comp.pilots_count === 1 ? 'piloto' : 'pilotos'}
                    </span>
                  </div>

                  <div className="text-right font-mono">
                    <span className={`text-sm font-black ${colors.text}`}>
                      {comp.total_score.toLocaleString()} <span className="text-[10px] text-slate-400 font-normal">PTS</span>
                    </span>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-slate-950 rounded-full h-3 overflow-hidden p-0.5 border border-slate-800">
                  <div
                    className={`bg-gradient-to-r ${colors.bar} h-full rounded-full transition-all duration-1000 shadow-sm`}
                    style={{ width: `${percentage}%` }}
                  />
                </div>

                {/* Footer Meta */}
                <div className="flex justify-between text-[10px] text-slate-400 mt-1.5 font-mono">
                  <span>Top Individual: <b className="text-slate-200">+{comp.top_individual_score.toLocaleString()}</b></span>
                  <span>{percentage}% do líder</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
