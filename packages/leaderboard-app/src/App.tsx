import React, { useState, useEffect, useCallback, useReducer } from 'react';
import { Trophy, Radio, Zap, Users, Flame, Shield, Globe, Terminal } from 'lucide-react';
import { HallOfFame, TopPilotEntry } from './components/HallOfFame.js';
import { CompanyDominance, CompanyRankEntry } from './components/CompanyDominance.js';
import { LiveTickerFeed, RecentMatchEntry } from './components/LiveTickerFeed.js';
import { RecordCelebrationModal } from './components/RecordCelebrationModal.js';
import { AntigravityShowcase } from './components/AntigravityShowcase.js';
import { subscribeToLeaderboard, LeaderboardState, SourceStatus } from './firestore-source.js';
import { enqueueCelebration, isCelebrationWorthy, type Celebration } from './celebration-queue.js';
import {
  rotationReducer,
  initialRotationState,
  DEFAULT_ROTATION_CONFIG,
  type RotationEvent,
  type RotationState
} from './view-rotation.js';

const SOURCE_BADGE: Record<SourceStatus, { label: string; className: string }> = {
  cloud: { label: 'NUVEM', className: 'bg-[#10b981]/20 text-[#10b981] border-[#10b981]/40' },
  local: { label: 'LOCAL', className: 'bg-[#38bdf8]/20 text-[#38bdf8] border-[#38bdf8]/40' },
  offline: { label: 'SEM SINAL', className: 'bg-[#ef4444]/20 text-[#ef4444] border-[#ef4444]/40' }
};

export function App() {
  const [data, setData] = useState<LeaderboardState>({
    topPilots: [],
    companyRankings: [],
    recentMatches: [],
    stats: { total_pilots: 0, total_matches: 0, top_score: 0 }
  });

  const [source, setSource] = useState<SourceStatus>('offline');
  /**
   * FILA, não slot único. Era `celebrationMatch`, sobrescrito a cada recorde: com dois estandes
   * jogando ao mesmo tempo, dois recordes dentro da janela de 7 s do modal fazem o segundo apagar
   * o primeiro, e o visitante perde exatamente o momento que a experiência inteira existe para
   * produzir. Agora cada um aparece por vez, e a fila anda no `onDismiss`.
   */
  const [celebrations, setCelebrations] = useState<Celebration[]>([]);
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString());

  /**
   * `useReducer`, e não `useState`, pela alternância placar ↔ painel do Antigravity: o efeito de
   * assinatura roda com deps `[]` e precisa disparar `FORCE_SCOREBOARD` de dentro do `onNewMatch`.
   * O `dispatch` do React é estável entre renders; um setter capturado naquele efeito enxergaria
   * para sempre o estado do primeiro render.
   */
  const [rotation, dispatchRotation] = useReducer(
    (s: RotationState, e: RotationEvent) => rotationReducer(s, e, DEFAULT_ROTATION_CONFIG),
    DEFAULT_ROTATION_CONFIG,
    initialRotationState
  );
  const noPlacar = rotation.view === 'scoreboard';

  // Um único intervalo de 1 s move o relógio do cabeçalho E o cronômetro da alternância. Dois
  // timers correndo em paralelo não trariam nada além de mais uma coisa para desalinhar.
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      dispatchRotation({ type: 'TICK', deltaMs: 1000 });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  /**
   * O controle do apresentador. O estande usa um apontador que se anuncia como teclado, então
   * "avançar slide" chega como seta ou espaço. Qualquer outra tecla só RENOVA a retenção — e só
   * se o painel já estiver no ar (ver `OPERATOR_ACTIVITY` em `view-rotation.ts`): uma tecla
   * esbarrada não pode tirar o placar do ar no meio do evento.
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
        case ' ':
          e.preventDefault();
          dispatchRotation({ type: 'OPERATOR_NEXT' });
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
          e.preventDefault();
          dispatchRotation({ type: 'OPERATOR_PREV' });
          break;
        default:
          dispatchRotation({ type: 'OPERATOR_ACTIVITY' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const dismissCelebration = useCallback(() => {
    setCelebrations((queue) => queue.slice(1));
  }, []);

  // Leaderboard data: Firestore onSnapshot as primary source, local bridge
  // (fetch + WebSocket) as fallback. See firestore-source.ts.
  useEffect(() => {
    const unsubscribe = subscribeToLeaderboard({
      onData: (state) => setData(state),
      onSourceChange: (status) => setSource(status),
      // `rank` chega resolvido da fonte, calculado sobre o estado já mesclado — ver o comentário
      // em `LeaderboardHandlers.onNewMatch`. Aqui não se consulta mais nenhum estado do React.
      onNewMatch: (match, rank) => {
        if (!isCelebrationWorthy(rank)) return;
        // Um pódio novo vence qualquer coisa que esteja no ar, inclusive a retenção manual do
        // apresentador: celebrar por cima do painel institucional, ou pior, não celebrar, é
        // perder exatamente o clímax que a experiência inteira existe para produzir.
        dispatchRotation({ type: 'FORCE_SCOREBOARD' });
        setCelebrations((queue) => enqueueCelebration(queue, { match, rank }));
      }
    });
    return unsubscribe;
  }, []);

  const currentCelebration = celebrations[0] ?? null;

  return (
    <div className="flex flex-col h-screen w-screen bg-obsidian-950 text-white overflow-hidden select-none font-sans relative">
      {/* Background Solar Amber & Cobalt Gradients */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-[#38bdf8]/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-[#ff9e0b]/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-10 left-1/3 w-96 h-96 bg-[#10b981]/5 rounded-full blur-3xl pointer-events-none" />

      {/* Top Header Bar */}
      <header className="px-8 py-4 bg-slate-950/80 border-b border-slate-800 backdrop-blur-md flex items-center justify-between z-20 flex-shrink-0">
        {/* Left: Event Branding */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#38bdf8] to-[#ff9e0b] p-0.5 flex items-center justify-center shadow-[0_0_20px_rgba(56,189,248,0.4)]">
            <div className="w-full h-full bg-obsidian-950 rounded-2xl flex items-center justify-center font-black text-xs text-[#38bdf8] font-mono">
              AGY
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-black text-white tracking-widest uppercase font-sans">
                GOOGLE CLOUD SUMMIT 2026
              </h1>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#ff9e0b]/20 text-[#ff9e0b] border border-[#ff9e0b]/40 uppercase tracking-wider font-mono">
                LIVE ARENA
              </span>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider font-mono flex items-center gap-1 ${SOURCE_BADGE[source].className}`}
                title="Fonte dos dados do placar"
              >
                <Radio className="w-2.5 h-2.5" /> {SOURCE_BADGE[source].label}
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono">
              Painel Oficial de Telemetria & Forja de Naves com Antigravity CLI
            </p>
          </div>
        </div>

        {/* Right: Live Meta Counters & Clock */}
        <div className="flex items-center gap-6 font-mono text-xs">
          <div className="px-4 py-2 rounded-2xl bg-slate-900/60 border border-slate-800 text-center">
            <div className="text-[10px] text-slate-400 uppercase">Pilotos Inscritos</div>
            <div className="text-sm font-black text-[#38bdf8] flex items-center justify-center gap-1">
              <Users className="w-3.5 h-3.5" /> {data.stats.total_pilots || data.topPilots.length}
            </div>
          </div>

          <div className="px-4 py-2 rounded-2xl bg-slate-900/60 border border-slate-800 text-center">
            <div className="text-[10px] text-slate-400 uppercase">Recorde do Dia</div>
            <div className="text-sm font-black text-[#ff9e0b] flex items-center justify-center gap-1">
              <Trophy className="w-3.5 h-3.5" /> {data.stats.top_score.toLocaleString()} PTS
            </div>
          </div>

          <div className="px-4 py-2 rounded-2xl bg-slate-900/60 border border-slate-800 text-center">
            <div className="text-[10px] text-slate-400 uppercase">Horário Oficial</div>
            <div className="text-sm font-black text-slate-200 font-mono">
              {currentTime}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content — duas visões alternando na MESMA caixa. Cabeçalho e ticker ficam montados
          nos dois casos: é o que dá continuidade e mantém o LIVE FEED correndo o tempo todo. */}
      {noPlacar ? (
        <main className="flex-1 p-6 grid grid-cols-1 md:grid-cols-12 gap-6 overflow-hidden z-10">
          {/* Left Column (7 Cols): Hall of Fame Top 20 Individual */}
          <div className="md:col-span-7 h-full overflow-hidden">
            <HallOfFame pilots={data.topPilots} scrolling={noPlacar} />
          </div>

          {/* Right Column (5 Cols): Company Dominance. O antigo bloco "SUA VEZ DE PILOTAR" com o
              QR desenhado à mão saiu daqui; a chamada para ação virou o fecho da terceira seção
              do painel do Antigravity, onde ela é verdadeira. */}
          <div className="md:col-span-5 h-full overflow-hidden">
            <CompanyDominance companies={data.companyRankings} scrolling={noPlacar} />
          </div>
        </main>
      ) : (
        <main className="flex-1 p-6 overflow-hidden z-10">
          <AntigravityShowcase section={rotation.section} holdMs={rotation.holdMs} />
        </main>
      )}

      {/* Bottom Ticker Feed */}
      <footer className="z-20 flex-shrink-0">
        <LiveTickerFeed recentMatches={data.recentMatches} />
      </footer>

      {/* Celebration Modal (When a new Top 3 score is homologated) — um por vez, vindo da fila.
          A `key` por `match_id` é o que força a remontagem entre duas celebrações seguidas: o
          cronômetro de 7 s e o confete do modal vivem num `useEffect` que não reroda só porque
          as props mudaram, então sem ela a segunda celebração herdaria o tempo restante da
          primeira e sumiria em um piscar. */}
      {currentCelebration && (
        <RecordCelebrationModal
          key={currentCelebration.match.match_id}
          match={currentCelebration.match}
          rank={currentCelebration.rank}
          onDismiss={dismissCelebration}
        />
      )}
    </div>
  );
}
