import * as pty from 'node-pty';
import { WebSocket } from 'ws';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { FALLBACK_PRESETS, ShipSpecification } from '@jogo/shared';

export class PtyManagerService {
  private activePty?: pty.IPty;
  private wsClient?: WebSocket;
  private isSimulated = false;
  private simulationState: 'WAITING_WEAPON' | 'WAITING_STYLE' | 'DONE' = 'WAITING_WEAPON';
  private selectedWeaponIndex = 1;
  private sessionDir = '/tmp/booth_session';

  startSession(
    sessionDir: string,
    ws: WebSocket,
    initialPrompt = 'agy'
  ): void {
    this.killSession();
    this.wsClient = ws;
    this.sessionDir = sessionDir;

    // Ensure session directory exists
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    // Detect valid shell binary
    let shell = process.env.SHELL;
    if (!shell || !fs.existsSync(shell)) {
      if (fs.existsSync('/bin/zsh')) shell = '/bin/zsh';
      else if (fs.existsSync('/bin/bash')) shell = '/bin/bash';
      else if (fs.existsSync('/bin/sh')) shell = '/bin/sh';
      else shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
    }

    try {
      this.activePty = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd: sessionDir,
        env: {
          ...process.env,
          BOOTH_SESSION_DIR: sessionDir,
          TERM: 'xterm-256color'
        }
      });

      this.isSimulated = false;

      // Stream PTY output -> WebSocket client
      this.activePty.onData((data: string) => {
        if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
          this.wsClient.send(JSON.stringify({ type: 'pty_output', data }));
        }
      });

      this.activePty.onExit(({ exitCode, signal }) => {
        if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
          this.wsClient.send(JSON.stringify({ type: 'pty_exit', exitCode, signal }));
        }
        this.activePty = undefined;
      });

      // Inject initial bootstrap command
      const bootCommand = `${initialPrompt}\r`;
      this.activePty.write(bootCommand);

    } catch (err) {
      console.warn('[PtyManager] Native PTY spawn failed, falling back to Interactive Fast Grill-Me Terminal:', err);
      this.startInteractiveSimulation();
    }
  }

  private startInteractiveSimulation(): void {
    this.isSimulated = true;
    this.simulationState = 'WAITING_WEAPON';

    this.sendOutput('\r\n\x1b[1;36m===================================================================\x1b[0m\r\n');
    this.sendOutput('\x1b[1;33m       ANTIGRAVITY CLI // FORJA DE NAVES ESPACIAIS AGY 2026       \x1b[0m\r\n');
    this.sendOutput('\x1b[1;36m===================================================================\x1b[0m\r\n\r\n');
    this.sendOutput('\x1b[1;32m✓ Sub-Agente aesthetic-designer conectado.\x1b[0m\r\n');
    this.sendOutput('\x1b[1;32m✓ Sub-Agente combat-strategist conectado.\x1b[0m\r\n');
    this.sendOutput('\x1b[1;32m✓ Servidores MCP carregados: weapons-arsenal, hull-propulsion\x1b[0m\r\n\r\n');

    this.sendOutput('\x1b[1;33m[Fast Grill-Me // Orquestrador AGY]\x1b[0m\r\n');
    this.sendOutput('Selecione o foco de armamento primário para a sua fuselagem:\r\n');
    this.sendOutput('  \x1b[36m[1]\x1b[0m Laser Perfurante de Alta Frequência (DPS Contínuo)\r\n');
    this.sendOutput('  \x1b[36m[2]\x1b[0m Enxame de Mísseis Teleguiados & Plasma Pesado\r\n');
    this.sendOutput('  \x1b[36m[3]\x1b[0m Vulcan Espalhado em 3 Vias (Dispersão Tática)\r\n\r\n');
    this.sendOutput('\x1b[1;37mDigite [1, 2 ou 3] e pressione Enter: \x1b[0m');
  }

  writeInput(data: string): void {
    if (this.activePty) {
      this.activePty.write(data);
      return;
    }

    if (this.isSimulated) {
      this.handleSimulatedInput(data);
    }
  }

  private handleSimulatedInput(data: string): void {
    // Echo character
    if (data === '\r' || data === '\n') {
      this.sendOutput('\r\n');
      this.advanceSimulationStep();
    } else {
      this.sendOutput(data);
      if (data === '1' || data === '2' || data === '3') {
        if (this.simulationState === 'WAITING_WEAPON') {
          this.selectedWeaponIndex = Number(data);
        }
      }
    }
  }

  private advanceSimulationStep(): void {
    if (this.simulationState === 'WAITING_WEAPON') {
      this.simulationState = 'WAITING_STYLE';
      this.sendOutput('\r\n\x1b[1;33m[Fast Grill-Me // Orquestrador AGY]\x1b[0m\r\n');
      this.sendOutput('Selecione o estilo visual e assinatura estética:\r\n');
      this.sendOutput('  \x1b[36m[1]\x1b[0m Neon Synthwave 80s (Ciano & Magenta)\r\n');
      this.sendOutput('  \x1b[36m[2]\x1b[0m Dark Void Stealth (Cinza Titânio & Ouro)\r\n');
      this.sendOutput('  \x1b[36m[3]\x1b[0m Cyber Gold Vanguard (Dourado & Esmeralda)\r\n\r\n');
      this.sendOutput('\x1b[1;37mDigite [1, 2 ou 3] e pressione Enter: \x1b[0m');
    } else if (this.simulationState === 'WAITING_STYLE') {
      this.simulationState = 'DONE';
      this.sendOutput('\r\n\x1b[1;35m[MCP] weapons-arsenal: configure_primary_cannon(type="laser", dps=780)\x1b[0m\r\n');
      this.sendOutput('\x1b[1;35m[MCP] hull-propulsion: tune_thrusters(speed_px_s=360, hitbox=9px)\x1b[0m\r\n');
      this.sendOutput('\x1b[1;35m[Sub-Agente aesthetic-designer] Sintetizando fuselagem vetorial SVG...\x1b[0m\r\n');

      setTimeout(() => {
        this.sendOutput('\x1b[1;32m✓ ship_spec.json gravado com sucesso no workspace!\x1b[0m\r\n');
        this.sendOutput('\x1b[1;33m>> SISTEMAS ONLINE // PRONTO PARA LANÇAMENTO! <<\x1b[0m\r\n');

        // Write real ship_spec.json to disk so FileWatcher triggers
        const chosenPreset: ShipSpecification =
          this.selectedWeaponIndex === 2
            ? FALLBACK_PRESETS.striker
            : this.selectedWeaponIndex === 3
            ? FALLBACK_PRESETS.vanguard
            : FALLBACK_PRESETS.interceptor;

        const specFile = path.join(this.sessionDir, 'ship_spec.json');
        fs.writeFileSync(specFile, JSON.stringify(chosenPreset, null, 2), 'utf8');

        // Write audit log
        const auditFile = path.join(this.sessionDir, 'mcp_audit.log');
        fs.appendFileSync(
          auditFile,
          `[${new Date().toISOString()}] weapons-arsenal/configure_primary_cannon executed\n[${new Date().toISOString()}] hull-propulsion/tune_thrusters executed\n`,
          'utf8'
        );
      }, 800);
    }
  }

  private sendOutput(text: string): void {
    if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
      this.wsClient.send(JSON.stringify({ type: 'pty_output', data: text }));
    }
  }

  resize(cols: number, rows: number): void {
    if (this.activePty) {
      try {
        this.activePty.resize(cols, rows);
      } catch {
        // Ignored
      }
    }
  }

  killSession(): void {
    if (this.activePty) {
      try {
        const pid = this.activePty.pid;
        if (pid) {
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {
            this.activePty.kill();
          }
        }
      } catch (err) {
        console.error('[PtyManager] Error killing session:', err);
      }
      this.activePty = undefined;
    }
    this.isSimulated = false;
  }
}
