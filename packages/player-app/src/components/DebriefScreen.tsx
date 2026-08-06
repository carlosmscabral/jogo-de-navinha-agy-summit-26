import React, { useState, useEffect } from 'react';
import { Trophy, RotateCcw, Award, CheckCircle, Clock, Heart, Flame, ShieldAlert, Sparkles, User, Building2 } from 'lucide-react';
import { MatchRecord } from '@jogo/shared';

interface DebriefScreenProps {
  matchRecord?: Partial<MatchRecord> & { victory?: boolean; breakdown?: any };
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

  const score = matchRecord?.final_score || 0;
  const callsign = matchRecord?.callsign || 'PILOTO';
  const company = matchRecord?.company_canonical || 'GOOGLE';
  const isVictory = matchRecord?.victory ?? true;
  const breakdown = matchRecord?.breakdown;

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 bg-radial from-[#15082e] via-[#080214] to-[#020108] select-none font-sans">
      <div className="w-full max-w-xl glass-panel p-8 rounded-3xl border border-[#00f3ff]/40 shadow-2xl space-y-6 text-center animate-fadeIn">
        {/* Header Badge */}
        <div className="space-y-1 pb-4 border-b border-white/10">
          <div
            className={`inline-flex p-3 rounded-2xl border mb-2 shadow-lg ${
              isVictory
                ? 'bg-[#00ff88]/15 border-[#00ff88]/40 text-[#00ff88] shadow-[#00ff88]/20 animate-bounce'
                : 'bg-[#ff0055]/15 border-[#ff0055]/40 text-[#ff0055] shadow-[#ff0055]/20'
            }`}
          >
            {isVictory ? <Trophy className="w-9 h-9" /> : <ShieldAlert className="w-9 h-9" />}
          </div>
          <h2 className="text-3xl font-black text-white tracking-widest uppercase">
            {isVictory ? 'MISSÃO CUMPRIDA!' : 'DEBRIEFING DA MISSÃO'}
          </h2>
          <div className="flex items-center justify-center gap-3 text-xs text-gray-300">
            <span className="flex items-center gap-1 text-[#ffd700] font-bold">
              <User className="w-3.5 h-3.5" /> {callsign}
            </span>
            <span className="text-gray-500">•</span>
            <span className="flex items-center gap-1 text-[#00f3ff] font-bold">
              <Building2 className="w-3.5 h-3.5" /> {company}
            </span>
          </div>
        </div>

        {/* Big Final Score */}
        <div className="p-5 rounded-2xl bg-black/60 border border-[#ffd700]/40 shadow-inner space-y-1">
          <span className="text-xs text-gray-400 uppercase font-bold tracking-wider">
            Pontuação Registrada no Telão
          </span>
          <div className="text-4xl font-black text-[#ffd700] neon-text-gold font-mono">
            {score.toLocaleString()} PTS
          </div>
          {breakdown?.mcpMultiplier && breakdown.mcpMultiplier > 1.0 && (
            <div className="text-xs text-[#00f3ff] font-mono font-bold mt-1">
              ⚡ Multiplicador Especialista: {breakdown.mcpMultiplier}x
            </div>
          )}
        </div>

        {/* Medals & Achievements */}
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-center space-y-1">
            <Award className="w-5 h-5 text-[#00f3ff] mx-auto" />
            <div className="text-[11px] font-bold text-gray-200">{isVictory ? 'OVERLORD SLAYER' : 'BRAVE PILOT'}</div>
            <div className="text-[9px] text-gray-400">{isVictory ? 'Boss Destruído' : 'Combate Ativo'}</div>
          </div>
          <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-center space-y-1">
            <Flame className="w-5 h-5 text-[#ff0055] mx-auto" />
            <div className="text-[11px] font-bold text-gray-200">COMBAT SCORE</div>
            <div className="text-[9px] text-gray-400 font-mono">+{breakdown?.combatScore?.toLocaleString() || '0'}</div>
          </div>
          <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-center space-y-1">
            <Clock className="w-5 h-5 text-[#00ff88] mx-auto" />
            <div className="text-[11px] font-bold text-gray-200">BÔNUS TEMPO</div>
            <div className="text-[9px] text-gray-400 font-mono">+{breakdown?.timeBonus?.toLocaleString() || '0'}</div>
          </div>
        </div>

        {/* Auto Reset Progress Bar */}
        <div className="space-y-2 pt-2">
          <div className="flex justify-between text-xs text-gray-400">
            <span>Retornando para o Início em:</span>
            <span className="font-mono font-bold text-[#00f3ff]">{countdown}s</span>
          </div>
          <div className="w-full bg-white/10 rounded-full h-2.5 overflow-hidden">
            <div
              className="bg-gradient-to-r from-[#00f3ff] via-[#ffd700] to-[#ff0055] h-full transition-all duration-1000"
              style={{ width: `${(countdown / 15) * 100}%` }}
            />
          </div>
        </div>

        {/* Reset Button */}
        <button
          onClick={onReset}
          className="w-full p-4 rounded-2xl bg-gradient-to-r from-[#00f3ff] to-[#ff0055] text-black text-xs font-black uppercase tracking-widest hover:scale-[1.02] transition-all shadow-[0_0_25px_rgba(0,243,255,0.6)] flex items-center justify-center gap-2"
        >
          <RotateCcw className="w-4 h-4 stroke-[3]" /> PRÓXIMO PILOTO // NOVO JOGO
        </button>
      </div>
    </div>
  );
}
