import chokidar, { FSWatcher } from 'chokidar';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { validateShipSpecification, ShipSpecification } from '@jogo/shared';

export class FileWatcherService {
  private watcher?: FSWatcher;
  private onShipReadyCallback?: (spec: ShipSpecification) => void;

  startWatching(sessionDir: string, onShipReady: (spec: ShipSpecification) => void): void {
    this.stopWatching();
    this.onShipReadyCallback = onShipReady;

    const targetFile = path.join(sessionDir, 'ship_spec.json');

    this.watcher = chokidar.watch(targetFile, {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 150,
        pollInterval: 50
      }
    });

    this.watcher.on('add', (filePath: string) => this.handleFileChange(filePath, sessionDir));
    this.watcher.on('change', (filePath: string) => this.handleFileChange(filePath, sessionDir));
  }

  private handleFileChange(filePath: string, sessionDir: string): void {
    try {
      if (!fs.existsSync(filePath)) return;
      const raw = fs.readFileSync(filePath, 'utf8');
      if (!raw || raw.trim().length === 0) return;

      const parsed = JSON.parse(raw);
      const validation = validateShipSpecification(parsed);

      if (validation.isValid) {
        // Verify audit log has tool executions
        const auditLogPath = path.join(sessionDir, 'mcp_audit.log');
        let auditLogContent = '';
        if (fs.existsSync(auditLogPath)) {
          auditLogContent = fs.readFileSync(auditLogPath, 'utf8');
        }

        console.log('[FileWatcher] Valid ship_spec.json detected! Audit entries:', auditLogContent.split('\n').filter(Boolean).length);
        if (this.onShipReadyCallback) {
          this.onShipReadyCallback(parsed as ShipSpecification);
        }
      } else {
        console.warn('[FileWatcher] Invalid ship_spec.json generated:', validation.errors);
      }
    } catch (err) {
      console.error('[FileWatcher] Error parsing ship_spec.json:', err);
    }
  }

  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
  }
}
