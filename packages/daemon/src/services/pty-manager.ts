import * as pty from 'node-pty';
import { WebSocket } from 'ws';
import * as os from 'node:os';

export class PtyManagerService {
  private activePty?: pty.IPty;
  private wsClient?: WebSocket;

  startSession(
    sessionDir: string,
    ws: WebSocket,
    initialPrompt = 'agy'
  ): void {
    this.killSession();
    this.wsClient = ws;

    const shell = process.env.SHELL || (os.platform() === 'win32' ? 'powershell.exe' : 'bash');

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

      // Inject Fast Grill-Me bootstrap command
      const bootCommand = `${initialPrompt}\r`;
      this.activePty.write(bootCommand);

    } catch (err) {
      console.error('[PtyManager] Failed to spawn PTY session:', err);
      if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
        this.wsClient.send(JSON.stringify({ type: 'pty_error', error: String(err) }));
      }
    }
  }

  writeInput(data: string): void {
    if (this.activePty) {
      this.activePty.write(data);
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
          // Kill entire process group to eliminate any child MCP servers
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
  }
}
