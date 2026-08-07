import React, { useEffect, useRef, useState } from 'react';
import { Play, RotateCcw, Shield, Zap, Crosshair, Wrench, X, Activity, Eye, Gauge } from 'lucide-react';
import { createGameInstance } from '../game/index.js';
import { MainGameScene } from '../game/scenes/MainGameScene.js';
import { ShipSpecification, FALLBACK_PRESETS } from '@jogo/shared';

interface DevGameWorkbenchProps {
  onClose: () => void;
}

const CUSTOM_PRESETS: Record<string, ShipSpecification> = {
  interceptor: FALLBACK_PRESETS.interceptor,
  vanguard: FALLBACK_PRESETS.vanguard,
  striker: FALLBACK_PRESETS.striker,
  vulcan_cannon: {
    $schema: 'https://json-schema.org/draft-07/schema#',
    pilot: { callsign: 'GLASS_CANNON', company_raw: 'Alpha', company_canonical: 'Alpha' },
    build_metadata: {
      selected_mcps: ['weapons-arsenal'],
      selected_subagents: ['combat-strategist'],
      energy_sliders: { offense: 50, speed: 30, defense: 10, tech: 10 },
      fast_grill_me_choices: { weapon_focus: 'vulcan_spread', visual_theme: 'synthwave_80s' },
      synergies_unlocked: ['Glass Cannon 🔥']
    },
    attributes: { speed_px_s: 340, max_hp: 3, shield_capacity: 1, hitbox_radius: 8 },
    weapons: {
      primary: { type: 'vulcan_spread', damage: 35, fire_rate: 10, bullet_speed: 750, spread_angle: 15 },
      secondary: { type: 'homing_missiles', damage: 120, cooldown_seconds: 4 }
    },
    visuals: { style_name: 'Vulcan Striker', primary_color: '#ff0055', secondary_color: '#00f3ff', engine_trail_color: '#ff0055', svg_path_data: 'M 64 10 L 92 85 L 82 98 L 64 88 L 46 98 L 36 85 Z' }
  },
  cyberpunk_gold: {
    $schema: 'https://json-schema.org/draft-07/schema#',
    pilot: { callsign: 'CYBER_ACE', company_raw: 'Pintudo', company_canonical: 'Pintudo' },
    build_metadata: {
      selected_mcps: ['weapons-arsenal', 'hull-propulsion', 'cybernetics-shields'],
      selected_subagents: ['aesthetic-designer'],
      energy_sliders: { offense: 35, speed: 25, defense: 20, tech: 20 },
      fast_grill_me_choices: { weapon_focus: 'laser_piercing', visual_theme: 'cyberpunk_gold' },
      synergies_unlocked: ['Titan Fortress 🛡️']
    },
    attributes: { speed_px_s: 280, max_hp: 5, shield_capacity: 2, hitbox_radius: 12 },
    weapons: {
      primary: { type: 'laser', damage: 40, fire_rate: 9, bullet_speed: 700, spread_angle: 0 },
      secondary: { type: 'homing_missiles', damage: 100, cooldown_seconds: 4 }
    },
    visuals: { style_name: 'PINTO-01 Cyberpunk Gold', primary_color: '#FFE600', secondary_color: '#00F0FF', engine_trail_color: '#FF007F', svg_path_data: 'M 64 12 L 98 48 L 108 88 L 84 82 L 64 95 L 44 82 L 20 88 L 30 48 Z' }
  }
};

export const DevGameWorkbench: React.FC<DevGameWorkbenchProps> = ({ onClose }) => {
  const gameContainerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<MainGameScene | null>(null);
  const [selectedPresetKey, setSelectedPresetKey] = useState<string>('cyberpunk_gold');
  const [activeSpec, setActiveSpec] = useState<ShipSpecification>(CUSTOM_PRESETS.cyberpunk_gold);

  // Live Tweaks State
  const [damage, setDamage] = useState<number>(40);
  const [fireRate, setFireRate] = useState<number>(9);
  const [speed, setSpeed] = useState<number>(280);
  const [weaponType, setWeaponType] = useState<'laser' | 'plasma' | 'vulcan_spread'>('laser');

  // Cheats / Toggles
  const [godMode, setGodMode] = useState<boolean>(false);
  const [physicsDebug, setPhysicsDebug] = useState<boolean>(false);

  // Live Telemetry
  const [metrics, setMetrics] = useState({
    rollingDps: 0,
    playerHp: 5,
    playerMaxHp: 5,
    playerShield: 2,
    bossActive: false,
    bossHp: 15000,
    bossMaxHp: 15000,
    bossPhase: 1,
    elapsedSeconds: 0
  });

  const [panelMinimized, setPanelMinimized] = useState<boolean>(false);

  // Initialize Phaser Game
  useEffect(() => {
    if (!gameContainerRef.current) return;

    const game = createGameInstance({
      container: gameContainerRef.current,
      shipSpec: activeSpec,
      isHardcore: false,
      devMode: true,
      onSceneReady: (scene) => {
        sceneRef.current = scene;
        scene.setPlayerGodMode(godMode);
      }
    });

    return () => {
      game.destroy(true);
      sceneRef.current = null;
    };
  }, [activeSpec]);

  // Telemetry Polling Loop (every 100ms)
  useEffect(() => {
    const interval = setInterval(() => {
      if (sceneRef.current && sceneRef.current.time) {
        const m = sceneRef.current.getLiveCombatMetrics(sceneRef.current.time.now);
        setMetrics({
          rollingDps: m.rollingDps,
          playerHp: m.playerHp,
          playerMaxHp: m.playerMaxHp,
          playerShield: m.playerShield,
          bossActive: m.bossActive,
          bossHp: m.bossHp,
          bossMaxHp: m.bossMaxHp,
          bossPhase: m.bossPhase,
          elapsedSeconds: m.elapsedSeconds
        });
      }
    }, 100);

    return () => clearInterval(interval);
  }, []);

  // Handlers for Live Controls
  const handlePresetSelect = (key: string) => {
    setSelectedPresetKey(key);
    const spec = CUSTOM_PRESETS[key];
    setActiveSpec(spec);
    setDamage(spec.weapons.primary.damage || 35);
    setFireRate(spec.weapons.primary.fire_rate || 8);
    setSpeed(spec.attributes.speed_px_s || 280);
    setWeaponType(spec.weapons.primary.type);
  };

  const handleDamageChange = (val: number) => {
    setDamage(val);
    sceneRef.current?.setPlayerDamage(val);
  };

  const handleFireRateChange = (val: number) => {
    setFireRate(val);
    sceneRef.current?.setPlayerFireRate(val);
  };

  const handleSpeedChange = (val: number) => {
    setSpeed(val);
    sceneRef.current?.setPlayerSpeed(val);
  };

  const handleWeaponTypeChange = (type: 'laser' | 'plasma' | 'vulcan_spread') => {
    setWeaponType(type);
    sceneRef.current?.setPrimaryWeaponType(type);
  };

  const handleToggleGodMode = () => {
    const next = !godMode;
    setGodMode(next);
    sceneRef.current?.setPlayerGodMode(next);
  };

  const handleTogglePhysicsDebug = () => {
    const isEnabled = sceneRef.current?.togglePhysicsDebug() ?? false;
    setPhysicsDebug(isEnabled);
  };

  const handleSpawnBoss = () => {
    sceneRef.current?.spawnBossImmediately();
  };

  const handleJumpPhase = (phase: 1 | 2 | 3) => {
    sceneRef.current?.jumpToBossPhase(phase);
  };

  const handleReviveBoss = () => {
    sceneRef.current?.reviveBoss();
  };

  return (
    <div className="relative w-screen h-screen bg-[#050512] flex overflow-hidden font-sans select-none">
      {/* 1. Game Canvas Container */}
      <div className="flex-1 h-full flex items-center justify-center relative bg-black/40">
        <div ref={gameContainerRef} className="shadow-2xl shadow-cyan-950/40 rounded-lg overflow-hidden border border-slate-800" />
      </div>

      {/* 2. Floating Dev Control Panel */}
      <div
        className={`absolute top-4 right-4 z-50 bg-[#090d16]/95 backdrop-blur-xl border border-cyan-500/30 rounded-xl shadow-2xl transition-all duration-200 flex flex-col ${
          panelMinimized ? 'w-auto' : 'w-96 max-h-[95vh] overflow-y-auto'
        }`}
      >
        {/* Panel Header */}
        <div className="p-3 border-b border-slate-800/80 flex items-center justify-between bg-slate-900/60 rounded-t-xl">
          <div className="flex items-center gap-2">
            <Wrench className="w-5 h-5 text-amber-400 animate-pulse" />
            <div>
              <div className="text-xs font-mono font-bold tracking-wider text-amber-400">ENGINE LAB // WORKBENCH</div>
              <div className="text-[10px] text-slate-400">Ambiente de Testes da Game Engine</div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPanelMinimized(!panelMinimized)}
              className="p-1 text-slate-400 hover:text-white text-xs px-2 bg-slate-800 rounded"
            >
              {panelMinimized ? 'Expandir' : 'Minimizar'}
            </button>
            <button
              onClick={onClose}
              className="p-1 text-red-400 hover:text-red-300 hover:bg-red-950/40 rounded"
              title="Fechar Engine Lab"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {!panelMinimized && (
          <div className="p-4 space-y-4 text-xs">
            {/* Section 1: Live Combat Telemetry */}
            <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800/80 space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono font-bold text-slate-300">
                <span className="flex items-center gap-1 text-cyan-400">
                  <Activity className="w-4 h-4" /> TELEMETRIA EM TEMPO REAL
                </span>
                <span className="text-amber-400">{metrics.elapsedSeconds}s decorridos</span>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 font-mono">
                <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
                  <div className="text-[10px] text-slate-400">PLAYER DPS (1s)</div>
                  <div className="text-base font-bold text-green-400">⚡ {metrics.rollingDps} DPS</div>
                </div>
                <div className="bg-slate-900/80 p-2 rounded border border-slate-800">
                  <div className="text-[10px] text-slate-400">PLAYER STATUS</div>
                  <div className="text-sm font-bold text-cyan-300">
                    HP: {metrics.playerHp}/{metrics.playerMaxHp} • S: {metrics.playerShield}
                  </div>
                </div>
              </div>

              {/* Boss Status */}
              <div className="bg-slate-900/80 p-2 rounded border border-slate-800 space-y-1">
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>DREADNOUGHT OVERLORD</span>
                  <span className="text-amber-400 font-bold">
                    {metrics.bossActive ? `FASE ${metrics.bossPhase} (${metrics.bossHp.toLocaleString()} HP)` : 'INATIVO'}
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className="h-full bg-gradient-to-r from-amber-500 to-cyan-400 transition-all duration-100"
                    style={{ width: `${Math.max(0, (metrics.bossHp / metrics.bossMaxHp) * 100)}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Section 2: Boss Quick Action Controls */}
            <div className="space-y-2">
              <div className="text-[11px] font-mono font-bold text-amber-400 flex items-center gap-1">
                <Zap className="w-4 h-4" /> COMANDOS DO CHEFÃO
              </div>
              <div className="grid grid-cols-2 gap-2 font-mono">
                <button
                  onClick={handleSpawnBoss}
                  className="p-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded font-bold transition flex items-center justify-center gap-1"
                >
                  <Play className="w-3.5 h-3.5" /> Spawnar Agora
                </button>
                <button
                  onClick={handleReviveBoss}
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded font-bold transition flex items-center justify-center gap-1"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Reviver Chefe
                </button>
              </div>

              <div className="grid grid-cols-3 gap-1.5 pt-1">
                <button
                  onClick={() => handleJumpPhase(1)}
                  className={`p-1.5 rounded text-[10px] font-mono font-bold border transition ${
                    metrics.bossPhase === 1
                      ? 'bg-cyan-500/30 text-cyan-200 border-cyan-400'
                      : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border-slate-800'
                  }`}
                >
                  ⚡ Fase 1 (Escudo)
                </button>
                <button
                  onClick={() => handleJumpPhase(2)}
                  className={`p-1.5 rounded text-[10px] font-mono font-bold border transition ${
                    metrics.bossPhase === 2
                      ? 'bg-amber-500/30 text-amber-200 border-amber-400'
                      : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border-slate-800'
                  }`}
                >
                  🌀 Fase 2 (Espiral)
                </button>
                <button
                  onClick={() => handleJumpPhase(3)}
                  className={`p-1.5 rounded text-[10px] font-mono font-bold border transition ${
                    metrics.bossPhase === 3
                      ? 'bg-red-500/30 text-red-200 border-red-400'
                      : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border-slate-800'
                  }`}
                >
                  💥 Fase 3 (Berserk)
                </button>
              </div>
            </div>

            {/* Section 3: Ship Presets */}
            <div className="space-y-2">
              <div className="text-[11px] font-mono font-bold text-cyan-400 flex items-center gap-1">
                <Crosshair className="w-4 h-4" /> SELETOR DE ARQUÉTIPO / PRESET
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {Object.keys(CUSTOM_PRESETS).map((key) => (
                  <button
                    key={key}
                    onClick={() => handlePresetSelect(key)}
                    className={`p-2 rounded text-left border transition ${
                      selectedPresetKey === key
                        ? 'bg-cyan-950/60 border-cyan-400 text-cyan-200 font-bold'
                        : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    <div className="text-[11px] truncate">{CUSTOM_PRESETS[key].visuals.style_name}</div>
                    <div className="text-[9px] text-slate-500 font-mono">
                      {CUSTOM_PRESETS[key].weapons.primary.type} • {CUSTOM_PRESETS[key].attributes.speed_px_s}px/s
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Section 4: Live Sliders (Damage, Fire Rate, Speed) */}
            <div className="space-y-3 bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
              <div className="text-[11px] font-mono font-bold text-slate-300 flex items-center gap-1">
                <Gauge className="w-4 h-4 text-cyan-400" /> SLIDERS AO VIVO (JOGADOR)
              </div>

              {/* Weapon Type Buttons */}
              <div className="grid grid-cols-3 gap-1">
                {(['laser', 'plasma', 'vulcan_spread'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => handleWeaponTypeChange(type)}
                    className={`p-1 text-[10px] font-mono rounded border capitalize ${
                      weaponType === type
                        ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500 font-bold'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:bg-slate-800'
                    }`}
                  >
                    {type.replace('_', ' ')}
                  </button>
                ))}
              </div>

              {/* Damage Slider */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                  <span>DANO PRIMÁRIO:</span>
                  <span className="text-amber-400 font-bold">{damage} DMG</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="150"
                  step="5"
                  value={damage}
                  onChange={(e) => handleDamageChange(Number(e.target.value))}
                  className="w-full accent-amber-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              {/* Fire Rate Slider */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                  <span>CADÊNCIA (TIROS/SEG):</span>
                  <span className="text-cyan-400 font-bold">{fireRate} RPS</span>
                </div>
                <input
                  type="range"
                  min="3"
                  max="16"
                  step="1"
                  value={fireRate}
                  onChange={(e) => handleFireRateChange(Number(e.target.value))}
                  className="w-full accent-cyan-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>

              {/* Speed Slider */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                  <span>VELOCIDADE DA NAVE:</span>
                  <span className="text-emerald-400 font-bold">{speed} px/s</span>
                </div>
                <input
                  type="range"
                  min="160"
                  max="450"
                  step="10"
                  value={speed}
                  onChange={(e) => handleSpeedChange(Number(e.target.value))}
                  className="w-full accent-emerald-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                />
              </div>
            </div>

            {/* Section 5: Cheats & Debug Toggles */}
            <div className="grid grid-cols-2 gap-2 font-mono">
              <button
                onClick={handleToggleGodMode}
                className={`p-2 rounded border flex items-center justify-center gap-1 font-bold transition ${
                  godMode
                    ? 'bg-emerald-950/80 border-emerald-400 text-emerald-300'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
                }`}
              >
                <Shield className="w-3.5 h-3.5" /> God Mode: {godMode ? 'ON' : 'OFF'}
              </button>

              <button
                onClick={handleTogglePhysicsDebug}
                className={`p-2 rounded border flex items-center justify-center gap-1 font-bold transition ${
                  physicsDebug
                    ? 'bg-purple-950/80 border-purple-400 text-purple-300'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
                }`}
              >
                <Eye className="w-3.5 h-3.5" /> Hitboxes: {physicsDebug ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
