import React from 'react';
import { Terminal, QrCode, Sparkles, Zap } from 'lucide-react';

export function AttractQrCode() {
  return (
    <div className="flight-panel p-4 rounded-3xl border border-slate-700/60 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#38bdf8] to-[#ff9e0b] p-0.5 flex items-center justify-center shadow-lg shadow-cyan-950/40 flex-shrink-0">
          <div className="w-full h-full bg-slate-950 rounded-2xl flex items-center justify-center">
            <Terminal className="w-6 h-6 text-[#ff9e0b]" />
          </div>
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-black text-white uppercase tracking-wider">
              SUA VEZ DE PILOTAR
            </span>
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[#10b981]/20 text-[#10b981] border border-[#10b981]/40 uppercase font-mono">
              GRATUITO
            </span>
          </div>
          <p className="text-[11px] text-slate-400 leading-snug">
            Vá até a bancada, escolha seus MCPs e forje sua nave no <b>Antigravity CLI</b>!
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 bg-slate-900/80 p-2 px-3 rounded-2xl border border-slate-800 flex-shrink-0">
        <div className="w-9 h-9 bg-white rounded-lg p-1 flex items-center justify-center">
          <div className="w-full h-full border-2 border-black grid grid-cols-3 gap-0.5 p-0.5">
            <div className="bg-black rounded-xs" />
            <div className="bg-black rounded-xs" />
            <div className="bg-transparent" />
            <div className="bg-black rounded-xs" />
            <div className="bg-transparent" />
            <div className="bg-black rounded-xs" />
            <div className="bg-transparent" />
            <div className="bg-black rounded-xs" />
            <div className="bg-black rounded-xs" />
          </div>
        </div>
        <div className="text-left font-mono">
          <div className="text-[9px] text-slate-400">ESCANEIE O QR</div>
          <div className="text-[10px] font-bold text-[#38bdf8]">BOOTH SUMMIT</div>
        </div>
      </div>
    </div>
  );
}
