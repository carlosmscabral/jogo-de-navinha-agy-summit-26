import { ShipSpecification } from '../types/ship.js';

export const FALLBACK_SVG_PATHS = {
  interceptor: `
    <polygon points="64,12 88,96 74,86 64,104 54,86 40,96" fill="#00f3ff" stroke="#ffffff" stroke-width="2"/>
    <polygon points="64,28 76,80 64,92 52,80" fill="#0066aa"/>
    <circle cx="64" cy="50" r="6" fill="#ffffff"/>
  `.trim(),
  vanguard: `
    <polygon points="64,16 104,72 88,104 64,88 40,104 24,72" fill="#ffd700" stroke="#ffffff" stroke-width="2"/>
    <polygon points="64,30 84,68 64,80 44,68" fill="#aa7700"/>
    <circle cx="64" cy="52" r="8" fill="#ff6600"/>
  `.trim(),
  striker: `
    <polygon points="64,8 96,84 80,78 64,112 48,78 32,84" fill="#8b00ff" stroke="#00ffcc" stroke-width="2"/>
    <polygon points="64,24 80,72 64,84 48,72" fill="#440088"/>
    <circle cx="64" cy="48" r="7" fill="#00ffcc"/>
  `.trim()
};

export const FALLBACK_PRESETS: Record<'interceptor' | 'vanguard' | 'striker', ShipSpecification> = {
  interceptor: {
    pilot: {
      callsign: 'ApexPilot',
      company_raw: 'Google Cloud',
      company_canonical: 'Google'
    },
    build_metadata: {
      selected_mcps: ['weapons-arsenal', 'hull-propulsion'],
      selected_subagents: ['aesthetic-designer', 'combat-strategist'],
      energy_sliders: {
        offense: 30,
        speed: 45,
        defense: 15,
        tech: 10
      },
      fast_grill_me_choices: {
        weapon_focus: 'laser_piercing',
        visual_theme: 'synthwave_80s'
      },
      synergies_unlocked: ['Ghost Interceptor']
    },
    attributes: {
      max_hp: 3,
      shield_capacity: 1,
      speed_px_s: 360,
      hitbox_radius: 9
    },
    weapons: {
      primary: {
        type: 'laser',
        damage: 20,
        fire_rate: 12,
        bullet_speed: 750,
        spread_angle: 0
      },
      secondary: {
        type: 'homing_missiles',
        damage: 100,
        cooldown_seconds: 6
      }
    },
    visuals: {
      style_name: 'Synthwave 80s Interceptor',
      primary_color: '#00f3ff',
      secondary_color: '#ff0055',
      engine_trail_color: '#00f3ff',
      svg_path_data: FALLBACK_SVG_PATHS.interceptor
    }
  },

  vanguard: {
    pilot: {
      callsign: 'TitanPilot',
      company_raw: 'Google Cloud',
      company_canonical: 'Google'
    },
    build_metadata: {
      selected_mcps: ['hull-propulsion', 'cybernetics-shields'],
      selected_subagents: ['aesthetic-designer', 'systems-engineer'],
      energy_sliders: {
        offense: 20,
        speed: 15,
        defense: 45,
        tech: 20
      },
      fast_grill_me_choices: {
        weapon_focus: 'missile_barrage',
        visual_theme: 'cyberpunk_gold'
      },
      synergies_unlocked: ['Titan Fortress']
    },
    attributes: {
      max_hp: 5,
      shield_capacity: 2,
      speed_px_s: 220,
      hitbox_radius: 14
    },
    weapons: {
      primary: {
        type: 'plasma',
        damage: 40,
        fire_rate: 5,
        bullet_speed: 550,
        spread_angle: 0
      },
      secondary: {
        type: 'emp_burst',
        damage: 60,
        cooldown_seconds: 8
      }
    },
    visuals: {
      style_name: 'Cyberpunk Gold Dreadnought',
      primary_color: '#ffd700',
      secondary_color: '#ff6600',
      engine_trail_color: '#ff6600',
      svg_path_data: FALLBACK_SVG_PATHS.vanguard
    }
  },

  striker: {
    pilot: {
      callsign: 'NovaPilot',
      company_raw: 'Google Cloud',
      company_canonical: 'Google'
    },
    build_metadata: {
      selected_mcps: ['weapons-arsenal', 'cybernetics-shields'],
      selected_subagents: ['aesthetic-designer', 'combat-strategist'],
      energy_sliders: {
        offense: 40,
        speed: 25,
        defense: 20,
        tech: 15
      },
      fast_grill_me_choices: {
        weapon_focus: 'vulcan_spread',
        visual_theme: 'dark_void_stealth'
      },
      synergies_unlocked: ['Glass Cannon']
    },
    attributes: {
      max_hp: 3,
      shield_capacity: 1,
      speed_px_s: 300,
      hitbox_radius: 11
    },
    weapons: {
      primary: {
        type: 'vulcan_spread',
        damage: 18,
        fire_rate: 5,
        bullet_speed: 600,
        spread_angle: 15
      },
      secondary: {
        type: 'emp_burst',
        damage: 80,
        cooldown_seconds: 12
      }
    },
    visuals: {
      style_name: 'Dark Void Striker',
      primary_color: '#8b00ff',
      secondary_color: '#00ffcc',
      engine_trail_color: '#00ffcc',
      svg_path_data: FALLBACK_SVG_PATHS.striker
    }
  }
};
