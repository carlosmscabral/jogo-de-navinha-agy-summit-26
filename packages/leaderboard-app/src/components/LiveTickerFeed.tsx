import React from 'react';
import { Radio, Zap, Flame, Clock } from 'lucide-react';

export interface RecentMatchEntry {
  match_id: string;
  callsign: string;
  company_canonical: string;
  final_score: number;
  created_at: string;
}

interface LiveTickerFeedProps {
  recentMatches: RecentMatchEntry[];
}

export function LiveTickerFeed({ recentMatches }: LiveTickerFeedProps) {
  // Duplicate array for seamless infinite marquee loop
  const displayItems = recentMatches.length > 0 ? [...recentMatches, ...recentMatches] : [];

  return (
    <div className="w-full h-12 bg-black/80 border-t border-white/10 backdrop-blur-md flex items-center px-4 overflow-hidden relative select-none">
      {/* Fixed Left Badge */}
      <div className="flex items-center gap-2 pr-4 bg-black/90 border-r border-white/10 z-10 flex-shrink-0">
        <div className="w-2.5 h-2.5 rounded-full bg-[#ff0055] animate-ping" />
        <span className="text-[11px] font-black text-white uppercase tracking-widest font-mono flex items-center gap-1.5">
          <Radio className="w-3.5 h-3.5 text-[#00f3ff]" /> LIVE FEED
        </span>
      </div>

      {/* Marquee Content */}
      <div className="flex-1 overflow-hidden relative">
        <div className="animate-marquee flex items-center gap-8 pl-4">
          {displayItems.map((item, idx) => (
            <div key={`${item.match_id}-${idx}`} className="flex items-center gap-2 text-xs flex-shrink-0">
              <Zap className="w-3 h-3 text-[#ffd700]" />
              <span className="font-bold text-white">{item.callsign}</span>
              <span className="text-gray-400">({item.company_canonical})</span>
              <span className="font-mono font-bold text-[#00ff88]">
                +{item.final_score.toLocaleString()} PTS
              </span>
              <span className="text-gray-600 font-mono text-[10px]">
                [{new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}]
              </span>
              <span className="text-gray-700 ml-4">•</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
