/**
 * Shared Type Definitions for GRAVIDADE ZERO — AGY Summit 2026
 */

import type { AccentColorName } from '../constants/visual-catalog.js';

export type PrimaryWeaponType = 'plasma' | 'laser' | 'vulcan_spread';
export type SecondaryWeaponType = 'homing_missiles' | 'emp_burst' | 'none';

export type McpServerName = 'weapons-arsenal' | 'hull-propulsion' | 'cybernetics-shields';
export type SubagentName = 'aesthetic-designer' | 'combat-strategist' | 'systems-engineer';

export type FastGrillMeVisualTheme = 'synthwave_80s' | 'dark_void_stealth' | 'cyberpunk_gold';

export interface PilotInfo {
  callsign: string;
  company_raw: string;
  company_canonical: string;
  /**
   * Confiança (0-1) da resolução de `company_canonical` a partir de `company_raw`, devolvida
   * pelo daemon na resposta de `/api/session/start` (ver `SQLiteBufferService.resolveCompany`).
   * Ausente antes do primeiro round-trip com o daemon -- o estado inicial de registro do
   * cliente ainda não tem essa informação.
   */
  company_confidence?: number;
}

export interface EnergySliders {
  offense: number;
  speed: number;
  defense: number;
  tech: number;
}

/**
 * As quatro respostas do Fast-Grill-Me, uma por linha do menu. Até 2026-08-30 este objeto tinha
 * um `weapon_focus` cujos três valores não eram os três `PrimaryWeaponType` — o menu oferecia
 * "Chuva de Mísseis" e a nave recebia plasma, e a secundária era sempre `homing_missiles`,
 * deixando `emp_burst` inalcançável por qualquer visitante. Agora cada campo é o tipo que a nave
 * de fato recebe.
 */
export interface FastGrillMeChoices {
  primary_weapon: PrimaryWeaponType;
  secondary_weapon: SecondaryWeaponType;
  visual_theme: FastGrillMeVisualTheme;
  accent_color: AccentColorName;
}

export interface BuildMetadata {
  selected_mcps: McpServerName[];
  selected_subagents: SubagentName[];
  energy_sliders: EnergySliders;
  fast_grill_me_choices: FastGrillMeChoices;
  synergies_unlocked: string[];
  /** true quando a nave veio de preset de emergência (D2), não da forja. Lido pela engine no match-complete para preencher telemetry.fallback_used. */
  fallback_used?: boolean;
  /**
   * Dicas de pilotagem escritas pelos sub-agentes táticos no PASSO 3 do protocolo. Opcional por
   * construção: uma nave sem dicas é uma nave válida (preset de emergência, sub-agente que pulou
   * o passo) e nunca pode ser rejeitada por isso.
   */
  pilot_tips?: string[];
}

export interface ShipAttributes {
  max_hp: number; // 2 to 5
  shield_capacity: number; // 0 to 3
  speed_px_s: number; // 180 to 380
  hitbox_radius: number; // 8 to 16
}

export interface PrimaryWeaponSpec {
  type: PrimaryWeaponType;
  damage: number;
  fire_rate: number; // shots per second
  bullet_speed: number;
  spread_angle: number;
}

export interface SecondaryWeaponSpec {
  type: SecondaryWeaponType;
  damage: number;
  cooldown_seconds: number;
}

export interface ShipWeapons {
  primary: PrimaryWeaponSpec;
  secondary: SecondaryWeaponSpec;
}

export interface ShipVisuals {
  style_name: string;
  primary_color: string; // #RRGGBB
  secondary_color: string; // #RRGGBB
  engine_trail_color: string; // #RRGGBB
  svg_path_data: string;
}

export interface ShipSpecification {
  pilot: PilotInfo;
  build_metadata: BuildMetadata;
  attributes: ShipAttributes;
  weapons: ShipWeapons;
  visuals: ShipVisuals;
}

export interface MatchTelemetry {
  duration_s: number;
  enemies_killed: number;
  boss_defeated: boolean;
  damage_taken: number;
  accuracy_pct: number;
  shots_fired: number;
  shots_hit: number;
  /** true quando a nave veio de preset de emergência (D2), não da forja. */
  fallback_used: boolean;
  /** Seed do PRNG da partida. Preenchido pela Tarefa B3; 0 antes dela. */
  seed: number;
  /** Segundos entre o surgimento do boss e sua destruição; null se não foi derrotado. */
  boss_ttk_s: number | null;
  /**
   * Menor taxa de quadros observada durante a luta contra o boss.
   *
   * Existe para a captura de conformidade (Spec 09 §5.9). Até 2026-08-16 a cadência de tiro era
   * arredondada para a borda de quadro seguinte, então uma máquina abaixo de 60 fps atirava menos
   * e o TTK esticava de 4% a 8% -- e a taxa de quadros, que era o termo que explicava tudo, era o
   * único número que o resumo baixado não trazia. Ela foi reconstruída a partir de `shots_fired`.
   * Agora vem medida, e uma captura fora de faixa se denuncia sozinha.
   */
  boss_fight_min_fps: number | null;
  /**
   * Dano real (pós-teto/mitigação/piso) causado ao boss na partida inteira, some primária,
   * secundária e EMP. 0 se o boss nunca apareceu. Existe porque até 2026-08-16 esse número não
   * sobrevivia à partida de forma nenhuma: uma luta que chegava perto de matar o boss e não
   * conseguia terminava com o mesmo registro de quem nunca o viu. Alimenta `bossDamageBonus` em
   * `ScoreBreakdown`, mas fica aqui como fato bruto, independente de como o score decidiu
   * convertê-lo em pontos.
   */
  boss_damage_dealt: number;
  /**
   * Fase mais funda do boss alcançada na partida (1, 2 ou 3); null se o boss nunca apareceu. 1
   * significa "o boss apareceu mas nunca saiu da fase 1", não "nada aconteceu" -- só `null`
   * representa isso. Alimenta `bossPhaseBonus` em `ScoreBreakdown` pelo mesmo motivo de
   * `boss_damage_dealt`: o fato sobrevive à partida mesmo quando o score que ele produz é zero.
   */
  boss_phase_reached: 1 | 2 | 3 | null;
}

/**
 * Detalhamento do score exibido no debrief e persistido em cada partida.
 * Espelha exatamente o objeto `breakdown` de ScoreCalculator.calculateFinalScore.
 */
export interface ScoreBreakdown {
  combatScore: number;
  bossBonus: number;
  timeBonus: number;
  survivalBonus: number;
  /** Crédito parcial por dano causado ao boss sem matá-lo. Ver `BALANCE.score.boss_damage_bonus_max`. */
  bossDamageBonus: number;
  /** Crédito parcial por alcançar as fases 2/3 do boss. Ver `BALANCE.score.boss_phase2_reached_bonus`. */
  bossPhaseBonus: number;
  synergyBonus: number;
  mcpMultiplier: number;
}

export interface MatchRecord {
  match_id: string;
  pilot_id: string;
  callsign: string;
  company_canonical: string;
  /** Texto cru digitado pelo visitante no registro, antes de `resolveCompany`. */
  company_raw: string;
  /** Confiança (0-1) da resolução `company_raw` -> `company_canonical`. Ver `PilotInfo.company_confidence`. */
  company_confidence: number;
  final_score: number;
  telemetry: MatchTelemetry;
  ship_spec_snapshot: ShipSpecification;
  /** Detalhamento do score exibido no debrief. Ver `ScoreBreakdown`. */
  score_breakdown: ScoreBreakdown;
  /** true quando `company_confidence < 0.80` -- fila de revisão manual do staff (Spec 11 §4.11). */
  needs_company_review?: boolean;
  created_at: string;
}

export interface CompanyRanking {
  company_canonical: string;
  total_score: number;
  pilots_count: number;
  top_individual_score: number;
  last_updated: string;
}
