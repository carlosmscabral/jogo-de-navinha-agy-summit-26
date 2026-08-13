/**
 * Contrato numérico único do jogo (Spec 09 §2).
 *
 * Toda constante que altera jogabilidade vive aqui. Três consumidores dependem
 * deste arquivo e precisam concordar entre si:
 *   1. `ship_spec.schema.json`, gerado de `ranges` por `npm run gen:schema`.
 *   2. `normalizeSpec` no daemon, que valida contra `ranges`.
 *   3. A engine Phaser, que consome os valores já validados sem reclampar.
 *
 * Cosmético (cores, posições de HUD, durações de tween) NÃO entra aqui.
 */
export const BALANCE = {
  /** Linha do tempo da partida, em segundos e milissegundos. */
  match: {
    duration_s: 90,
    boss_warning_s: 42,
    boss_spawn_s: 45,
    wave2_starts_s: 20,
    wave_interval_ms: 750,
    wave_interval_hardcore_ms: 550,
    enemy_fire_interval_ms: 1200,
    enemy_fire_interval_hardcore_ms: 800
  },

  /** Tetos dos pools de objetos. Esgotar um pool faz a arma parar de existir (D13). */
  pools: {
    enemies: 45,
    enemy_bullets: 120,
    primary_bullets: 100,
    secondary_missiles: 20,
    boss_bullets: 300
  },

  player: {
    sprite_scale: 0.65,
    invulnerability_ms: 1500,
    bank_angle_deg: 12,
    shield_aura_radius_px: 45
  },

  weapons: {
    primary: {
      /** Cada pelota do vulcan_spread causa esta fração do dano nominal. */
      vulcan_pellet_factor: 0.65,
      vulcan_pellet_count: 3,
      default_bullet_speed: 650,
      min_bullet_speed: 550,
      default_spread_deg: 15
    },
    secondary: {
      missile_count_per_volley: 2,
      missile_speed_y: -300,
      missile_speed_x: 100,
      emp_radius_px: 300,
      /** Dano do EMP na borda do raio, como fração do dano no centro. */
      emp_edge_falloff: 0.5
    }
  },

  enemies: {
    drone: { hp: 30, speed_y: 190 },
    cruiser: { hp: 140, speed_y: 130 },
    kamikaze: { hp: 25, speed_y: 320 },
    bullet_speed: 220,
    bullet_speed_hardcore: 280,
    /** Probabilidade de um drone não-kamikaze atirar em cada evento de disparo. */
    fire_chance: 0.6,
    hardcore: { hp_factor: 1.3, speed_factor: 1.2 }
  },

  boss: {
    max_hp: 15000,
    max_hp_hardcore: 22000,
    hardcore_difficulty_factor: 1.4,
    phase2_hp_ratio: 0.66,
    phase3_hp_ratio: 0.33,
    /** Fração do dano que atravessa em cada fase. Menor = mais resistente. */
    mitigation: { phase1: 0.50, phase2: 0.70, phase3: 1.0 },
    min_damage_per_hit: 5,
    /** Teto por projétil da arma primária. NÃO se aplica à secundária (ver D13). */
    max_damage_per_primary_hit: 45,
    phase_transition_invuln_ms: 2000,
    fire_cooldown_ms: { phase1: 140, phase2: 110, phase3: 80 },
    bullet_speed: { phase1: 300, phase2: 340, phase3: 380 },
    hover_speed: { phase1: 0.0018, phase2: 0.0025, phase3: 0.0035 },
    hover_range_px: { phase1: 2.5, phase2: 3.5, phase3: 4.5 }
  },

  score: {
    points: { drone: 100, cruiser: 500, boss: 10000 },
    combo_step: 0.1,
    combo_max: 3.0,
    boss_bonus: 10000,
    time_bonus_per_second: 80,
    survival_bonus_per_hp: 1200,
    synergy_bonus: 2000,
    mcp_multiplier_by_count: { 1: 1.25, 2: 1.10 } as Record<number, number>,
    mcp_multiplier_default: 1.0
  },

  /** Modificadores da matriz da Spec 02 §6. Aplicados pela Tarefa B6. */
  synergies: {
    glass_cannon: { primary_damage_factor: 1.30, forced_max_hp: 2 },
    titan_fortress: { forced_max_hp: 5, min_shield_capacity: 2, regen_interval_s: 20 },
    ghost_interceptor: { use_max_speed: true, use_min_hitbox: true },
    balanced_ace: { all_attributes_factor: 1.15 }
  },

  /**
   * Faixas válidas de cada campo do `ship_spec.json`. Fonte única: o schema é
   * gerado daqui (B2) e o daemon valida contra isto.
   */
  ranges: {
    'attributes.max_hp': { min: 2, max: 5, integer: true },
    'attributes.shield_capacity': { min: 0, max: 3, integer: true },
    'attributes.speed_px_s': { min: 180, max: 380, integer: false },
    'attributes.hitbox_radius': { min: 8, max: 16, integer: false },
    'weapons.primary.damage': { min: 15, max: 45, integer: false },
    'weapons.primary.fire_rate': { min: 5, max: 12, integer: false },
    'weapons.primary.bullet_speed': { min: 400, max: 800, integer: false },
    'weapons.primary.spread_angle': { min: 0, max: 30, integer: false },
    'weapons.secondary.damage': { min: 60, max: 150, integer: false },
    'weapons.secondary.cooldown_seconds': { min: 3, max: 12, integer: false },
    'build_metadata.energy_sliders.offense': { min: 10, max: 50, integer: true },
    'build_metadata.energy_sliders.speed': { min: 10, max: 50, integer: true },
    'build_metadata.energy_sliders.defense': { min: 10, max: 50, integer: true },
    'build_metadata.energy_sliders.tech': { min: 10, max: 50, integer: true }
  }
} as const;

export type BalanceRangeKey = keyof typeof BALANCE.ranges;
