import React, { useState, useEffect, useRef } from 'react';
import { ShipSpecification, PilotInfo, EnergySliders, McpServerName, SubagentName, FALLBACK_PRESETS, MatchRecord } from '@jogo/shared';
import { createGameInstance } from './game/index.js';
import { audioManager } from './game/audio/AudioManager.js';
import { AttractScreen } from './components/AttractScreen.js';
import { RegistrationForm } from './components/RegistrationForm.js';
import { InstructionsPromptScreen } from './components/InstructionsPromptScreen.js';
import { EnergySlidersBuilder } from './components/EnergySlidersBuilder.js';
import { HandoffTerminalScreen } from './components/HandoffTerminalScreen.js';
import { DebriefScreen } from './components/DebriefScreen.js';
import { Volume2, VolumeX, RotateCcw } from 'lucide-react';

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
  const [lastMatch, setLastMatch] = useState<Partial<MatchRecord> & { victory?: boolean; breakdown?: any } | undefined>();

  const gameContainerRef = useRef<HTMLDivElement>(null);
  const gameInstanceRef = useRef<Phaser.Game | null>(null);

  // Initialize Game Instance when entering GAMEPLAY stage
  useEffect(() => {
    if (stage === 'GAMEPLAY' && gameContainerRef.current && !gameInstanceRef.current) {
      gameInstanceRef.current = createGameInstance(
        gameContainerRef.current,
        shipSpec,
        false,
        (result) => {
          handleMatchComplete(result);
        }
      );
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
      await fetch('http://localhost:3000/api/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pilot,
          ...config
        })
      });
    } catch (err) {
      console.warn('[App] Daemon offline, proceeding to handoff:', err);
    }
    setStage('HANDOFF');
  };

  const handleShipReady = (forgedSpec: ShipSpecification) => {
    setShipSpec(forgedSpec);
    setStage('GAMEPLAY');
  };

  const handleEmergencyFallback = () => {
    setShipSpec(FALLBACK_PRESETS.interceptor);
    setStage('GAMEPLAY');
  };

  const handleMatchComplete = (result: { finalScore: number; victory: boolean; breakdown: any }) => {
    const matchRecord = {
      match_id: `match_${Date.now()}`,
      callsign: pilot.callsign,
      company_canonical: pilot.company_canonical,
      final_score: result.finalScore,
      created_at: new Date().toISOString(),
      victory: result.victory,
      breakdown: result.breakdown
    };

    setLastMatch(matchRecord);

    // Save to daemon SQLite buffer
    fetch('http://localhost:3000/api/matches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(matchRecord)
    }).catch(() => {});

    setStage('DEBRIEF');
  };

  const handleReset = () => {
    if (gameInstanceRef.current) {
      gameInstanceRef.current.destroy(true);
      gameInstanceRef.current = null;
    }
    audioManager.stopMusic();
    fetch('http://localhost:3000/api/session/reset', { method: 'POST' }).catch(() => {});
    setStage('ATTRACT');
  };

  const handleToggleMute = () => {
    const muted = audioManager.toggleMute();
    setIsMuted(muted);
  };

  return (
    <div className="flex h-screen w-screen bg-[#07080c] text-white overflow-hidden select-none font-sans">
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
        <InstructionsPromptScreen
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
          onShipReady={handleShipReady}
          onEmergencyFallback={handleEmergencyFallback}
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
