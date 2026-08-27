import React, { useState, useEffect, useRef } from 'react';
import { ShipSpecification, PilotInfo, EnergySliders, McpServerName, SubagentName, FALLBACK_PRESETS, MatchRecord } from '@jogo/shared';
import { createGameInstance, MatchCompleteData } from './game/index.js';
import { buildMatchRecord } from './match-record.js';
import { audioManager } from './game/audio/AudioManager.js';
import { AttractScreen } from './components/AttractScreen.js';
import { RegistrationForm } from './components/RegistrationForm.js';
import { BriefingScreen } from './components/BriefingScreen.js';
import { EnergySlidersBuilder } from './components/EnergySlidersBuilder.js';
import { HandoffTerminalScreen } from './components/HandoffTerminalScreen.js';
import { DebriefScreen } from './components/DebriefScreen.js';
import { Volume2, VolumeX, RotateCcw } from 'lucide-react';
import { ENDPOINTS } from './config.js';

type AppStage = 'ATTRACT' | 'REGISTER' | 'INSTRUCTIONS' | 'BUILDER' | 'HANDOFF' | 'GAMEPLAY' | 'DEBRIEF';

export function App() {
  const [stage, setStage] = useState<AppStage>('ATTRACT');
  const [pilot, setPilot] = useState<PilotInfo>({
    callsign: 'CYBER_ACE',
    company_raw: 'Google',
    company_canonical: 'Google'
  });
  const [energySliders, setEnergySliders] = useState<EnergySliders>({ offense: 35, speed: 35, defense: 15, tech: 15 });
  const [selectedMcps, setSelectedMcps] = useState<McpServerName[]>(['weapons-arsenal', 'hull-propulsion', 'cybernetics-shields']);
  const [selectedSubagents, setSelectedSubagents] = useState<SubagentName[]>(['aesthetic-designer', 'combat-strategist']);
  const [shipSpec, setShipSpec] = useState<ShipSpecification>(FALLBACK_PRESETS.interceptor);
  const [isMuted, setIsMuted] = useState(false);
  const [lastMatch, setLastMatch] = useState<Partial<MatchRecord> & { victory?: boolean } | undefined>();
  const [pilotId, setPilotId] = useState<string>(() => crypto.randomUUID());
  const [sessionStartError, setSessionStartError] = useState<string | null>(null);
  const [sessionDeadline, setSessionDeadline] = useState<string | null>(null);

  const gameContainerRef = useRef<HTMLDivElement>(null);
  const gameInstanceRef = useRef<Phaser.Game | null>(null);

  // Initialize Game Instance when entering GAMEPLAY stage
  useEffect(() => {
    if (stage === 'GAMEPLAY' && gameContainerRef.current && !gameInstanceRef.current) {
      gameInstanceRef.current = createGameInstance(gameContainerRef.current, {
        shipSpec,
        isHardcore: false,
        onMatchComplete: (result) => {
          handleMatchComplete(result);
        }
      });
    }

    return () => {
      if (gameInstanceRef.current) {
        gameInstanceRef.current.destroy(true);
        gameInstanceRef.current = null;
      }
    };
  }, [stage, shipSpec]);

  // Global Hotkey Reset (Ctrl+Shift+F12)
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'F12') {
        handleReset();
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, []);

  const handleStartFromAttract = () => {
    setStage('REGISTER');
  };

  const handleRegister = (pilotData: PilotInfo) => {
    setPilot(pilotData);
    setStage('INSTRUCTIONS');
  };

  const handleProceedFromInstructions = () => {
    setStage('BUILDER');
  };

  const handleProceedToTerminal = async (config: {
    energy_sliders: EnergySliders;
    selected_mcps: McpServerName[];
    selected_subagents: SubagentName[];
  }) => {
    setEnergySliders(config.energy_sliders);
    setSelectedMcps(config.selected_mcps);
    setSelectedSubagents(config.selected_subagents);

    try {
      // Call Local Daemon to prepare workspace /tmp/booth_session
      const res = await fetch(`${ENDPOINTS.bridgeBase}/api/session/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pilot,
          ...config
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // O daemon resolve company_canonical/company_confidence de verdade (via resolveCompany)
      // e sanitiza o callsign -- o palpite local do registro (RegistrationForm.tsx) é só um
      // placeholder até essa resposta chegar. Sem isto, company_confidence nunca sai de
      // undefined no estado do cliente, e o registro da partida nunca sabe se a empresa
      // precisa de revisão manual (Spec 11 §4.11).
      const data: { pilot?: PilotInfo; deadline_at?: string } = await res.json();
      if (data.pilot) setPilot(data.pilot);
      // Prazo absoluto do teto rígido, calculado pelo daemon (que é quem conhece os timers e
      // qualquer override por env). A barra de tempo da tela do AGY conta a partir dele.
      setSessionDeadline(data.deadline_at ?? null);
      setSessionStartError(null);
      setStage('HANDOFF');
    } catch (err) {
      console.error('[App] Falha ao iniciar sessão no daemon, permanecendo na Forja:', err);
      setSessionStartError('Não foi possível conectar ao servidor da Forja. Verifique a conexão e tente novamente.');
    }
  };

  const handleShipReady = (forgedSpec: ShipSpecification) => {
    setShipSpec(forgedSpec);
    setStage('GAMEPLAY');
  };

  const handleMatchComplete = (result: MatchCompleteData) => {
    const matchRecord = buildMatchRecord(pilot, pilotId, shipSpec, result);

    setLastMatch(matchRecord);

    fetch(`${ENDPOINTS.bridgeBase}/api/matches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(matchRecord)
    })
      .then(async (response) => {
        if (!response.ok) {
          // O daemon responde 400 quando telemetry/snapshot/pilot_id estão
          // ausentes (Tarefa A7) — isso resolve a Promise normalmente, então
          // só um .catch() nunca detectaria a rejeição. Sem este log, o score
          // do visitante desaparece sem rastro visível para ninguém.
          const detail = await response.text().catch(() => '');
          console.error(`[App] Partida rejeitada pelo bridge (HTTP ${response.status}):`, detail);
        }
      })
      .catch((err) => console.warn('[App] Falha ao gravar a partida no bridge:', err));

    setStage('DEBRIEF');
  };

  const handleReset = () => {
    if (gameInstanceRef.current) {
      gameInstanceRef.current.destroy(true);
      gameInstanceRef.current = null;
    }
    audioManager.stopMusic();
    fetch(`${ENDPOINTS.bridgeBase}/api/session/reset`, { method: 'POST' }).catch(() => {});
    setPilotId(crypto.randomUUID());
    setSessionStartError(null);
    setStage('ATTRACT');
  };

  const handleToggleMute = () => {
    const muted = audioManager.toggleMute();
    setIsMuted(muted);
  };

  return (
    <div className="flex h-screen w-screen bg-obsidian-950 text-white overflow-hidden select-none font-sans">
      {/* Session-Start Error Banner */}
      {sessionStartError && (
        <div className="absolute top-4 left-4 z-50 max-w-md p-3 rounded-xl bg-red-950/90 border border-red-500/60 text-red-200 text-xs font-mono shadow-lg backdrop-blur-md flex items-start gap-3">
          <span>{sessionStartError}</span>
          <button
            onClick={() => setSessionStartError(null)}
            className="ml-auto text-red-300 hover:text-white font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Top Floating Controls Bar */}
      <div className="absolute top-4 right-4 z-50 flex items-center gap-3">
        {/* Reset Button */}
        {stage !== 'ATTRACT' && (
          <button
            onClick={handleReset}
            title="Resetar Experiência (Ctrl+Shift+F12)"
            className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-700 hover:border-red-500 hover:bg-red-500/10 transition-all text-slate-300 hover:text-red-400 shadow-lg backdrop-blur-md flex items-center gap-1.5 text-xs font-bold font-mono"
          >
            <RotateCcw className="w-4 h-4" />
            <span>RESET</span>
          </button>
        )}

        {/* Audio Mute Button */}
        <button
          onClick={handleToggleMute}
          title={isMuted ? 'Ativar Áudio & Música' : 'Mutar Áudio'}
          className="p-2.5 rounded-xl bg-slate-900/80 border border-slate-700 hover:border-[#38bdf8] hover:bg-[#38bdf8]/10 transition-all text-slate-300 hover:text-[#38bdf8] shadow-lg backdrop-blur-md"
        >
          {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4 text-[#38bdf8]" />}
        </button>
      </div>

      {/* Stage Router */}
      {stage === 'ATTRACT' && <AttractScreen onStart={handleStartFromAttract} />}

      {stage === 'REGISTER' && (
        <RegistrationForm onRegister={handleRegister} onBack={handleReset} />
      )}

      {stage === 'INSTRUCTIONS' && (
        <BriefingScreen
          pilot={pilot}
          onProceed={handleProceedFromInstructions}
          onBack={() => setStage('REGISTER')}
        />
      )}

      {stage === 'BUILDER' && (
        <EnergySlidersBuilder
          pilot={pilot}
          onProceedToTerminal={handleProceedToTerminal}
          onBack={() => setStage('INSTRUCTIONS')}
        />
      )}

      {stage === 'HANDOFF' && (
        <HandoffTerminalScreen
          pilot={pilot}
          energySliders={energySliders}
          selectedMcps={selectedMcps}
          selectedSubagents={selectedSubagents}
          deadlineAt={sessionDeadline}
          onShipReady={handleShipReady}
        />
      )}

      {stage === 'GAMEPLAY' && (
        <main className="flex-1 flex flex-col items-center justify-center p-4 relative bg-radial from-[#0e111a] via-[#08090f] to-[#040508] overflow-hidden">
          <div className="h-full max-h-[94vh] aspect-[3/4] relative rounded-2xl overflow-hidden border-2 border-slate-700/80 shadow-2xl shadow-cyan-950/40">
            <div id="game-container" ref={gameContainerRef} className="w-full h-full" />
          </div>
        </main>
      )}

      {stage === 'DEBRIEF' && (
        <DebriefScreen matchRecord={lastMatch} onReset={handleReset} />
      )}
    </div>
  );
}
