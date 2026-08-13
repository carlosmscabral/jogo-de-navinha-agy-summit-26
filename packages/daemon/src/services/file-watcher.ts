import chokidar, { FSWatcher } from 'chokidar';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { validateShipSpecification, ShipSpecification, computeBaselineAttributes, computeBaselineWeapons } from '@jogo/shared';

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
  onAuditGateSatisfied?: () => void;
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
  private auditGateSatisfiedNotified = false;
  private currentTargetFile?: string;
  private currentAuditFile?: string;
  private currentSessionDir?: string;

  startWatching(sessionDir: string, opts: WatchOptions): void {
    this.stopWatching();
    this.opts = opts;
    this.lastProcessedTimestamp = 0;
    this.lastAuditLogLength = 0;
    this.currentSpec = undefined;
    this.pendingSpec = undefined;
    this.activityHistory = [];
    this.auditGateSatisfiedNotified = false;

    const targetFile = path.join(sessionDir, 'ship_spec.json');
    const auditFile = path.join(sessionDir, 'mcp_audit.log');
    this.currentTargetFile = targetFile;
    this.currentAuditFile = auditFile;
    this.currentSessionDir = sessionDir;

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

  /**
   * Checagem síncrona sob demanda, chamada pelo daemon logo antes de desistir
   * por timeout. Uma spec válida pode ter sido escrita no exato instante em
   * que o temporizador também estourou — sem isso, o daemon descartaria uma
   * nave real por uma corrida de poucos milissegundos contra o polling normal.
   */
  forceCheckNow(): void {
    if (!this.currentTargetFile || !this.currentAuditFile || !this.currentSessionDir) return;
    this.checkAndProcessAuditLog(this.currentAuditFile);
    this.checkAndProcessSpecFile(this.currentTargetFile, this.currentSessionDir);
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
          if (!this.auditGateSatisfiedNotified) {
            const audit = this.auditSatisfied();
            if (audit.ok) {
              this.auditGateSatisfiedNotified = true;
              this.opts?.onAuditGateSatisfied?.();
            }
          }
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

      // 1b. Preenche com a fórmula-base determinística os domínios de MCPs
      // NÃO selecionados (gamificação: nem todo visitante escolhe os 3 MCPs).
      const backfilledSpec = this.applyBaselineForUnselectedMcps(normalizedSpec, this.opts?.requiredMcps ?? []);

      // 2. [D1] Validação estrita contra o Draft-07. Sem coerção silenciosa.
      const validation = validateShipSpecification(backfilledSpec);
      if (!validation.isValid) {
        const details = validation.errors ?? ['erro de validação desconhecido'];
        console.error('[FileWatcher] ship_spec.json rejeitado pelo schema:', details.join('; '));
        this.opts?.onSpecRejected?.({ reason: 'SCHEMA_INVALID', details });
        return;
      }

      // 3. [D3] Gate de auditoria: nenhuma nave decola sem prova de execução das tools.
      this.pendingSpec = backfilledSpec;
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

  /**
   * Preenche, com a fórmula-base determinística de `computeBaselineAttributes`/
   * `computeBaselineWeapons`, apenas os campos cujo MCP dono NÃO foi selecionado
   * pelo visitante. Um MCP selecionado nunca tem seu domínio sobrescrito aqui —
   * mesmo que o agente tenha produzido algo incompleto ou errado, o validador
   * estrito que roda em seguida deve rejeitar normalmente, preservando a
   * garantia da REGRA ZERO para tudo que o agente afirma ter vindo de uma tool real.
   *
   * Posse de campo por MCP (ver packages/mcps/src/*.ts):
   *  - hull-propulsion:     attributes.max_hp, attributes.speed_px_s, attributes.hitbox_radius
   *  - cybernetics-shields: attributes.shield_capacity
   *  - weapons-arsenal:     weapons.primary.*, weapons.secondary.*
   */
  private applyBaselineForUnselectedMcps(spec: ShipSpecification, requiredMcps: string[]): ShipSpecification {
    const sliders = spec.build_metadata?.energy_sliders;
    const slidersComplete =
      !!sliders &&
      Number.isFinite(sliders.offense) &&
      Number.isFinite(sliders.speed) &&
      Number.isFinite(sliders.defense) &&
      Number.isFinite(sliders.tech);

    // Sem sliders válidos não há como calcular uma base -- deixa a validação
    // estrita abaixo rejeitar pelo motivo real (energy_sliders ausente/inválido).
    if (!slidersComplete) return spec;

    const baselineAttrs = computeBaselineAttributes(sliders);

    if (!requiredMcps.includes('hull-propulsion')) {
      spec.attributes.max_hp = baselineAttrs.max_hp;
      spec.attributes.speed_px_s = baselineAttrs.speed_px_s;
      spec.attributes.hitbox_radius = baselineAttrs.hitbox_radius;
    }

    if (!requiredMcps.includes('cybernetics-shields')) {
      spec.attributes.shield_capacity = baselineAttrs.shield_capacity;
    }

    if (!requiredMcps.includes('weapons-arsenal')) {
      const weaponFocus = spec.build_metadata?.fast_grill_me_choices?.weapon_focus as string | undefined;
      if (weaponFocus === 'laser_piercing' || weaponFocus === 'missile_barrage' || weaponFocus === 'vulcan_spread') {
        spec.weapons = computeBaselineWeapons(sliders, weaponFocus);
      }
      // weapon_focus ausente/inválido: deixa `weapons` como está (provavelmente
      // incompleto) e a validação estrita abaixo rejeita pelo motivo real.
    }

    return spec;
  }

  /**
   * [D14] Faixa numérica NÃO é mais julgada aqui. Antes, cada campo numérico
   * passava por um `Math.max(N, Math.min(M, ...))` que silenciosamente coagia
   * qualquer valor fora da faixa para o limite mais próximo -- um segundo
   * contrato de faixas, independente do schema e capaz de discordar dele. Se
   * o agente for informado de que `fire_rate` vai de 5 a 12 e enviar 60, o
   * clamp devolvia 12 sem erro: a faixa anunciada virava ficção.
   *
   * A partir de agora, quem julga faixa é exclusivamente `ship_spec.schema.json`
   * (gerado de `BALANCE.ranges`, ver `gen-schema.ts`). Esta função continua
   * fazendo apenas o que sempre fez de estrutural/de nomes -- mapear campos
   * frouxos (`raw.damage`, `raw.callsign` etc.) para o formato canônico e
   * inferir o tipo de arma a partir de texto livre -- e repassa os valores
   * numéricos intactos (só convertidos com `Number(...)`) para a validação
   * estrita logo abaixo. Um valor fora da faixa chega como fora da faixa e é
   * REJEITADO com um erro claro, em vez de virar um número diferente e
   * igualmente errado.
   */
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

    // [Fase A / revisão final — Importante 3] O schema estrito (additionalProperties:
    // false na raiz) NÃO declara "$schema" como propriedade permitida. Agentes de IA
    // costumam emitir "$schema": "https://json-schema.org/draft-07/schema#" por
    // convenção em JSON escrito à mão — se o raw trouxer essa chave, ela NUNCA deve
    // sobreviver à normalização, senão o Ajv rejeita com "root must NOT have
    // additional properties" mesmo para specs corretas em tudo o mais.
    //
    // [D1] IMPORTANTE: normalizeSpec só reposiciona nomes de campo frouxos que o agente
    // realmente forneceu (ex.: raw.damage → weapons.primary.damage). Campos ausentes NÃO
    // são mais preenchidos com um preset "plausível" (FALLBACK_PRESETS) — isso é exatamente
    // a coerção silenciosa que permitia specs alucinadas/vazias decolarem sem checagem real.
    // Quando nada é fornecido, o campo fica undefined/NaN e a validação estrita abaixo rejeita.
    return {
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
        speed_px_s: Number(raw.attributes?.speed_px_s || raw.speed_px_s || raw.speed),
        max_hp: Number(raw.attributes?.max_hp || raw.max_hp || raw.hp),
        shield_capacity: Number(raw.attributes?.shield_capacity ?? raw.shield_capacity ?? raw.shield),
        hitbox_radius: Number(raw.attributes?.hitbox_radius || raw.hitbox_radius || raw.hitbox)
      },
      weapons: {
        primary: {
          type: primaryType,
          damage: Number(raw.weapons?.primary?.damage || raw.damage) || (primaryType === 'laser' ? 45 : primaryType === 'plasma' ? 45 : 35),
          fire_rate: Number(raw.weapons?.primary?.fire_rate || raw.fire_rate),
          bullet_speed: Number(raw.weapons?.primary?.bullet_speed || raw.bullet_speed),
          spread_angle: primaryType === 'vulcan_spread' ? 0.25 : 0
        },
        secondary: {
          type: secondaryType,
          damage: Number(raw.weapons?.secondary?.damage),
          cooldown_seconds: Number(raw.weapons?.secondary?.cooldown_seconds ?? raw.cooldown)
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
    this.currentTargetFile = undefined;
    this.currentAuditFile = undefined;
    this.currentSessionDir = undefined;
  }
}
