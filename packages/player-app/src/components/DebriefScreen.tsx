import React, { useState, useEffect } from 'react';
import { Trophy, RotateCcw, Award, CheckCircle, Clock, Heart, Flame } from 'lucide-react';
import { MatchRecord } from '@jogo/shared';

interface DebriefScreenProps {
  matchRecord?: Partial<MatchRecord>;
  onReset: () => void;
}

export function DebriefScreen({ matchRecord, onReset }: DebriefScreenProps) {
  const [countdown, setCountdown] = useState(15);

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          onReset();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [onReset]);

  const score = matchRecord?.final_score || 24500;
  const callsign = matchRecord?.callsign || 'PILOTO';
  const company = matchRecord?.company_canonical || 'GOOGLE';

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 bg-radial from-[#15082e] via-[#080214] to-[#020108] select-none">
      <div className="w-full max-w-xl glass-panel p-8 rounded-3xl border border-[#00f3ff]/40 shadow-2xl space-y-6 text-center">
        {/* Header Badge */}
        <div className="space-y-1 pb-4 border-b border-white/10">
          <div className="inline-flex p-3 rounded-2xl bg-[#ffd700]/10 border border-[#ffd700]/40 text-[#ffd700] mb-2 shadow-lg shadow-[#ffd700]/10">
            <Trophy className="w-8 h-8 animate-bounce" />
          </div>
          <h2 className="text-3xl font-black text-white tracking-widest uppercase">
            DEBRIEFING DA MISSÃO
          </h2>
          <p className="text-xs text-gray-300">
            Piloto: <b className="text-[#ffd700]">{callsign}</b> // Empresa: <b className="text-[#00f3ff]">{company}</b>
          </p>
        </div>

        {/* Big Final Score */}
        <div className="p-5 rounded-2xl bg-black/50 border border-[#ffd700]/40 shadow-inner space-y-1">
          <span className="text-xs text-gray-400 uppercase font-bold tracking-wider">Pontuação Gravada no Telão</span>
          <div className="text-4xl font-black text-[#ffd700] neon-text-gold font-mono">
            {score.toLocaleString()} PTS
          </div>
        </div>

        {/* Medals & Badges */}
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-center space-y-1">
            <Award className="w-5 h-5 text-[#00f3ff] mx-auto" />
            <div className="text-[11px] font-bold text-gray-200">CYBER ACE</div>
            <div className="text-[9px] text-gray-400">Boss Derrotado</div>
          </div>
          <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-center space-y-1">
            <Flame className="w-5 h-5 text-[#ff0055] mx-auto" />
            <div className="text-[11px] font-bold text-gray-200">COMBO MASTER</div>
            <div className="text-[9px] text-gray-400">Sequência 2.5x</div>
          </div>
          <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-center space-y-1">
            <Clock className="w-5 h-5 text-[#00ff88] mx-auto" />
            <div className="text-[11px] font-bold text-gray-200">SPEEDRUNNER</div>
            <div className="text-[9px] text-gray-400">Bônus de Tempo</div>
          </div>
        </div>

        {/* Auto Reset Progress Bar */}
        <div className="space-y-2 pt-2">
          <div className="flex justify-between text-xs text-gray-400">
            <span>Próximo Piloto em:</span>
            <span className="font-mono font-bold text-[#00f3ff]">{countdown}s</span>
          </div>
          <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
            <div
              className="bg-gradient-to-r from-[#00f3ff] to-[#ff0055] h-full transition-all duration-1000"
              style={{ width: `${(countdown / 15) * 100}%` }}
            />
          </div>
        </div>

        {/* Reset Button */}
        <button
          onClick={onReset}
          className="w-full p-4 rounded-2xl bg-gradient-to-r from-[#00f3ff] to-[#ff0055] text-black text-xs font-black uppercase tracking-widest hover:scale-[1.02] transition-all shadow-[0_0_25px_rgba(0,243,255,0.6)] flex items-center justify-center gap-2"
        >
          <RotateCcw className="w-4 h-4 stroke-[3]" /> FINALIZAR AGORA / NOVO JOGADOR
        </button>
      </div>
    </div>
  );
}
