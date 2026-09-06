import React, { useEffect, useRef } from 'react';
import { Trophy, Crown, Sparkles, Flame, User, Building2 } from 'lucide-react';
import { MatchRecord } from '@jogo/shared';

interface RecordCelebrationModalProps {
  match: Partial<MatchRecord>;
  rank: number;
  onDismiss: () => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  decay: number;
  rotation: number;
  vRot: number;
}

export function RecordCelebrationModal({ match, rank, onDismiss }: RecordCelebrationModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors = ['#ff9e0b', '#f59e0b', '#38bdf8', '#60a5fa', '#10b981', '#ffffff'];
    const particles: Particle[] = [];

    // Spawn 160 celebratory aerospace particles
    for (let i = 0; i < 160; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 9;
      particles.push({
        x: canvas.width / 2,
        y: canvas.height * 0.45,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 3,
        size: 5 + Math.random() * 8,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: 1,
        decay: 0.006 + Math.random() * 0.01,
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 0.2
      });
    }

    let animationFrameId: number;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.12; // Gravity
        p.alpha = Math.max(0, p.alpha - p.decay);
        p.rotation += p.vRot;

        if (p.alpha > 0) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.globalAlpha = p.alpha;
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
          ctx.restore();
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    const timer = setTimeout(() => {
      onDismiss();
    }, 7000);

    return () => {
      cancelAnimationFrame(animationFrameId);
      clearTimeout(timer);
    };
  }, [onDismiss]);

  const score = match.final_score || 0;
  const callsign = match.callsign || 'PILOTO';
  const company = match.company_canonical || 'GOOGLE';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-xl p-8 animate-fadeIn select-none font-sans">
      {/* Particle Canvas */}
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none z-10" />

      <div className="w-full max-w-2xl flight-panel p-10 rounded-3xl border-2 border-[#ff9e0b] shadow-[0_0_80px_rgba(255,158,11,0.4)] text-center space-y-6 relative overflow-hidden z-20">
        {/* Glow backdrop */}
        <div className="absolute -top-24 -left-24 w-72 h-72 bg-[#ff9e0b]/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-72 h-72 bg-[#38bdf8]/20 rounded-full blur-3xl pointer-events-none" />

        {/* Crown Badge */}
        <div className="inline-flex p-4 rounded-3xl bg-gradient-to-br from-[#ff9e0b] to-[#f59e0b] text-black shadow-[0_0_30px_rgba(255,158,11,0.7)] animate-bounce">
          {rank === 1 ? <Crown className="w-12 h-12 fill-black" /> : <Trophy className="w-12 h-12 fill-black" />}
        </div>

        <div className="space-y-2">
          <div className="text-xs font-black px-3 py-1 rounded-full bg-[#ff9e0b]/20 text-[#ff9e0b] border border-[#ff9e0b]/40 uppercase tracking-widest inline-block font-mono">
            {rank === 1 ? '👑 NOVO RECORDE SUPREMO DO SUMMIT! 👑' : `🏆 NOVO TOP ${rank} DO DIA! 🏆`}
          </div>
          <h2 className="text-4xl font-black text-white tracking-widest uppercase font-sans">
            PERFORMANCE HISTÓRICA!
          </h2>
          <p className="text-sm text-slate-300">
            A Forja de <b className="text-[#ff9e0b]">{callsign}</b> conquistou o ranking do evento!
          </p>
        </div>

        {/* Big Final Score */}
        <div className="p-6 rounded-2xl bg-slate-950/90 border border-slate-800 shadow-inner space-y-1 font-mono">
          <span className="text-xs text-slate-400 uppercase font-bold tracking-widest">
            Pontuação Homologada
          </span>
          <div className="text-5xl font-black text-[#ff9e0b] text-glow-amber tracking-tight">
            {score.toLocaleString()} PTS
          </div>
          <div className="flex items-center justify-center gap-3 text-xs text-slate-300 mt-2">
            <span className="flex items-center gap-1 text-[#ff9e0b] font-bold">
              <User className="w-3.5 h-3.5" /> {callsign}
            </span>
            <span className="text-slate-600">•</span>
            <span className="flex items-center gap-1 text-[#38bdf8] font-bold">
              <Building2 className="w-3.5 h-3.5" /> {company}
            </span>
          </div>
        </div>

        {/* CTA to Booth */}
        <div className="text-xs text-slate-400 font-mono pt-2">
          Visite uma das bancadas do estande para forjar sua própria nave com o <b className="text-[#ff9e0b]">Antigravity CLI</b>!
        </div>
      </div>
    </div>
  );
}
