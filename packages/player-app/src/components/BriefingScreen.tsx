import {
  EVENT_BANNER,
  MCP_CATALOG,
  McpServerName,
  PilotInfo,
  computeBaselineAttributes,
  computeBaselineWeapons
} from '@jogo/shared';
import type { ReactNode } from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { ShipPreviewCanvas } from './ShipPreviewCanvas.js';

/**
 * Briefing: três painéis, uma frase cada, uma imagem cada.
 *
 * A tela anterior tinha cinco cards de prompt de exemplo que só serviam para alimentar um
 * `clipboard.writeText` — nada no fluxo consome prompt (`POST /api/session/start` não envia
 * nenhum), então o visitante lia ≈190 palavras e copiava um texto que não tinha efeito. Isto é a
 * lacuna L1 da Spec 01. O que sobrou é o guia de 3 passos, ampliado, dentro de um orçamento de
 * 60 palavras de corpo — a jornada inteira tem 2m30s de alvo e esta tela não produz nada.
 */

interface BriefingScreenProps {
  pilot: PilotInfo;
  onProceed: () => void;
  onBack: () => void;
}

/** Nave de exemplo do painel 2: linha de base de uma build equilibrada, não a nave de ninguém. */
const DEMO_SLIDERS = { offense: 25, speed: 25, defense: 25, tech: 25 };
const DEMO_ATTRIBUTES = computeBaselineAttributes(DEMO_SLIDERS);
const DEMO_WEAPONS = computeBaselineWeapons(DEMO_SLIDERS, 'vulcan_spread');

const ENERGY_BARS = [
  { label: 'Ataque', color: '#ff9e0b', height: '78%', delay: '0s' },
  { label: 'Velocidade', color: '#38bdf8', height: '54%', delay: '0.4s' },
  { label: 'Defesa', color: '#10b981', height: '66%', delay: '0.8s' },
  { label: 'Escudo', color: '#a78bfa', height: '40%', delay: '1.2s' }
];

export function BriefingScreen({ pilot, onProceed, onBack }: BriefingScreenProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 select-none font-sans">
      <div className="w-full max-w-5xl flight-panel p-8 rounded-3xl border border-slate-700/60 shadow-2xl space-y-6">
        <header className="flex justify-between items-end pb-4 border-b border-slate-700/60">
          <div>
            <span className="text-sm font-mono uppercase tracking-widest text-[#38bdf8]">
              Etapa 2 de 4 {EVENT_BANNER}
            </span>
            <h2 className="text-3xl font-black text-white tracking-wider uppercase">
              Como funciona
            </h2>
          </div>
          <div className="text-right font-mono">
            <div className="text-sm text-slate-400 uppercase">Piloto</div>
            <div className="text-lg font-bold text-[#ff9e0b]">{pilot.callsign}</div>
          </div>
        </header>

        <p className="text-center text-lg text-slate-200">
          Na <b className="text-white">próxima tela</b> você define perfil, armas e defesa.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Panel step={1} title="Você escolhe" accent="#38bdf8">
            <EnergyBarsIllustration />
            <p className="text-sm text-slate-300 leading-snug">
              Distribua 100 PU entre ataque, velocidade, defesa e escudo — e escolha quais
              servidores MCP a IA vai poder usar.
            </p>
          </Panel>

          <Panel step={2} title="A IA forja" accent="#ff9e0b">
            <ShipPreviewCanvas
              mode="demo"
              size={148}
              attributes={DEMO_ATTRIBUTES}
              weapons={DEMO_WEAPONS}
              className="mx-auto"
            />
            <p className="text-sm text-slate-300 leading-snug">
              No terminal ao lado você conversa em português com o{' '}
              <code className="text-[#ff9e0b] font-mono">agy</code>. Ele calibra as armas e desenha
              o casco.
            </p>
          </Panel>

          <Panel step={3} title="Você pilota" accent="#10b981">
            <OverlordIllustration />
            <p className="text-sm text-slate-300 leading-snug">
              90 segundos de combate. Derrube os drones e enfrente o Cyber Overlord.
            </p>
          </Panel>
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onBack}
            className="w-1/3 p-4 rounded-xl border border-slate-700 text-slate-300 text-sm font-bold uppercase hover:bg-slate-800 transition-all flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Voltar ao registro</span>
          </button>
          <button
            type="button"
            onClick={onProceed}
            className="w-2/3 p-4 rounded-xl bg-gradient-to-r from-[#ff9e0b] to-[#f59e0b] text-black text-lg font-black uppercase tracking-wider hover:scale-[1.02] transition-all shadow-[0_0_25px_rgba(255,158,11,0.5)] flex items-center justify-center gap-2"
          >
            <span>Configurar energia &amp; MCPs</span>
            <ChevronRight className="w-5 h-5 stroke-[3]" />
          </button>
        </div>
      </div>
    </div>
  );
}

function Panel({
  step,
  title,
  accent,
  children
}: {
  step: number;
  title: string;
  accent: string;
  children: ReactNode;
}) {
  return (
    <section className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3 flex flex-col">
      <div className="flex items-center gap-2">
        <span
          className="w-8 h-8 rounded-lg font-mono font-bold text-sm flex items-center justify-center border"
          style={{ color: accent, borderColor: `${accent}4d`, backgroundColor: `${accent}1a` }}
        >
          {step}
        </span>
        <h3 className="text-lg font-bold text-white uppercase tracking-wide">{title}</h3>
      </div>
      {children}
    </section>
  );
}

/** As quatro barras de energia da próxima tela, em CSS puro — sem asset e sem canvas. */
function EnergyBarsIllustration() {
  return (
    <div className="h-[148px] flex items-end justify-center gap-3" aria-hidden="true">
      {ENERGY_BARS.map((bar) => (
        <div key={bar.label} className="flex flex-col items-center gap-1.5 h-full justify-end">
          <div className="w-6 h-full flex items-end rounded bg-slate-950/80 border border-slate-800">
            <div
              className="w-full rounded animate-pulse"
              style={{
                height: bar.height,
                backgroundColor: bar.color,
                boxShadow: `0 0 12px ${bar.color}80`,
                animationDelay: bar.delay
              }}
            />
          </div>
          <span className="text-[11px] font-mono text-slate-400">{bar.label.slice(0, 3)}</span>
        </div>
      ))}
      <div className="flex flex-col gap-1.5 pl-2 border-l border-slate-800 self-center">
        {(Object.keys(MCP_CATALOG) as McpServerName[]).map((name) => (
          <span
            key={name}
            className="w-3 h-3 rounded-sm"
            style={{ backgroundColor: MCP_CATALOG[name].color }}
            title={MCP_CATALOG[name].label}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Silhueta do Cyber Overlord. É desenho estático de propósito: só um preview Phaser vivo por vez
 * fora da partida (ver `ship-preview-core.ts`), e esse slot é do painel 2.
 */
function OverlordIllustration() {
  return (
    <svg viewBox="0 0 128 128" className="h-[148px] mx-auto" aria-hidden="true">
      <path
        d="M 16 44 L 64 20 L 112 44 L 112 68 L 88 84 L 88 104 L 64 92 L 40 104 L 40 84 L 16 68 Z"
        fill="#1e293b"
        stroke="#ef4444"
        strokeWidth={2}
      />
      <circle cx="46" cy="54" r="6" fill="#ef4444" />
      <circle cx="82" cy="54" r="6" fill="#ef4444" />
      <path d="M 44 72 L 84 72" stroke="#ef4444" strokeWidth={3} strokeLinecap="round" />
    </svg>
  );
}
