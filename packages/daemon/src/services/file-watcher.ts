import chokidar, { FSWatcher } from 'chokidar';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { validateShipSpecification, ShipSpecification } from '@jogo/shared';

export interface McpActivityEvent {
  timestamp: string;
  server: string;
  tool: string;
  args?: any;
  result?: any;
}

export type SpecRejection = {
  reason: 'SCHEMA_INVALID' | 'AUDIT_GATE_FAILED';
  details: string[];
};

export interface WatchOptions {
  requiredMcps: string[];
  onShipReady: (spec: ShipSpecification) => void;
  onMcpActivity?: (activity: McpActivityEvent) => void;
  onSpecRejected?: (rejection: SpecRejection) => void;
}

export class FileWatcherService {
  private watcher?: FSWatcher;
  private pollIntervalTimer?: NodeJS.Timeout;
  private opts?: WatchOptions;
  private lastProcessedTimestamp = 0;
  private lastAuditLogLength = 0;
  private currentSpec?: ShipSpecification;
  private pendingSpec?: ShipSpecification;
  private activityHistory: McpActivityEvent[] = [];

  startWatching(sessionDir: string, opts: WatchOptions): void {
    this.stopWatching();
    this.opts = opts;
    this.lastProcessedTimestamp = 0;
    this.lastAuditLogLength = 0;
    this.currentSpec = undefined;
    this.pendingSpec = undefined;
    this.activityHistory = [];

    const targetFile = path.join(sessionDir, 'ship_spec.json');
    const auditFile = path.join(sessionDir, 'mcp_audit.log');

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
          this.checkAndProcessSpecFile(targetFile, sessionDir);
        } else if (filePath.endsWith('mcp_audit.log')) {
          this.checkAndProcessAuditLog(auditFile);
        }
      });

      this.watcher.on('change', (filePath: string) => {
        if (filePath.endsWith('ship_spec.json')) {
          this.checkAndProcessSpecFile(targetFile, sessionDir);
        } else if (filePath.endsWith('mcp_audit.log')) {
          this.checkAndProcessAuditLog(auditFile);
        }
      });
    } catch (err) {
      console.warn('[FileWatcher] Chokidar init warning, relying on active polling:', err);
    }

    // 2. Active Polling Backup (Every 400ms - guaranteed detection across macOS/Linux)
    this.pollIntervalTimer = setInterval(() => {
      this.checkAndProcessSpecFile(targetFile, sessionDir);
      this.checkAndProcessAuditLog(auditFile);
    }, 400);
  }

  getCurrentSpec(): ShipSpecification | undefined {
    return this.currentSpec;
  }

  getActivityHistory(): McpActivityEvent[] {
    return this.activityHistory;
  }

  private auditSatisfied(): { ok: boolean; missing: string[] } {
    const required = this.opts?.requiredMcps ?? [];
    if (required.length === 0) return { ok: true, missing: [] };
    const seen = new Set(this.activityHistory.map((a) => a.server));
    const missing = required.filter((m) => !seen.has(m));
    return { ok: missing.length === 0, missing };
  }

  private releaseIfAuditSatisfied(): void {
    if (!this.pendingSpec) return;
    const audit = this.auditSatisfied();
    if (!audit.ok) return;
    const spec = this.pendingSpec;
    this.pendingSpec = undefined;
    this.currentSpec = spec;
    console.log(`[FileWatcher] Spec liberada após auditoria completa: ${spec.pilot.callsign}`);
    this.opts?.onShipReady(spec);
  }

  private checkAndProcessAuditLog(auditPath: string): void {
    try {
      if (!fs.existsSync(auditPath)) return;
      const raw = fs.readFileSync(auditPath, 'utf8');
      if (raw.length <= this.lastAuditLogLength) return;

      const newContent = raw.slice(this.lastAuditLogLength);
      this.lastAuditLogLength = raw.length;

      const lines = newContent.split('\n').filter((l) => l.trim().length > 0);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as McpActivityEvent;
          this.activityHistory.push(entry);
          console.log(`[FileWatcher] MCP Tool Executed: [${entry.server}] ${entry.tool}`);
          this.opts?.onMcpActivity?.(entry);
          this.releaseIfAuditSatisfied();
        } catch {
          // Ignore non-json line
        }
      }
    } catch (err) {
      // Non-blocking
    }
  }

  private checkAndProcessSpecFile(filePath: string, sessionDir: string): void {
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

      // 1. Mapeia nomes de campo frouxos para o formato canônico.
      const normalizedSpec = this.normalizeSpec(parsed);

      // 2. [D1] Validação estrita contra o Draft-07. Sem coerção silenciosa.
      const validation = validateShipSpecification(normalizedSpec);
      if (!validation.isValid) {
        const details = validation.errors ?? ['erro de validação desconhecido'];
        console.error('[FileWatcher] ship_spec.json rejeitado pelo schema:', details.join('; '));
        this.opts?.onSpecRejected?.({ reason: 'SCHEMA_INVALID', details });
        return;
      }

      // 3. [D3] Gate de auditoria: nenhuma nave decola sem prova de execução das tools.
      this.pendingSpec = normalizedSpec;
      const audit = this.auditSatisfied();
      if (!audit.ok) {
        console.warn(`[FileWatcher] Spec válida em espera; MCPs sem registro de auditoria: ${audit.missing.join(', ')}`);
        return;
      }

      this.releaseIfAuditSatisfied();
    } catch (err) {
      console.error('[FileWatcher] Error reading/parsing ship_spec.json:', err);
    }
  }

  private normalizeSpec(raw: any): ShipSpecification {
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

    // [D1] $schema é metadado opcional: só entra no objeto quando há valor real, para não
    // disparar "additionalProperties" no schema estrito (que não declara essa chave).
    const schemaValue: string | undefined = raw.$schema;

    // [D1] IMPORTANTE: normalizeSpec só reposiciona nomes de campo frouxos que o agente
    // realmente forneceu (ex.: raw.damage → weapons.primary.damage). Campos ausentes NÃO
    // são mais preenchidos com um preset "plausível" (FALLBACK_PRESETS) — isso é exatamente
    // a coerção silenciosa que permitia specs alucinadas/vazias decolarem sem checagem real.
    // Quando nada é fornecido, o campo fica undefined/NaN e a validação estrita abaixo rejeita.
    return {
      ...(schemaValue ? { $schema: schemaValue } : {}),
      pilot: {
        callsign: raw.pilot?.callsign || raw.callsign,
        company_raw: raw.pilot?.company_raw || raw.company,
        company_canonical: raw.pilot?.company_canonical || raw.company
      },
      build_metadata: {
        selected_mcps: Array.isArray(raw.build_metadata?.selected_mcps)
          ? raw.build_metadata.selected_mcps
          : undefined,
        selected_subagents: Array.isArray(raw.build_metadata?.selected_subagents)
          ? raw.build_metadata.selected_subagents
          : undefined,
        energy_sliders: {
          offense: Number(raw.build_metadata?.energy_sliders?.offense || raw.offense || raw.attack),
          speed: Number(raw.build_metadata?.energy_sliders?.speed || raw.speed),
          defense: Number(raw.build_metadata?.energy_sliders?.defense || raw.defense),
          tech: Number(raw.build_metadata?.energy_sliders?.tech || raw.tech)
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
        speed_px_s: Math.max(150, Math.min(500, Number(raw.attributes?.speed_px_s || raw.speed_px_s || raw.speed))),
        max_hp: Math.max(1, Math.min(10, Number(raw.attributes?.max_hp || raw.max_hp || raw.hp))),
        shield_capacity: Math.max(0, Math.min(10, Number(raw.attributes?.shield_capacity || raw.shield_capacity || raw.shield))),
        hitbox_radius: Math.max(5, Math.min(25, Number(raw.attributes?.hitbox_radius || raw.hitbox_radius || raw.hitbox)))
      },
      weapons: {
        primary: {
          type: primaryType,
          damage: Number(raw.weapons?.primary?.damage || raw.damage) || (primaryType === 'laser' ? 45 : primaryType === 'plasma' ? 60 : 35),
          fire_rate: Math.max(1, Math.min(25, Number(raw.weapons?.primary?.fire_rate || raw.fire_rate))),
          bullet_speed: Number(raw.weapons?.primary?.bullet_speed || raw.bullet_speed),
          spread_angle: primaryType === 'vulcan_spread' ? 0.25 : 0
        },
        secondary: {
          type: secondaryType,
          damage: Number(raw.weapons?.secondary?.damage),
          cooldown_seconds: Math.max(1, Math.min(10, Number(raw.weapons?.secondary?.cooldown_seconds || raw.cooldown)))
        }
      },
      visuals: {
        style_name: raw.visuals?.style_name || raw.style_name || raw.name || `${raw.pilot?.callsign || 'Custom'}-01 Swarmstrike`,
        primary_color: raw.visuals?.primary_color || raw.primary_color || '#ff0055',
        secondary_color: raw.visuals?.secondary_color || raw.secondary_color || '#00f3ff',
        engine_trail_color: raw.visuals?.engine_trail_color || raw.engine_trail_color || '#ffd700',
        svg_path_data: raw.visuals?.svg_path_data
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
