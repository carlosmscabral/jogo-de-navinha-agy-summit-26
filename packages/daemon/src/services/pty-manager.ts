import { spawn, ChildProcess } from 'node:child_process';
import { WebSocket } from 'ws';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { FALLBACK_PRESETS, ShipSpecification, PrimaryWeaponType, SecondaryWeaponType } from '@jogo/shared';

export class PtyManagerService {
  private activeProcess?: ChildProcess;
  private wsClient?: WebSocket;
  private isAgyShell = false;

  private currentLineBuffer = '';
  private history: string[] = [];
  private historyIndex = -1;

  private sessionDir = '/tmp/booth_session';
  private pilotCallsign = 'CYBER_ACE';
  private pilotCompany = 'Google';
  private currentSpec: ShipSpecification = JSON.parse(JSON.stringify(FALLBACK_PRESETS.interceptor));

  startSession(
    sessionDir: string,
    ws: WebSocket,
    initialPrompt = 'agy'
  ): void {
    this.killSession();
    this.wsClient = ws;
    this.sessionDir = sessionDir;

    // 1. Ensure session directory exists
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    // 2. Read pilot metadata from GEMINI.md if available
    const geminiPath = path.join(sessionDir, 'GEMINI.md');
    if (fs.existsSync(geminiPath)) {
      const content = fs.readFileSync(geminiPath, 'utf8');
      const callsignMatch = content.match(/Callsign: "([^"]+)"/);
      if (callsignMatch) this.pilotCallsign = callsignMatch[1];
      const companyMatch = content.match(/Empresa: "([^"]+)"/);
      if (companyMatch) this.pilotCompany = companyMatch[1];
    }

    // 3. Check for Real AGY CLI binary on host
    const agyBinaryPath = this.detectAgyBinary();

    if (agyBinaryPath) {
      console.log(`[PtyManager] Spawning real Antigravity CLI process: ${agyBinaryPath} in ${sessionDir}`);
      try {
        const binDir = path.dirname(agyBinaryPath);
        const augmentedPath = `${binDir}:/usr/local/bin:/opt/homebrew/bin:${process.env.PATH || ''}`;

        this.sendOutput('\r\n\x1b[1;32m✓ Antigravity CLI detectado: ' + agyBinaryPath + '\x1b[0m\r\n');
        this.sendOutput('\x1b[90mIniciando sessão do agente...\x1b[0m\r\n\r\n');

        this.activeProcess = spawn(agyBinaryPath, [], {
          cwd: sessionDir,
          shell: true,
          env: {
            ...process.env,
            BOOTH_SESSION_DIR: sessionDir,
            PATH: augmentedPath,
            FORCE_COLOR: '1',
            TERM: 'xterm-256color'
          },
          stdio: ['pipe', 'pipe', 'pipe']
        });

        this.isAgyShell = false;

        // Pipe stdout -> WebSocket client
        this.activeProcess.stdout?.on('data', (chunk: Buffer) => {
          const str = chunk.toString('utf8');
          console.log('[AGY stdout]', str.trim());
          if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
            this.wsClient.send(JSON.stringify({ type: 'pty_output', data: str }));
          }
        });

        // Pipe stderr -> WebSocket client
        this.activeProcess.stderr?.on('data', (chunk: Buffer) => {
          const str = chunk.toString('utf8');
          console.log('[AGY stderr]', str.trim());
          if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
            this.wsClient.send(JSON.stringify({ type: 'pty_output', data: str }));
          }
        });

        this.activeProcess.on('exit', (exitCode, signal) => {
          console.log(`[PtyManager] Real AGY process exited (code=${exitCode}, signal=${signal})`);
          if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
            this.wsClient.send(JSON.stringify({ type: 'pty_exit', exitCode, signal }));
          }
          this.activeProcess = undefined;
        });

        this.activeProcess.on('error', (err) => {
          console.warn('[PtyManager] Real AGY process error, falling back to interactive shell:', err);
          this.startAgyInteractiveShell();
        });

        // Send initial wake-up newline
        setTimeout(() => {
          if (this.activeProcess?.stdin?.writable) {
            console.log('[PtyManager] Sending initial wake-up prompt to agy stdin...');
            this.activeProcess.stdin.write('\r\n');
          }
        }, 500);

        return;
      } catch (err) {
        console.warn('[PtyManager] Failed to spawn real agy process, using built-in interactive shell fallback:', err);
      }
    } else {
      console.log('[PtyManager] Real agy binary not found in known paths, using built-in interactive shell.');
    }

    // 4. Fallback to Built-in Interactive AGY CLI Shell
    this.startAgyInteractiveShell();
  }

  private detectAgyBinary(): string | null {
    const candidates = [
      process.env.AGY_BIN_PATH,
      '/Users/carloscabral/.local/bin/agy',
      path.join(os.homedir(), '.local', 'bin', 'agy'),
      '/usr/local/bin/agy',
      path.join(os.homedir(), 'bin', 'agy'),
      '/opt/homebrew/bin/agy'
    ].filter(Boolean) as string[];

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        try {
          fs.accessSync(p, fs.constants.X_OK);
          return p;
        } catch {
          // not executable
        }
      }
    }

    return null;
  }

  private startAgyInteractiveShell(): void {
    this.isAgyShell = true;
    this.currentLineBuffer = '';

    this.sendOutput('\r\n\x1b[1;36m===============================================================================\x1b[0m\r\n');
    this.sendOutput('\x1b[1;33m       ANTIGRAVITY CLI v2.6 // AMBIENTE DE FORJA DE AGENTES ESPACIAIS          \x1b[0m\r\n');
    this.sendOutput('\x1b[1;36m===============================================================================\x1b[0m\r\n');
    this.sendOutput(`\x1b[90mPiloto: \x1b[1;37m${this.pilotCallsign}\x1b[90m | Empresa: \x1b[1;37m${this.pilotCompany}\x1b[90m | Workspace: \x1b[1;37m${this.sessionDir}\x1b[0m\r\n\r\n`);

    this.sendOutput('\x1b[1;32m✓ Sub-agentes carregados:\x1b[0m aesthetic-designer, combat-strategist, systems-engineer\r\n');
    this.sendOutput('\x1b[1;32m✓ Servidores MCP conectados:\x1b[0m weapons-arsenal, hull-propulsion, cybernetics-shields\r\n\r\n');

    this.sendOutput('\x1b[1;33m💡 COMANDOS DISPONÍVEIS & PROMPTS:\x1b[0m\r\n');
    this.sendOutput('  \x1b[36m/help\x1b[0m             - Exibe lista completa de comandos e sintaxe\r\n');
    this.sendOutput('  \x1b[36m/mcp\x1b[0m              - Inspeciona servidores MCP e ferramentas disponíveis\r\n');
    this.sendOutput('  \x1b[36m/agents\x1b[0m           - Exibe sub-agentes carregados no workspace\r\n');
    this.sendOutput('  \x1b[36m/status\x1b[0m           - Visualiza a configuração e matriz de energia atual\r\n');
    this.sendOutput('  \x1b[36m/forge\x1b[0m            - Executa a síntese autônoma da nave via sub-agentes\r\n');
    this.sendOutput('  \x1b[35m[Prompt Livre]\x1b[0m    - Digite qualquer instrução (ex: "faça uma nave rápida com lasers")\r\n\r\n');

    this.renderPrompt();
  }

  private renderPrompt(): void {
    this.sendOutput(`\x1b[1;32m${this.pilotCallsign.toLowerCase()}@agy-summit\x1b[0m:\x1b[1;34m~/forja\x1b[0m \x1b[1;33m❯\x1b[0m `);
  }

  writeInput(data: string): void {
    if (this.activeProcess && this.activeProcess.stdin?.writable) {
      this.activeProcess.stdin.write(data);
      return;
    }

    if (this.isAgyShell) {
      this.handleShellInput(data);
    }
  }

  private handleShellInput(data: string): void {
    // 1. Enter key (\r or \n)
    if (data === '\r' || data === '\n') {
      this.sendOutput('\r\n');
      const command = this.currentLineBuffer.trim();
      this.currentLineBuffer = '';

      if (command.length > 0) {
        this.history.push(command);
        this.historyIndex = this.history.length;
        this.processCommand(command);
      } else {
        this.renderPrompt();
      }
      return;
    }

    // 2. Backspace key (\x7f or \b)
    if (data === '\x7f' || data === '\b') {
      if (this.currentLineBuffer.length > 0) {
        this.currentLineBuffer = this.currentLineBuffer.slice(0, -1);
        this.sendOutput('\b \b');
      }
      return;
    }

    // 3. Arrow Up (History previous)
    if (data === '\x1b[A') {
      if (this.history.length > 0 && this.historyIndex > 0) {
        this.historyIndex--;
        this.replaceCurrentLine(this.history[this.historyIndex]);
      }
      return;
    }

    // 4. Arrow Down (History next)
    if (data === '\x1b[B') {
      if (this.historyIndex < this.history.length - 1) {
        this.historyIndex++;
        this.replaceCurrentLine(this.history[this.historyIndex]);
      } else {
        this.historyIndex = this.history.length;
        this.replaceCurrentLine('');
      }
      return;
    }

    // 5. Normal Character Input
    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      this.currentLineBuffer += data;
      this.sendOutput(data);
    }
  }

  private replaceCurrentLine(newText: string): void {
    while (this.currentLineBuffer.length > 0) {
      this.sendOutput('\b \b');
      this.currentLineBuffer = this.currentLineBuffer.slice(0, -1);
    }
    this.currentLineBuffer = newText;
    this.sendOutput(newText);
  }

  private processCommand(input: string): void {
    const lower = input.toLowerCase().trim();

    if (lower === '/help') {
      this.printHelp();
    } else if (lower === '/mcp' || lower === '/mcp list') {
      this.printMcpServers();
    } else if (lower === '/agents' || lower === '/subagents') {
      this.printSubagents();
    } else if (lower === '/status') {
      this.printStatus();
    } else if (lower === '/clear') {
      this.sendOutput('\x1b[2J\x1b[H');
      this.renderPrompt();
    } else if (lower.startsWith('/preset')) {
      this.handlePresetCommand(lower);
    } else if (lower === '/forge' || lower === '/build') {
      this.executeAgentForge('Forja padrão balanceada solicitada pelo piloto.');
    } else {
      this.executeAgentForge(input);
    }
  }

  private printHelp(): void {
    this.sendOutput('\r\n\x1b[1;33m=== ANTIGRAVITY CLI // GUIA DE COMANDOS ===\x1b[0m\r\n');
    this.sendOutput('  \x1b[36m/help\x1b[0m                     - Exibe esta mensagem de ajuda\r\n');
    this.sendOutput('  \x1b[36m/mcp\x1b[0m                      - Inspeciona servidores MCP e ferramentas\r\n');
    this.sendOutput('  \x1b[36m/agents\x1b[0m                   - Lista os sub-agentes ativos no workspace\r\n');
    this.sendOutput('  \x1b[36m/status\x1b[0m                   - Mostra os parâmetros atuais da nave\r\n');
    this.sendOutput('  \x1b[36m/preset <tipo>\x1b[0m            - Carrega preset: interceptor | vanguard | striker\r\n');
    this.sendOutput('  \x1b[36m/forge\x1b[0m                    - Executa o pipeline de forja autônoma\r\n');
    this.sendOutput('  \x1b[36m/clear\x1b[0m                    - Limpa a tela do terminal\r\n\r\n');
    this.sendOutput('\x1b[1;35mExemplos de prompts livres em linguagem natural:\x1b[0m\r\n');
    this.sendOutput('  • "quero uma nave com lasers azuis, velocidade máxima e escudo duplo"\r\n');
    this.sendOutput('  • "forje um caça bombardeiro pesado focado em mísseis teleguiados"\r\n');
    this.sendOutput('  • "estilo cyberpunk gold com canhões vulcan espalhados"\r\n\r\n');
    this.renderPrompt();
  }

  private printMcpServers(): void {
    this.sendOutput('\r\n\x1b[1;33m=== SERVIDORES MCP ATIVOS (.agents/mcp_config.json) ===\x1b[0m\r\n');
    this.sendOutput('\x1b[1;36m1. weapons-arsenal\x1b[0m\r\n');
    this.sendOutput('   • configure_primary_cannon(type: "laser"|"plasma"|"vulcan_spread", damage, fire_rate)\r\n');
    this.sendOutput('   • attach_secondary_ordnance(type: "homing_missiles"|"emp_burst"|"drone_escort")\r\n\r\n');

    this.sendOutput('\x1b[1;36m2. hull-propulsion\x1b[0m\r\n');
    this.sendOutput('   • tune_thrusters(speed_px_s, agility_accel, banking_tilt)\r\n');
    this.sendOutput('   • reinforce_hull(armor_plating, max_hp, hitbox_radius)\r\n\r\n');

    this.sendOutput('\x1b[1;36m3. cybernetics-shields\x1b[0m\r\n');
    this.sendOutput('   • calibrate_shield_matrix(capacity, recharge_delay_s, aura_color)\r\n');
    this.sendOutput('   • compute_synergy_matrix(offense, speed, defense, tech)\r\n\r\n');
    this.renderPrompt();
  }

  private printSubagents(): void {
    this.sendOutput('\r\n\x1b[1;33m=== SUB-AGENTES REGISTRADOS (.agents/agents/*.md) ===\x1b[0m\r\n');
    this.sendOutput('  \x1b[1;32m• aesthetic-designer\x1b[0m  - Especialista em fuselagem vetorial SVG, temas e neon\r\n');
    this.sendOutput('  \x1b[1;32m• combat-strategist\x1b[0m   - Otimizador de DPS balístico e canhões primários/secundários\r\n');
    this.sendOutput('  \x1b[1;32m• systems-engineer\x1b[0m    - Engenheiro de propulsão, matrizes de blindagem e escudos\r\n\r\n');
    this.renderPrompt();
  }

  private printStatus(): void {
    this.sendOutput('\r\n\x1b[1;33m=== STATUS ATUAL DA NAVE ===\x1b[0m\r\n');
    this.sendOutput(`  Fuselagem: \x1b[1;37m${this.currentSpec.visuals.style_name}\x1b[0m\r\n`);
    this.sendOutput(`  Arma Primária: \x1b[1;36m${this.currentSpec.weapons.primary.type.toUpperCase()}\x1b[0m (DPS: ${this.currentSpec.weapons.primary.damage * this.currentSpec.weapons.primary.fire_rate})\r\n`);
    this.sendOutput(`  Arma Secundária: \x1b[1;35m${this.currentSpec.weapons.secondary.type.toUpperCase()}\x1b[0m\r\n`);
    this.sendOutput(`  Velocidade: \x1b[1;33m${this.currentSpec.attributes.speed_px_s} px/s\x1b[0m | Blindagem: \x1b[1;32m${this.currentSpec.attributes.max_hp} HP\x1b[0m | Escudo: \x1b[1;36m${this.currentSpec.attributes.shield_capacity}\x1b[0m\r\n\r\n`);
    this.renderPrompt();
  }

  private handlePresetCommand(cmd: string): void {
    const parts = cmd.split(' ');
    const presetName = parts[1]?.toLowerCase();

    if (presetName === 'vanguard') {
      this.currentSpec = JSON.parse(JSON.stringify(FALLBACK_PRESETS.vanguard));
      this.sendOutput('\x1b[1;32m✓ Preset Vanguard carregado com sucesso!\x1b[0m\r\n');
    } else if (presetName === 'striker') {
      this.currentSpec = JSON.parse(JSON.stringify(FALLBACK_PRESETS.striker));
      this.sendOutput('\x1b[1;32m✓ Preset Striker carregado com sucesso!\x1b[0m\r\n');
    } else {
      this.currentSpec = JSON.parse(JSON.stringify(FALLBACK_PRESETS.interceptor));
      this.sendOutput('\x1b[1;32m✓ Preset Interceptor carregado com sucesso!\x1b[0m\r\n');
    }

    this.writeSpecAndAudit('Preset ' + presetName);
    this.renderPrompt();
  }

  private executeAgentForge(userPrompt: string): void {
    this.sendOutput(`\r\n\x1b[1;34m[Orquestrador AGY]\x1b[0m Interpretando prompt: "\x1b[1;37m${userPrompt}\x1b[0m"...\r\n`);

    const lower = userPrompt.toLowerCase();

    let weaponType: PrimaryWeaponType = 'laser';
    let secondaryType: SecondaryWeaponType = 'homing_missiles';
    let styleName = 'Cyber Custom Interceptor';
    let primaryColor = '#00f3ff';
    let secondaryColor = '#ff0055';
    let speed = 350;
    let hp = 4;
    let shield = 2;

    if (lower.includes('vulcan') || lower.includes('triplo') || lower.includes('espalhado')) {
      weaponType = 'vulcan_spread';
      secondaryType = 'emp_burst';
      styleName = 'Heavy Vulcan Raider';
      primaryColor = '#ffd700';
      secondaryColor = '#00ff88';
      speed = 310;
      hp = 5;
      shield = 2;
    } else if (lower.includes('míssil') || lower.includes('plasma') || lower.includes('bombardeiro') || lower.includes('striker')) {
      weaponType = 'plasma';
      secondaryType = 'homing_missiles';
      styleName = 'Plasma Striker MK-II';
      primaryColor = '#ff0055';
      secondaryColor = '#00f3ff';
      speed = 330;
      hp = 4;
      shield = 3;
    } else {
      weaponType = 'laser';
      secondaryType = 'drone_escort';
      styleName = 'Neon Interceptor Prime';
      primaryColor = '#00f3ff';
      secondaryColor = '#ff0055';
      speed = 380;
      hp = 3;
      shield = 2;
    }

    setTimeout(() => {
      this.sendOutput('\x1b[1;32m[Orquestrador AGY]\x1b[0m Delegando tarefas para sub-agentes...\r\n');
      this.sendOutput('  \x1b[36m→ Invocando sub-agente combat-strategist...\x1b[0m\r\n');

      setTimeout(() => {
        this.sendOutput(`  \x1b[35m[MCP weapons-arsenal]\x1b[0m configure_primary_cannon(type="${weaponType}", fire_rate=8) → \x1b[32mOK\x1b[0m\r\n`);
        this.sendOutput(`  \x1b[35m[MCP weapons-arsenal]\x1b[0m attach_secondary_ordnance(type="${secondaryType}") → \x1b[32mOK\x1b[0m\r\n`);

        setTimeout(() => {
          this.sendOutput('  \x1b[36m→ Invocando sub-agente systems-engineer...\x1b[0m\r\n');
          this.sendOutput(`  \x1b[35m[MCP hull-propulsion]\x1b[0m tune_thrusters(speed=${speed}px/s, hitbox=10px) → \x1b[32mOK\x1b[0m\r\n`);
          this.sendOutput(`  \x1b[35m[MCP cybernetics-shields]\x1b[0m calibrate_shield_matrix(capacity=${shield}, hp=${hp}) → \x1b[32mOK\x1b[0m\r\n`);

          setTimeout(() => {
            this.sendOutput('  \x1b[36m→ Invocando sub-agente aesthetic-designer...\x1b[0m\r\n');
            this.sendOutput(`  \x1b[35m[Sub-Agente aesthetic-designer]\x1b[0m Gerando fuselagem SVG para "${styleName}" → \x1b[32mOK\x1b[0m\r\n\r\n`);

            this.currentSpec = {
              $schema: 'https://json-schema.org/draft-07/schema#',
              pilot: {
                callsign: this.pilotCallsign,
                company_raw: this.pilotCompany,
                company_canonical: this.pilotCompany
              },
              build_metadata: {
                selected_mcps: ['weapons-arsenal', 'hull-propulsion', 'cybernetics-shields'],
                selected_subagents: ['aesthetic-designer', 'combat-strategist'],
                energy_sliders: { offense: 30, speed: 35, defense: 20, tech: 15 },
                fast_grill_me_choices: {
                  weapon_focus: weaponType === 'vulcan_spread' ? 'vulcan_spread' : weaponType === 'plasma' ? 'missile_barrage' : 'laser_piercing',
                  visual_theme: lower.includes('dark') ? 'dark_void_stealth' : lower.includes('gold') ? 'cyberpunk_gold' : 'synthwave_80s'
                },
                synergies_unlocked: ['Balanced Ace']
              },
              attributes: {
                speed_px_s: speed,
                max_hp: hp,
                shield_capacity: shield,
                hitbox_radius: 10
              },
              weapons: {
                primary: {
                  type: weaponType,
                  damage: weaponType === 'laser' ? 45 : weaponType === 'plasma' ? 60 : 35,
                  fire_rate: weaponType === 'laser' ? 8 : weaponType === 'plasma' ? 6 : 10,
                  bullet_speed: 750,
                  spread_angle: weaponType === 'vulcan_spread' ? 0.25 : 0
                },
                secondary: {
                  type: secondaryType,
                  damage: 120,
                  cooldown_seconds: 4
                }
              },
              visuals: {
                style_name: styleName,
                primary_color: primaryColor,
                secondary_color: secondaryColor,
                engine_trail_color: '#00f3ff',
                svg_path_data: 'M 64 10 L 114 110 L 64 85 L 14 110 Z'
              }
            };

            this.writeSpecAndAudit(userPrompt);

            this.sendOutput('\x1b[1;32m✓ ship_spec.json gravado com sucesso no workspace!\x1b[0m\r\n');
            this.sendOutput('\x1b[1;33m>> SISTEMAS DA NAVE ONLINE // PRONTO PARA LANÇAMENTO! <<\x1b[0m\r\n\r\n');
            this.renderPrompt();
          }, 300);
        }, 300);
      }, 300);
    }, 200);
  }

  private writeSpecAndAudit(reason: string): void {
    try {
      const specFile = path.join(this.sessionDir, 'ship_spec.json');
      fs.writeFileSync(specFile, JSON.stringify(this.currentSpec, null, 2), 'utf8');

      const auditFile = path.join(this.sessionDir, 'mcp_audit.log');
      fs.appendFileSync(
        auditFile,
        `[${new Date().toISOString()}] Prompt: "${reason}" | weapons-arsenal/configure_primary_cannon executed | hull-propulsion/tune_thrusters executed\n`,
        'utf8'
      );
    } catch (err) {
      console.error('[PtyManager] Error saving spec/audit:', err);
    }
  }

  resize(cols: number, rows: number): void {
    // Standard stdio pipe resize is no-op
  }

  killSession(): void {
    if (this.activeProcess) {
      try {
        const pid = this.activeProcess.pid;
        if (pid) {
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {
            this.activeProcess.kill('SIGKILL');
          }
        }
      } catch (err) {
        console.error('[PtyManager] Error killing process:', err);
      }
      this.activeProcess = undefined;
    }
    this.isAgyShell = false;
  }

  private sendOutput(text: string): void {
    if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
      this.wsClient.send(JSON.stringify({ type: 'pty_output', data: text }));
    }
  }
}
