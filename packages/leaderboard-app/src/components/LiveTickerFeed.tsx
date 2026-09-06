import React from 'react';
import { Radio, Zap, Flame, Clock } from 'lucide-react';

export interface RecentMatchEntry {
  match_id: string;
  callsign: string;
  company_canonical: string;
  final_score: number;
  /** Hora em que a nuvem INGERIU a partida (`serverTimestamp`), não em que ela foi jogada. */
  created_at: string;
  /**
   * Hora do relógio do estande, carimbada na hora da partida. Ausente nas partidas anteriores ao
   * campo — daí o fallback. É o que a TV mostra: um estande que ficou sem rede e drenou a fila
   * depois faria dez partidas antigas aparecerem todas com o horário do religamento.
   */
  played_at?: string;
}

interface LiveTickerFeedProps {
  recentMatches: RecentMatchEntry[];
}

export function LiveTickerFeed({ recentMatches }: LiveTickerFeedProps) {
  // Duplicate array for seamless infinite marquee loop
  const displayItems = recentMatches.length > 0 ? [...recentMatches, ...recentMatches] : [];

  return (
    <div className="w-full h-12 bg-slate-950/90 border-t border-slate-800 backdrop-blur-md flex items-center px-4 overflow-hidden relative select-none font-mono">
      {/* Fixed Left Badge */}
      <div className="flex items-center gap-2 pr-4 bg-slate-950 border-r border-slate-800 z-10 flex-shrink-0">
        <div className="w-2.5 h-2.5 rounded-full bg-[#ff9e0b] animate-ping" />
        <span className="text-[11px] font-black text-white uppercase tracking-widest flex items-center gap-1.5">
          <Radio className="w-3.5 h-3.5 text-[#38bdf8]" /> LIVE FEED
        </span>
      </div>

      {/* Marquee Content */}
      <div className="flex-1 overflow-hidden relative">
        <div className="animate-marquee flex items-center gap-8 pl-4">
          {displayItems.map((item, idx) => (
            <div key={`${item.match_id}-${idx}`} className="flex items-center gap-2 text-xs flex-shrink-0">
              <Zap className="w-3 h-3 text-[#ff9e0b]" />
              <span className="font-bold text-white">{item.callsign}</span>
              <span className="text-slate-400">({item.company_canonical})</span>
              <span className="font-bold text-[#10b981]">
                +{item.final_score.toLocaleString()} PTS
              </span>
              <span className="text-slate-500 text-[10px]">
                [{new Date(item.played_at ?? item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}]
              </span>
              <span className="text-slate-700 ml-4">•</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
