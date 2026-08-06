import chokidar, { FSWatcher } from 'chokidar';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { validateShipSpecification, ShipSpecification, FALLBACK_PRESETS } from '@jogo/shared';

export class FileWatcherService {
  private watcher?: FSWatcher;
  private pollIntervalTimer?: NodeJS.Timeout;
  private onShipReadyCallback?: (spec: ShipSpecification) => void;
  private lastProcessedTimestamp = 0;
  private currentSpec?: ShipSpecification;

  startWatching(sessionDir: string, onShipReady: (spec: ShipSpecification) => void): void {
    this.stopWatching();
    this.onShipReadyCallback = onShipReady;
    this.lastProcessedTimestamp = 0;
    this.currentSpec = undefined;

    const targetFile = path.join(sessionDir, 'ship_spec.json');

    // 1. Chokidar watch on sessionDir (watches directory creation & file updates)
    try {
      this.watcher = chokidar.watch(sessionDir, {
        persistent: true,
        depth: 0,
        ignoreInitial: false,
        awaitWriteFinish: {
          stabilityThreshold: 100,
          pollInterval: 50
        }
      });

      this.watcher.on('add', (filePath: string) => {
        if (filePath.endsWith('ship_spec.json')) {
          this.checkAndProcessFile(targetFile, sessionDir);
        }
      });

      this.watcher.on('change', (filePath: string) => {
        if (filePath.endsWith('ship_spec.json')) {
          this.checkAndProcessFile(targetFile, sessionDir);
        }
      });
    } catch (err) {
      console.warn('[FileWatcher] Chokidar init warning, relying on active polling:', err);
    }

    // 2. Active Polling Backup (Every 400ms - guaranteed detection across macOS/Linux)
    this.pollIntervalTimer = setInterval(() => {
      this.checkAndProcessFile(targetFile, sessionDir);
    }, 400);
  }

  getCurrentSpec(): ShipSpecification | undefined {
    return this.currentSpec;
  }

  private checkAndProcessFile(filePath: string, sessionDir: string): void {
    try {
      if (!fs.existsSync(filePath)) return;

      const stat = fs.statSync(filePath);
      if (stat.mtimeMs <= this.lastProcessedTimestamp) return;

      const raw = fs.readFileSync(filePath, 'utf8');
      if (!raw || raw.trim().length === 0) return;

      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Incomplete write, retry next cycle
        return;
      }

      this.lastProcessedTimestamp = stat.mtimeMs;

      // Normalize spec with fallback defaults for bulletproof safety
      const normalizedSpec = this.normalizeSpec(parsed);
      this.currentSpec = normalizedSpec;

      console.log(`[FileWatcher] ship_spec.json successfully processed & normalized for pilot: ${normalizedSpec.pilot?.callsign}`);

      if (this.onShipReadyCallback) {
        this.onShipReadyCallback(normalizedSpec);
      }
    } catch (err) {
      console.error('[FileWatcher] Error reading/parsing ship_spec.json:', err);
    }
  }

  private normalizeSpec(raw: any): ShipSpecification {
    const base: ShipSpecification = JSON.parse(JSON.stringify(FALLBACK_PRESETS.interceptor));

    // Handle primary weapon type mapping
    let primaryType: 'laser' | 'plasma' | 'vulcan_spread' = 'vulcan_spread';
    const rawPType = String(raw.weapons?.primary?.type || raw.primary_weapon || raw.primary || '').toLowerCase();
    if (rawPType.includes('laser')) primaryType = 'laser';
    else if (rawPType.includes('plasma')) primaryType = 'plasma';
    else if (rawPType.includes('vulcan')) primaryType = 'vulcan_spread';

    // Handle secondary weapon type mapping
    let secondaryType: 'homing_missiles' | 'emp_burst' | 'drone_escort' = 'homing_missiles';
    const rawSType = String(raw.weapons?.secondary?.type || raw.secondary_weapon || raw.secondary || '').toLowerCase();
    if (rawSType.includes('emp')) secondaryType = 'emp_burst';
    else if (rawSType.includes('drone')) secondaryType = 'drone_escort';
    else if (rawSType.includes('missile') || rawSType.includes('míssil')) secondaryType = 'homing_missiles';

    return {
      $schema: raw.$schema || base.$schema,
      pilot: {
        callsign: raw.pilot?.callsign || raw.callsign || base.pilot.callsign,
        company_raw: raw.pilot?.company_raw || raw.company || base.pilot.company_raw,
        company_canonical: raw.pilot?.company_canonical || raw.company || base.pilot.company_canonical
      },
      build_metadata: {
        selected_mcps: Array.isArray(raw.build_metadata?.selected_mcps)
          ? raw.build_metadata.selected_mcps
          : base.build_metadata.selected_mcps,
        selected_subagents: Array.isArray(raw.build_metadata?.selected_subagents)
          ? raw.build_metadata.selected_subagents
          : base.build_metadata.selected_subagents,
        energy_sliders: {
          offense: Number(raw.build_metadata?.energy_sliders?.offense || raw.offense || raw.attack) || base.build_metadata.energy_sliders.offense,
          speed: Number(raw.build_metadata?.energy_sliders?.speed || raw.speed) || base.build_metadata.energy_sliders.speed,
          defense: Number(raw.build_metadata?.energy_sliders?.defense || raw.defense) || base.build_metadata.energy_sliders.defense,
          tech: Number(raw.build_metadata?.energy_sliders?.tech || raw.tech) || base.build_metadata.energy_sliders.tech
        },
        fast_grill_me_choices: {
          weapon_focus: raw.build_metadata?.fast_grill_me_choices?.weapon_focus || primaryType,
          visual_theme: raw.build_metadata?.fast_grill_me_choices?.visual_theme || 'synthwave_80s'
        },
        synergies_unlocked: Array.isArray(raw.build_metadata?.synergies_unlocked)
          ? raw.build_metadata.synergies_unlocked
          : ['Glass Cannon 🔥']
      },
      attributes: {
        speed_px_s: Math.max(150, Math.min(500, Number(raw.attributes?.speed_px_s || raw.speed_px_s || raw.speed) || base.attributes.speed_px_s)),
        max_hp: Math.max(1, Math.min(10, Number(raw.attributes?.max_hp || raw.max_hp || raw.hp) || base.attributes.max_hp)),
        shield_capacity: Math.max(0, Math.min(10, Number(raw.attributes?.shield_capacity || raw.shield_capacity || raw.shield) || base.attributes.shield_capacity)),
        hitbox_radius: Math.max(5, Math.min(25, Number(raw.attributes?.hitbox_radius || raw.hitbox_radius || raw.hitbox) || base.attributes.hitbox_radius))
      },
      weapons: {
        primary: {
          type: primaryType,
          damage: Number(raw.weapons?.primary?.damage || raw.damage) || (primaryType === 'laser' ? 45 : primaryType === 'plasma' ? 60 : 35),
          fire_rate: Math.max(1, Math.min(25, Number(raw.weapons?.primary?.fire_rate || raw.fire_rate) || base.weapons.primary.fire_rate)),
          bullet_speed: Number(raw.weapons?.primary?.bullet_speed || raw.bullet_speed) || base.weapons.primary.bullet_speed,
          spread_angle: primaryType === 'vulcan_spread' ? 0.25 : 0
        },
        secondary: {
          type: secondaryType,
          damage: Number(raw.weapons?.secondary?.damage) || base.weapons.secondary.damage,
          cooldown_seconds: Math.max(1, Math.min(10, Number(raw.weapons?.secondary?.cooldown_seconds || raw.cooldown) || base.weapons.secondary.cooldown_seconds))
        }
      },
      visuals: {
        style_name: raw.visuals?.style_name || raw.style_name || raw.name || `${raw.pilot?.callsign || 'Custom'}-01 Swarmstrike`,
        primary_color: raw.visuals?.primary_color || raw.primary_color || '#ff0055',
        secondary_color: raw.visuals?.secondary_color || raw.secondary_color || '#00f3ff',
        engine_trail_color: raw.visuals?.engine_trail_color || raw.engine_trail_color || '#ffd700',
        svg_path_data: raw.visuals?.svg_path_data || base.visuals.svg_path_data
      }
    };
  }

  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
    if (this.pollIntervalTimer) {
      clearInterval(this.pollIntervalTimer);
      this.pollIntervalTimer = undefined;
    }
  }
}
