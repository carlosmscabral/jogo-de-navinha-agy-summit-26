import React, { useState } from 'react';
import {
  BALANCE,
  EnergySliders,
  MCP_CATALOG,
  McpServerName,
  SUBAGENT_CATALOG,
  SubagentName,
  PilotInfo,
  computeBaselineAttributes,
  computeBaselineWeapons
} from '@jogo/shared';
import { Zap, Shield, Sparkles, Crosshair, ChevronRight, CheckCircle2, Cpu, Flame, Gauge, Layers, Award, ArrowLeft } from 'lucide-react';
import { detectSynergyPreview } from './synergy-preview';

const SLIDER_MIN = 10;
const SLIDER_MAX = 50;
const ENERGY_BUDGET = 100;

/** Os dois sub-agentes que o visitante escolhe entre si. */
type TacticalAgent = 'combat-strategist' | 'systems-engineer';

/**
 * Derivado do catálogo em vez de digitado: o `aesthetic-designer` é `selectable: false` porque
 * vai em toda forja, então ele nunca entra nesta lista. O `filter` com a asserção mantém o tipo
 * estreito de `TacticalAgent`, que o resto do componente já usava.
 */
const TACTICAL_AGENTS = (Object.keys(SUBAGENT_CATALOG) as SubagentName[]).filter(
  (name): name is TacticalAgent => SUBAGENT_CATALOG[name].selectable
);

/**
 * Redistribui `delta` (positivo ou negativo) entre `keys`, sem estourar `[SLIDER_MIN,
 * SLIDER_MAX]` em nenhuma e sem perder resto quando uma ou mais já estão no limite. A versão
 * anterior dividia `delta` em partes iguais, clampava cada uma isoladamente, e jogava a sobra
 * inteira numa única chave fixa (`otherKeys[0]`) -- se essa chave TAMBÉM estivesse no limite, o
 * erro sobrevivia, silencioso. Um playtest real do `agy` (2026-08-16) produziu offense=10,
 * speed=10 (os dois no piso) e tech=50 (no teto) simultaneamente, e a soma final saiu 107, não
 * 100 -- 7 PU de graça que nenhuma fórmula de atributo sabia que não deveriam existir.
 *
 * Aqui, cada rodada só empresta das chaves que ainda têm espaço, na proporção que sobrou; uma
 * chave que já bateu no limite sai da rodada seguinte, e o que ela não conseguiu absorver volta
 * pro `remaining` pra tentar de novo nas que restaram. Como a soma das quatro é sempre 100 e
 * cada uma cabe em [10,50], sempre existe alguma combinação válida -- o problema nunca foi
 * matemático, era o algoritmo desistir cedo demais.
 */
function distributeDelta(values: Record<string, number>, keys: string[], delta: number): Record<string, number> {
  const next = { ...values };
  let remaining = delta;
  let pool = keys.filter((k) => (delta > 0 ? next[k] < SLIDER_MAX : next[k] > SLIDER_MIN));

  while (Math.abs(remaining) > 1e-9 && pool.length > 0) {
    const share = remaining / pool.length;
    let appliedThisPass = 0;
    const nextPool: string[] = [];

    for (const k of pool) {
      const desired = next[k] + share;
      const clamped = Math.max(SLIDER_MIN, Math.min(SLIDER_MAX, desired));
      appliedThisPass += clamped - next[k];
      next[k] = clamped;
      if (clamped > SLIDER_MIN && clamped < SLIDER_MAX) nextPool.push(k);
    }

    remaining -= appliedThisPass;
    pool = nextPool;
  }

  return next;
}

/**
 * Recalcula as quatro após o usuário arrastar `changedKey` até `value`: `value` fica fixo (o
 * `<input>` já o clampou em [10,50]), e as outras três absorvem a diferença via
 * `distributeDelta`. `Math.round` em cada uma pode deixar a soma a 1-2 PU de 100 (arredondamento
 * independente por chave); o laço final fecha essa folga na primeira chave com espaço --
 * exportada e testada isoladamente porque é aqui que o defeito anterior vivia.
 */
export function rebalanceEnergySliders(sliders: EnergySliders, changedKey: keyof EnergySliders, value: number): EnergySliders {
  const clampedValue = Math.max(SLIDER_MIN, Math.min(SLIDER_MAX, value));
  const otherKeys = (Object.keys(sliders) as (keyof EnergySliders)[]).filter((k) => k !== changedKey);
  const diff = clampedValue - sliders[changedKey];

  // `EnergySliders` não declara índice de string (é uma interface fechada nas quatro chaves de
  // propósito, em `@jogo/shared`), mas `distributeDelta` é deliberadamente genérica -- o cast
  // reflete que ela nunca vê nada além dessas quatro chaves.
  const distributed = distributeDelta(sliders as unknown as Record<string, number>, otherKeys, -diff);
  const next: EnergySliders = { ...sliders, [changedKey]: clampedValue };
  for (const k of otherKeys) {
    next[k] = Math.round(distributed[k]);
  }

  let roundingError = ENERGY_BUDGET - Object.values(next).reduce((a, b) => a + b, 0);
  for (const k of otherKeys) {
    if (roundingError === 0) break;
    const room = roundingError > 0 ? SLIDER_MAX - next[k] : next[k] - SLIDER_MIN;
    const applied = roundingError > 0 ? Math.min(room, roundingError) : Math.max(-room, roundingError);
    next[k] += applied;
    roundingError -= applied;
  }

  return next;
}

interface EnergySlidersBuilderProps {
  pilot: PilotInfo;
  onProceedToTerminal: (config: {
    energy_sliders: EnergySliders;
    selected_mcps: McpServerName[];
    selected_subagents: SubagentName[];
  }) => void;
  onBack: () => void;
}

export function EnergySlidersBuilder({ pilot, onProceedToTerminal, onBack }: EnergySlidersBuilderProps) {
  const [sliders, setSliders] = useState<EnergySliders>({
    offense: 35,
    speed: 35,
    defense: 15,
    tech: 15
  });

  const [selectedMcps, setSelectedMcps] = useState<McpServerName[]>([
    'weapons-arsenal',
    'hull-propulsion',
    'cybernetics-shields'
  ]);

  const [selectedTacticalAgent, setSelectedTacticalAgent] = useState<TacticalAgent>('combat-strategist');

  // Antes era o texto fixo "100 / 100 PU", que não lia `sliders` -- mascarava exatamente o
  // defeito de `rebalanceEnergySliders` que permitiu a soma derivar pra 107 num playtest real
  // (2026-08-16): a régua sempre dizia "100/100" mesmo quando não era. Calculado ao vivo agora,
  // pra qualquer regressão futura no rebalanceamento aparecer na tela em vez de ficar invisível.
  const slidersSum = Object.values(sliders).reduce((a, b) => a + b, 0);

  const mcpCount = selectedMcps.length;
  /**
   * O ÚNICO efeito de escolher menos servidores MCP. Lido de `BALANCE.score`, que é o mesmo
   * objeto que `score-calculator.ts` consome ao fechar a partida.
   *
   * Antes daqui existia também um `overclockMultiplier` (1.2 / 1.1 / 1.0) que inflava o DPS, a
   * velocidade e o escudo mostrados nesta tela, mais três crachás de "⚡ Overclock ativo". Nada
   * disso jamais chegou à nave: não há multiplicador de atributo em lugar nenhum da engine por
   * contagem de MCP -- só este de placar. Era a maior mentira da jornada, e o defeito estava
   * anotado na Spec 02 §55-62.
   */
  const scoreMultiplier =
    BALANCE.score.mcp_multiplier_by_count[mcpCount] ?? BALANCE.score.mcp_multiplier_default;

  // Live Projected Stats -- calculado com a MESMA fórmula-base que o daemon usa
  // para preencher os domínios de MCPs não selecionados
  // (packages/shared/src/constants/baseline-ship-stats.ts), para que o número
  // mostrado aqui nunca divirja do que a nave realmente recebe.
  const baselineAttributes = computeBaselineAttributes(sliders);
  // weapon_focus ainda não foi escolhido nesta tela (isso acontece depois, no
  // Fast-Grill-Me do terminal AGY) -- mas nenhum dos campos numéricos de
  // computeBaselineWeapons varia com weaponFocus (só o "type" narrativo varia),
  // então qualquer valor válido serve aqui só para preview.
  const baselineWeapons = computeBaselineWeapons(sliders, 'laser_piercing');

  // Os quatro números da telemetria são a linha de base pura, sem bônus nenhum: é exatamente o
  // que a nave recebe nos domínios que o visitante NÃO selecionar, e o ponto de partida do que a
  // IA calibra nos que ele selecionar. Nenhum deles é multiplicado por contagem de MCP.
  const projectedDps = Math.round(baselineWeapons.primary.damage * baselineWeapons.primary.fire_rate);
  const projectedSpeed = Math.round(baselineAttributes.speed_px_s);
  const projectedHp = baselineAttributes.max_hp;
  const projectedShields = baselineAttributes.shield_capacity;

  // Sinergia detectada -- e, crucialmente, se ela pode mesmo ser desbloqueada com os MCPs
  // selecionados. Ver synergy-preview.ts: só `cybernetics-shields` desbloqueia sinergias, e sem
  // ele a engine não aplica nenhuma. O crachá nunca deve prometer um bônus que não sai.
  const synergyPreview = detectSynergyPreview(sliders, selectedMcps);

  const applyPreset = (preset: { offense: number; speed: number; defense: number; tech: number }) => {
    setSliders(preset);
  };

  const handleSliderChange = (key: keyof EnergySliders, value: number) => {
    setSliders(rebalanceEnergySliders(sliders, key, value));
  };

  const toggleMcp = (mcp: McpServerName) => {
    if (selectedMcps.includes(mcp)) {
      // O sub-agente tático ativo narra os resultados do(s) MCP(s) que ele precisa — se o
      // visitante remover o único MCP restante do par exigido, o sub-agente fica sem nada para
      // analisar no terminal. Por isso bloqueamos a remoção do(s) MCP(s) que a ainda-ativa
      // combat-strategist / systems-engineer depende, sem restringir os demais.
      const isRequiredByCombatStrategist =
        selectedTacticalAgent === 'combat-strategist' && mcp === 'weapons-arsenal';
      const isRequiredByPairedSystemsEngineer =
        selectedTacticalAgent === 'systems-engineer' &&
        (mcp === 'hull-propulsion' || mcp === 'cybernetics-shields') &&
        !selectedMcps.some((m) => m !== mcp && (m === 'hull-propulsion' || m === 'cybernetics-shields'));

      if (isRequiredByCombatStrategist || isRequiredByPairedSystemsEngineer) {
        return;
      }

      if (selectedMcps.length > 1) {
        setSelectedMcps(selectedMcps.filter((m) => m !== mcp));
      }
    } else {
      setSelectedMcps([...selectedMcps, mcp]);
    }
  };

  const selectTacticalAgent = (agent: TacticalAgent) => {
    setSelectedTacticalAgent(agent);

    // Ao trocar de sub-agente tático, garanta que ele tenha pelo menos um MCP dos que narra —
    // caso contrário ele seria dispatchado sem nenhum valor obtido para comentar no terminal.
    if (agent === 'combat-strategist') {
      if (!selectedMcps.includes('weapons-arsenal')) {
        setSelectedMcps([...selectedMcps, 'weapons-arsenal']);
      }
    } else {
      const hasPairedMcp = selectedMcps.includes('hull-propulsion') || selectedMcps.includes('cybernetics-shields');
      if (!hasPairedMcp) {
        setSelectedMcps([...selectedMcps, 'hull-propulsion']);
      }
    }
  };

  const handleStartForge = () => {
    onProceedToTerminal({
      energy_sliders: sliders,
      selected_mcps: selectedMcps,
      selected_subagents: ['aesthetic-designer', selectedTacticalAgent]
    });
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 select-none overflow-y-auto font-sans">
      <div className="w-full max-w-4xl flight-panel p-7 rounded-3xl border border-slate-700/60 shadow-2xl space-y-6 my-4">
        {/* Header */}
        <div className="flex justify-between items-center pb-4 border-b border-slate-700/60">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-md bg-[#38bdf8]/10 text-[#38bdf8] border border-[#38bdf8]/30 uppercase tracking-widest font-mono">
                Etapa 3 de 4 // Matriz de Potência
              </span>
              <span className="text-xs text-slate-400 font-mono">Google Cloud Summit 2026</span>
            </div>
            <h2 className="text-2xl font-black text-white tracking-wider uppercase">
              FORJA DE ENERGIA & SERVIDORES MCP
            </h2>
          </div>

          {/* Só o estado desbloqueado usa o âmbar "ativo": um bônus que a engine não vai
              aplicar não pode se parecer com um bônus conquistado. */}
          <div
            className={`px-3.5 py-1.5 rounded-xl border text-xs font-bold flex items-center gap-1.5 font-mono ${
              synergyPreview.unlocked
                ? 'bg-[#ff9e0b]/10 border-[#ff9e0b]/30 text-[#ff9e0b]'
                : 'bg-slate-900/60 border-slate-700 text-slate-400'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>{synergyPreview.label}</span>
          </div>
        </div>

        {/* Quick Presets */}
        <div className="space-y-2">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block font-mono">
            Arquétipos Rápidos (100 PU de Energia Total):
          </span>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <button
              type="button"
              onClick={() => applyPreset({ offense: 45, speed: 35, defense: 10, tech: 10 })}
              className={`p-2.5 rounded-xl border text-left transition-all ${
                sliders.offense >= 40
                  ? 'bg-[#ff9e0b]/20 border-[#ff9e0b] text-white font-bold'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="text-xs font-bold text-[#ff9e0b]">⚡ Glass Cannon</div>
              <div className="text-[10px] text-slate-400 font-mono">45 ATK / 35 SPD</div>
            </button>

            <button
              type="button"
              onClick={() => applyPreset({ offense: 15, speed: 20, defense: 45, tech: 20 })}
              className={`p-2.5 rounded-xl border text-left transition-all ${
                sliders.defense >= 40
                  ? 'bg-[#10b981]/20 border-[#10b981] text-white font-bold'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="text-xs font-bold text-[#10b981]">🛡️ Titan Fortress</div>
              <div className="text-[10px] text-slate-400 font-mono">45 DEF / 20 TEC</div>
            </button>

            <button
              type="button"
              onClick={() => applyPreset({ offense: 25, speed: 45, defense: 15, tech: 15 })}
              className={`p-2.5 rounded-xl border text-left transition-all ${
                sliders.speed >= 40
                  ? 'bg-[#38bdf8]/20 border-[#38bdf8] text-white font-bold'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="text-xs font-bold text-[#38bdf8]">💨 Ghost Interceptor</div>
              <div className="text-[10px] text-slate-400 font-mono">45 SPD / 25 ATK</div>
            </button>

            <button
              type="button"
              onClick={() => applyPreset({ offense: 25, speed: 25, defense: 25, tech: 25 })}
              className={`p-2.5 rounded-xl border text-left transition-all ${
                sliders.offense === 25 && sliders.defense === 25
                  ? 'bg-slate-700/50 border-slate-500 text-white font-bold'
                  : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              <div className="text-xs font-bold text-slate-200">🎯 Balanced Ace</div>
              <div className="text-[10px] text-slate-400 font-mono">25 em Tudo</div>
            </button>
          </div>
        </div>

        {/* 4 Energy Sliders + Live Stats Breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
          {/* Sliders (7 cols) */}
          <div className="md:col-span-7 space-y-3.5 bg-slate-900/60 p-5 rounded-2xl border border-slate-800">
            <div className="flex justify-between items-center mb-1 font-mono">
              <span className="text-xs font-bold text-slate-300 uppercase">Matriz de Energia</span>
              <span className={`text-xs font-bold ${slidersSum === 100 ? 'text-[#10b981]' : 'text-alert-red'}`}>
                {slidersSum} / 100 PU
              </span>
            </div>

            {/* Offense */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-slate-300">
                <span className="flex items-center gap-1.5 text-[#ff9e0b] font-bold font-mono">
                  <Crosshair className="w-3.5 h-3.5" /> ATAQUE / CANHÕES
                </span>
                <span className="font-mono font-bold text-[#ff9e0b]">{sliders.offense} PU</span>
              </div>
              <input
                type="range"
                min={10}
                max={50}
                value={sliders.offense}
                onChange={(e) => handleSliderChange('offense', Number(e.target.value))}
                className="w-full accent-[#ff9e0b] cursor-pointer"
              />
            </div>

            {/* Speed */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-slate-300">
                <span className="flex items-center gap-1.5 text-[#38bdf8] font-bold font-mono">
                  <Zap className="w-3.5 h-3.5" /> VELOCIDADE / PROPULSÃO
                </span>
                <span className="font-mono font-bold text-[#38bdf8]">{sliders.speed} PU</span>
              </div>
              <input
                type="range"
                min={10}
                max={50}
                value={sliders.speed}
                onChange={(e) => handleSliderChange('speed', Number(e.target.value))}
                className="w-full accent-[#38bdf8] cursor-pointer"
              />
            </div>

            {/* Defense */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-slate-300">
                <span className="flex items-center gap-1.5 text-[#10b981] font-bold font-mono">
                  <Shield className="w-3.5 h-3.5" /> DEFESA / BLINDAGEM (HP)
                </span>
                <span className="font-mono font-bold text-[#10b981]">{sliders.defense} PU</span>
              </div>
              <input
                type="range"
                min={10}
                max={50}
                value={sliders.defense}
                onChange={(e) => handleSliderChange('defense', Number(e.target.value))}
                className="w-full accent-[#10b981] cursor-pointer"
              />
            </div>

            {/* Tech */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-slate-300">
                <span className="flex items-center gap-1.5 text-[#60a5fa] font-bold font-mono">
                  <Cpu className="w-3.5 h-3.5" /> TECNOLOGIA / ESCUDOS
                </span>
                <span className="font-mono font-bold text-[#60a5fa]">{sliders.tech} PU</span>
              </div>
              <input
                type="range"
                min={10}
                max={50}
                value={sliders.tech}
                onChange={(e) => handleSliderChange('tech', Number(e.target.value))}
                className="w-full accent-[#60a5fa] cursor-pointer"
              />
            </div>
          </div>

          {/* Live Projected Stats Gauge (5 cols) */}
          <div className="md:col-span-5 flex flex-col justify-between bg-slate-900/60 p-5 rounded-2xl border border-slate-800">
            <div className="flex justify-between items-center mb-2 font-mono">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Telemetria Projetada
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800/60 text-slate-400 border border-slate-700">
                LINHA DE BASE
              </span>
            </div>

            <div className="space-y-2.5 font-mono text-xs">
              <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Flame className="w-3.5 h-3.5 text-[#ff9e0b]" /> Dano Base
                </span>
                <span className="font-bold text-[#ff9e0b]">~{projectedDps} DPS</span>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Gauge className="w-3.5 h-3.5 text-[#38bdf8]" /> Velocidade
                </span>
                <span className="font-bold text-[#38bdf8]">{projectedSpeed} px/s</span>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-[#10b981]" /> Casco
                </span>
                <span className="font-bold text-[#10b981]">{projectedHp} HP</span>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800 flex items-center justify-between">
                <span className="text-slate-400 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-[#60a5fa]" /> Escudos
                </span>
                <span className="font-bold text-[#60a5fa]">{projectedShields} Camada(s)</span>
              </div>
            </div>

            <div className="mt-3 p-2.5 rounded-xl bg-slate-800/40 border border-slate-700/60 flex items-center justify-between text-xs font-mono">
              <span className="text-slate-300 font-bold flex items-center gap-1.5">
                <Award className="w-4 h-4 text-[#ff9e0b]" /> Multiplicador Placar:
              </span>
              <span className="font-black text-[#ff9e0b] text-sm">
                {scoreMultiplier.toFixed(2)}x
              </span>
            </div>
            <p className="mt-2 text-[10px] text-slate-400 font-mono leading-snug">
              Menos servidores MCP = maior multiplicador de <strong>pontuação</strong> — a nave não fica
              mais forte por isso. Os sistemas não selecionados voam com a configuração padrão acima,
              em vez de calibrados pela IA.
            </p>
          </div>
        </div>

        {/* MCP Selection & Tradeoffs */}
        <div className="space-y-3">
          <div className="flex items-center justify-between font-mono">
            <span className="text-xs font-bold text-[#ff9e0b] uppercase tracking-wider flex items-center gap-2">
              <Cpu className="w-4 h-4" />
              Servidores MCP & Bônus de Especialização:
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              {mcpCount === 1 ? '🔥 Ultra-Especialista' : mcpCount === 2 ? '⚡ Foco Tático' : '🌐 Generalista'}
              {' — placar '}
              <span className="text-[#ff9e0b] font-bold">×{scoreMultiplier.toFixed(2)}</span>
            </span>
          </div>

          {/*
            Um card por servidor, direto do `MCP_CATALOG` -- rótulo, cor, descrição e a lista de
            ferramentas que ele expõe. Antes eram três blocos de JSX quase idênticos com as
            descrições digitadas à mão, que já tinham derivado das que o MCP declara ao modelo.
          */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {(Object.keys(MCP_CATALOG) as McpServerName[]).map((id) => {
              const entry = MCP_CATALOG[id];
              const selected = selectedMcps.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleMcp(id)}
                  aria-pressed={selected}
                  style={selected ? { borderColor: entry.color, backgroundColor: `${entry.color}1a` } : undefined}
                  className={`p-3.5 rounded-2xl border text-left transition-all flex flex-col justify-between gap-2 ${
                    selected
                      ? 'text-white shadow-lg'
                      : 'border-slate-800 bg-slate-900/40 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-sm" style={{ color: entry.color }}>
                      {entry.label}
                    </span>
                    {selected && <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: entry.color }} />}
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono -mt-1">{id}</span>

                  <p className="text-[11px] text-slate-300 leading-snug">{entry.blurb}</p>

                  {/* O que ele de fato calibra, com o nome das ferramentas que o agente chama. */}
                  <ul className="space-y-0.5">
                    {entry.tools.map((tool) => (
                      <li key={tool.id} className="text-[10px] text-slate-400 font-mono leading-snug">
                        <span style={{ color: entry.color }}>▸</span> {tool.label}
                      </li>
                    ))}
                  </ul>

                  <p className="text-[10px] text-slate-500 font-mono leading-snug">
                    {selected ? `Selecionado: ${entry.whenSelected}` : `Sem seleção: ${entry.whenUnselected}`}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Subagent Selection */}
        <div className="space-y-2 bg-slate-900/60 p-4 rounded-2xl border border-slate-800">
          <span className="text-xs font-bold text-[#38bdf8] uppercase block font-mono">
            Sub-Agente Tático para o Terminal AGY
          </span>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {TACTICAL_AGENTS.map((id) => {
              const entry = SUBAGENT_CATALOG[id];
              const selected = selectedTacticalAgent === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => selectTacticalAgent(id)}
                  aria-pressed={selected}
                  style={selected ? { borderColor: entry.color, backgroundColor: `${entry.color}1a` } : undefined}
                  className={`p-3 rounded-xl border text-left text-xs flex justify-between items-center transition-all ${
                    selected ? 'text-white font-bold' : 'border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  <div>
                    <div className="text-xs font-bold text-white">{entry.label}</div>
                    <div className="text-[10px] text-slate-500 font-mono">{id}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{entry.blurb}</div>
                  </div>
                  {selected && <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: entry.color }} />}
                </button>
              );
            })}
          </div>

          {/*
            O `aesthetic-designer` vai no payload de toda forja (`handleStartForge`) e o visitante
            nunca o viu -- mas é ele quem desenha o casco que aparece no pré-voo e na partida.
          */}
          <p className="text-[10px] text-slate-500 font-mono leading-snug pt-1">
            <span style={{ color: SUBAGENT_CATALOG['aesthetic-designer'].color }}>▸</span>{' '}
            <strong>{SUBAGENT_CATALOG['aesthetic-designer'].label}</strong> (aesthetic-designer):{' '}
            {SUBAGENT_CATALOG['aesthetic-designer'].blurb}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onBack}
            className="w-1/3 p-3.5 rounded-xl border border-slate-700 text-slate-300 text-xs font-bold uppercase hover:bg-slate-800 transition-all flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Voltar às Instruções</span>
          </button>
          <button
            type="button"
            onClick={handleStartForge}
            className="w-2/3 p-3.5 rounded-xl bg-gradient-to-r from-[#ff9e0b] to-[#f59e0b] text-black text-xs font-black uppercase tracking-wider hover:scale-[1.02] transition-all shadow-[0_0_25px_rgba(255,158,11,0.5)] flex items-center justify-center gap-2"
          >
            <span>Iniciar Forja no Antigravity CLI</span>
            <ChevronRight className="w-4 h-4 stroke-[3]" />
          </button>
        </div>
      </div>
    </div>
  );
}
