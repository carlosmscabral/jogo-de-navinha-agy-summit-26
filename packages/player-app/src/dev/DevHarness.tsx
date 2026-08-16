import React, { useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { BALANCE, ShipSpecification, validateShipSpecification, randomSeed } from '@jogo/shared';
import { createGameInstance, DevGameOptions, DevTelemetryFrame, MatchCompleteData } from '../game/index.js';
import { DEV_PRESETS } from './presets.js';

const SCENE_KEY = 'MainGameScene';

type PoolKey = keyof DevTelemetryFrame['pools'];

const POOL_ROWS: { key: PoolKey; label: string }[] = [
  { key: 'primaryBullets', label: 'Balas primárias' },
  { key: 'secondaryMissiles', label: 'Mísseis secundários' },
  { key: 'enemyBullets', label: 'Balas inimigas' },
  { key: 'bossBullets', label: 'Balas do boss' },
  { key: 'enemies', label: 'Inimigos' }
];

/** Fields the harness controls; every remount is built from a full, explicit snapshot of these —
 * never from React state read inside the same tick as a preceding `setState`, since that would
 * race with React's batching. See `remount` below. */
interface HarnessState {
  spec: ShipSpecification;
  seed: number;
  godMode: boolean;
  autoFirePrimary: boolean;
  physicsDebug: boolean;
  timeScale: number;
  startAtSeconds: number | undefined;
  startAtBossPhase: 1 | 2 | 3 | undefined;
}

/**
 * Standalone dev harness (Task B4, Spec 09 §4). Runs the Phaser engine alone via
 * `createGameInstance` — the same function production uses — with no daemon, no `agy` CLI, and
 * no network calls anywhere in its import graph. Only imports from `src/game/`, `src/dev/` and
 * `@jogo/shared`; never from `App.tsx` or `src/components/`.
 */
export function DevHarness(): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const lastTelemetryPaintRef = useRef(0);

  const [specText, setSpecText] = useState(() => JSON.stringify(DEV_PRESETS.interceptor, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [selectedPresetKey, setSelectedPresetKey] = useState('interceptor');

  const [appliedSpec, setAppliedSpec] = useState<ShipSpecification>(DEV_PRESETS.interceptor);
  const [seed, setSeed] = useState<number>(() => randomSeed());
  const [godMode, setGodMode] = useState(false);
  const [autoFirePrimary, setAutoFirePrimary] = useState(false);
  const [physicsDebug, setPhysicsDebug] = useState(false);
  const [timeScale, setTimeScale] = useState(1);
  const [startAtSeconds, setStartAtSeconds] = useState<number | undefined>(undefined);
  const [startAtBossPhase, setStartAtBossPhase] = useState<1 | 2 | 3 | undefined>(undefined);

  const [isPaused, setIsPaused] = useState(false);
  const [telemetry, setTelemetry] = useState<DevTelemetryFrame | null>(null);
  const [lastMatchComplete, setLastMatchComplete] = useState<MatchCompleteData | null>(null);

  const canApply = !parseError && validationErrors.length === 0;

  function getScene(): Phaser.Scene | null {
    return gameRef.current?.scene.getScene(SCENE_KEY) ?? null;
  }

  /**
   * Destroys and recreates the Phaser instance from a full, explicit option set. Every control in
   * this panel funnels through here (that's the "remount(key)" the brief describes), except the
   * timeScale slider, which mutates the live scene directly so it can be tuned without losing
   * match progress.
   */
  function remount(overrides: Partial<HarnessState> = {}): void {
    const next: HarnessState = {
      spec: overrides.spec ?? appliedSpec,
      seed: overrides.seed ?? seed,
      godMode: overrides.godMode ?? godMode,
      autoFirePrimary: overrides.autoFirePrimary ?? autoFirePrimary,
      physicsDebug: overrides.physicsDebug ?? physicsDebug,
      timeScale: overrides.timeScale ?? timeScale,
      startAtSeconds: 'startAtSeconds' in overrides ? overrides.startAtSeconds : startAtSeconds,
      startAtBossPhase: 'startAtBossPhase' in overrides ? overrides.startAtBossPhase : startAtBossPhase
    };

    setAppliedSpec(next.spec);
    setSeed(next.seed);
    setGodMode(next.godMode);
    setAutoFirePrimary(next.autoFirePrimary);
    setPhysicsDebug(next.physicsDebug);
    setTimeScale(next.timeScale);
    setStartAtSeconds(next.startAtSeconds);
    setStartAtBossPhase(next.startAtBossPhase);
    setIsPaused(false);
    setTelemetry(null);
    setLastMatchComplete(null);

    gameRef.current?.destroy(true);
    gameRef.current = null;
    if (!containerRef.current) return;

    const options: DevGameOptions = {
      shipSpec: next.spec,
      seed: next.seed,
      isHardcore: false,
      godMode: next.godMode,
      autoFirePrimary: next.autoFirePrimary,
      physicsDebug: next.physicsDebug,
      timeScale: next.timeScale,
      startAtSeconds: next.startAtSeconds,
      startAtBossPhase: next.startAtBossPhase,
      onMatchComplete: (data) => setLastMatchComplete(data),
      onTelemetryFrame: (frame) => {
        // Throttled to ~10Hz: the scene still computes every field every frame (so DPS windows
        // stay accurate), this only limits how often React re-renders the panel.
        const now = performance.now();
        if (now - lastTelemetryPaintRef.current < 100) return;
        lastTelemetryPaintRef.current = now;
        setTelemetry(frame);
      }
    };

    gameRef.current = createGameInstance(containerRef.current, options);
  }

  useEffect(() => {
    remount();
    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSpecTextChange(text: string): void {
    setSpecText(text);
    try {
      const parsed = JSON.parse(text);
      setParseError(null);
      const result = validateShipSpecification(parsed);
      setValidationErrors(result.isValid ? [] : result.errors ?? []);
    } catch (err) {
      setParseError((err as Error).message);
      setValidationErrors([]);
    }
  }

  function handlePresetChange(key: string): void {
    setSelectedPresetKey(key);
    const preset = DEV_PRESETS[key];
    if (preset) handleSpecTextChange(JSON.stringify(preset, null, 2));
  }

  function handleApply(): void {
    if (!canApply) return;
    remount({ spec: JSON.parse(specText) as ShipSpecification });
  }

  function handleReplay(): void {
    remount({});
  }

  function handleRandomizeSeed(): void {
    setSeed(randomSeed());
  }

  function handleTimeScaleChange(value: number): void {
    setTimeScale(value);
    const scene = getScene();
    if (scene) {
      scene.time.timeScale = value;
      scene.physics.world.timeScale = 1 / value;
    }
  }

  function handleGodModeToggle(): void {
    remount({ godMode: !godMode });
  }

  function handleAutoFireToggle(): void {
    remount({ autoFirePrimary: !autoFirePrimary });
  }

  function handlePhysicsDebugToggle(): void {
    remount({ physicsDebug: !physicsDebug });
  }

  function handlePhaseButton(target: 'start' | 'boss' | 'phase2' | 'phase3'): void {
    if (target === 'start') {
      remount({ startAtSeconds: undefined, startAtBossPhase: undefined });
    } else if (target === 'boss') {
      remount({ startAtSeconds: BALANCE.match.boss_spawn_s, startAtBossPhase: undefined });
    } else if (target === 'phase2') {
      remount({ startAtSeconds: BALANCE.match.boss_spawn_s, startAtBossPhase: 2 });
    } else {
      remount({ startAtSeconds: BALANCE.match.boss_spawn_s, startAtBossPhase: 3 });
    }
  }

  function handlePauseToggle(): void {
    const scene = getScene();
    if (!scene) return;
    if (isPaused) {
      scene.scene.resume();
      setIsPaused(false);
    } else {
      scene.scene.pause();
      setIsPaused(true);
    }
  }

  function handleStep(): void {
    const scene = getScene();
    if (!scene) return;
    // Resume for exactly one frame, then re-pause right after that scene's own update pass
    // completes. `Phaser.Scenes.Events.POST_UPDATE` fires once per step per scene, which is the
    // closest thing Phaser has to a documented single-step hook.
    scene.events.once(Phaser.Scenes.Events.POST_UPDATE, () => {
      scene.scene.pause();
      setIsPaused(true);
    });
    scene.scene.resume();
    setIsPaused(false);
  }

  function handleDownloadSummary(): void {
    if (!lastMatchComplete) return;
    const blob = new Blob([JSON.stringify(lastMatchComplete, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `match-summary-seed-${seed}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // `time.timeScale`/`physics.world.timeScale` only affect Phaser's TimerEvents and physics delta
  // accumulation (match clock, wave spawner). `WeaponSystem.firePrimary` and `BossOverlord.update`
  // both gate their fire-rate cooldowns on the scene's `worldTimeMs`, which accumulates the
  // unscaled `update` delta, so at e.g. 4x the match clock races ahead while weapons keep firing at
  // 1x cadence. The DPS readouts run off that same world clock, so they read roughly unchanged and would
  // mislead a tuner trying to read TTK off them at any timeScale other than 1x. This is a UI-honesty
  // flag, not a fix to the underlying math (out of scope for the harness).
  const dpsUnreliable = timeScale !== 1;

  return (
    <div className="flex h-screen w-screen gap-4 overflow-hidden p-4">
      <div className="flex shrink-0 flex-col gap-2">
        <div className="text-xs uppercase tracking-widest text-cobalt-azure">
          Harness de Desenvolvimento // Sem daemon, sem rede
        </div>
        <div
          ref={containerRef}
          className="flight-panel overflow-hidden rounded-xl"
          style={{ width: 480, height: 640 }}
        />
        <div className="flex gap-2">
          <button
            className="tactile-card rounded px-3 py-1 text-sm hover:bg-white/10"
            onClick={handlePauseToggle}
          >
            {isPaused ? 'Retomar' : 'Pausa'}
          </button>
          <button
            className="tactile-card rounded px-3 py-1 text-sm hover:bg-white/10 disabled:opacity-40"
            onClick={handleStep}
            disabled={!isPaused}
          >
            Passo
          </button>
          <button
            className="tactile-card rounded px-3 py-1 text-sm hover:bg-white/10 disabled:opacity-40"
            onClick={handleDownloadSummary}
            disabled={!lastMatchComplete}
          >
            Baixar resumo
          </button>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto pr-2">
        <section className="flight-panel rounded-xl p-4">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-amber-solar">ship_spec</h2>
          <div className="mb-2 flex items-center gap-2">
            <label className="text-xs text-slate-400">Preset</label>
            <select
              className="tactile-card rounded px-2 py-1 text-sm"
              value={selectedPresetKey}
              onChange={(e) => handlePresetChange(e.target.value)}
            >
              {Object.keys(DEV_PRESETS).map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
            <button
              className="tactile-card ml-auto rounded px-3 py-1 text-sm font-bold hover:bg-white/10 disabled:opacity-40"
              onClick={handleApply}
              disabled={!canApply}
            >
              Aplicar
            </button>
          </div>
          <textarea
            className="h-64 w-full rounded border border-white/10 bg-black/40 p-2 font-mono text-xs text-slate-200"
            spellCheck={false}
            value={specText}
            onChange={(e) => handleSpecTextChange(e.target.value)}
          />
          {parseError && <p className="mt-1 text-xs text-alert-red">JSON inválido: {parseError}</p>}
          {validationErrors.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-xs text-alert-red">
              {validationErrors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          )}
        </section>

        <section className="flight-panel rounded-xl p-4">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-amber-solar">Determinismo</h2>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-slate-400">Seed</label>
            <input
              type="number"
              className="tactile-card w-32 rounded px-2 py-1 text-sm"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value) >>> 0)}
            />
            <button className="tactile-card rounded px-2 py-1 text-xs hover:bg-white/10" onClick={handleRandomizeSeed}>
              🎲 novo
            </button>
            <button className="tactile-card rounded px-3 py-1 text-sm font-bold hover:bg-white/10" onClick={handleReplay}>
              Replay
            </button>
          </div>

          <div className="mt-3">
            <label className="text-xs text-slate-400">
              Velocidade do jogo: {timeScale.toFixed(2)}x (sem remontar)
            </label>
            <input
              type="range"
              min={0.25}
              max={4}
              step={0.25}
              value={timeScale}
              onChange={(e) => handleTimeScaleChange(Number(e.target.value))}
              className="w-full"
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button className="tactile-card rounded px-3 py-1 text-sm hover:bg-white/10" onClick={() => handlePhaseButton('start')}>
              Início
            </button>
            <button className="tactile-card rounded px-3 py-1 text-sm hover:bg-white/10" onClick={() => handlePhaseButton('boss')}>
              Boss ({BALANCE.match.boss_spawn_s}s)
            </button>
            <button className="tactile-card rounded px-3 py-1 text-sm hover:bg-white/10" onClick={() => handlePhaseButton('phase2')}>
              Boss fase 2 ({Math.round(BALANCE.boss.phase2_hp_ratio * 100)}% HP)
            </button>
            <button className="tactile-card rounded px-3 py-1 text-sm hover:bg-white/10" onClick={() => handlePhaseButton('phase3')}>
              Boss fase 3 ({Math.round(BALANCE.boss.phase3_hp_ratio * 100)}% HP)
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" checked={godMode} onChange={handleGodModeToggle} />
              God mode
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" checked={autoFirePrimary} onChange={handleAutoFireToggle} />
              Disparo automático
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" checked={physicsDebug} onChange={handlePhysicsDebugToggle} />
              Debug de física
            </label>
          </div>
          {autoFirePrimary && (
            <p className="mt-1 font-mono text-[11px] text-slate-500">
              Gatilho primário travado desde o primeiro quadro. Obrigatório na captura de
              conformidade: sem ele o tempo de reação até apertar ESPAÇO entra no boss_ttk_s.
            </p>
          )}
        </section>

        <section className="flight-panel rounded-xl p-4">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-amber-solar">Telemetria ao vivo</h2>
          {!telemetry && <p className="text-xs text-slate-500">Aguardando o primeiro frame...</p>}
          {telemetry && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-300">
              <div>FPS: {telemetry.fps.toFixed(0)}</div>
              <div>Tempo: {telemetry.elapsedSeconds.toFixed(0)}s</div>
              <div>HP: {telemetry.playerHp} | Escudo: {telemetry.playerShield}</div>
              <div>Combo: {telemetry.combo.toFixed(1)}x</div>
              <div>Score: {telemetry.score.toLocaleString()}</div>
              <div>
                Boss: {telemetry.bossHp !== null ? `${telemetry.bossHp.toLocaleString()} / ${telemetry.bossMaxHp?.toLocaleString()} (fase ${telemetry.bossPhase})` : '—'}
              </div>
              <div className={dpsUnreliable ? 'text-slate-600 line-through decoration-slate-600' : undefined}>
                DPS instantâneo: {telemetry.bossDpsInstant.toFixed(0)}
              </div>
              <div className={dpsUnreliable ? 'text-slate-600 line-through decoration-slate-600' : undefined}>
                DPS médio: {telemetry.bossDpsAverage.toFixed(0)}
              </div>
            </div>
          )}
          {telemetry && dpsUnreliable && (
            <p className="mt-1 text-xs text-amber-solar">
              DPS não é confiável em timeScale ≠ 1x: o relógio da partida acelera, mas o cooldown de
              disparo da arma primária e do boss continua em cadência de 1x.
            </p>
          )}

          <div className="mt-3 space-y-1">
            {telemetry &&
              POOL_ROWS.map(({ key, label }) => {
                const active = telemetry.pools[key];
                const cap = telemetry.poolCaps[key];
                const pct = cap > 0 ? active / cap : 0;
                const isHot = pct >= 0.8;
                return (
                  <div key={key} className="flex items-center gap-2 text-xs">
                    <span className="w-40 shrink-0 text-slate-400">{label}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded bg-white/10">
                      <div
                        className={`h-full ${isHot ? 'bg-yellow-400' : 'bg-cobalt-azure'}`}
                        style={{ width: `${Math.min(100, pct * 100)}%` }}
                      />
                    </div>
                    <span className={isHot ? 'font-bold text-yellow-400' : 'text-slate-400'}>
                      {active}/{cap}
                    </span>
                  </div>
                );
              })}
          </div>
        </section>
      </div>
    </div>
  );
}
