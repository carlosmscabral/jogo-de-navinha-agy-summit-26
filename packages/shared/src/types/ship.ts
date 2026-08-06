/**
 * Shared Type Definitions for Space Shooter AGY Summit 2026
 */

export type PrimaryWeaponType = 'plasma' | 'laser' | 'vulcan_spread';
export type SecondaryWeaponType = 'homing_missiles' | 'emp_burst' | 'drone_escort' | 'none';

export type McpServerName = 'weapons-arsenal' | 'hull-propulsion' | 'cybernetics-shields';
export type SubagentName = 'aesthetic-designer' | 'combat-strategist' | 'systems-engineer';

export type FastGrillMeWeaponFocus = 'laser_piercing' | 'missile_barrage' | 'vulcan_spread';
export type FastGrillMeVisualTheme = 'synthwave_80s' | 'dark_void_stealth' | 'cyberpunk_gold';

export interface PilotInfo {
  callsign: string;
  company_raw: string;
  company_canonical: string;
}

export interface EnergySliders {
  offense: number;
  speed: number;
  defense: number;
  tech: number;
}

export interface FastGrillMeChoices {
  weapon_focus: FastGrillMeWeaponFocus;
  visual_theme: FastGrillMeVisualTheme;
}

export interface BuildMetadata {
  selected_mcps: McpServerName[];
  selected_subagents: SubagentName[];
  energy_sliders: EnergySliders;
  fast_grill_me_choices: FastGrillMeChoices;
  synergies_unlocked: string[];
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
  $schema?: string;
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
}

export interface MatchRecord {
  match_id: string;
  pilot_id: string;
  callsign: string;
  company_canonical: string;
  final_score: number;
  telemetry: MatchTelemetry;
  ship_spec_snapshot: ShipSpecification;
  created_at: string;
}

export interface CompanyRanking {
  company_canonical: string;
  total_score: number;
  pilots_count: number;
  top_individual_score: number;
  last_updated: string;
}
