import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteBufferService } from './services/sqlite-buffer.js';
import { WorkspaceGeneratorService } from './services/workspace-generator.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Local Bridge Daemon Services', () => {
  it('should initialize SQLite database and search companies', () => {
    const sqlite = new SQLiteBufferService(':memory:');
    const results = sqlite.searchCompanies('Goo');
    assert.ok(results.length > 0);
    assert.ok(results.includes('Google') || results.includes('Google Cloud'));

    const resolved = sqlite.resolveCompany('google cloud');
    assert.ok(resolved.canonical.toLowerCase().includes('google'));
    assert.ok(resolved.confidence > 0);
    sqlite.close();
  });

  it('should generate dynamic session workspace and .agents configs', () => {
    const tempDir = path.join('/tmp', 'test_booth_session_' + Date.now());
    WorkspaceGeneratorService.generateWorkspace({
      sessionDir: tempDir,
      pilot: {
        callsign: 'TestPilot',
        company_raw: 'Google',
        company_canonical: 'Google'
      },
      energy_sliders: { offense: 30, speed: 40, defense: 20, tech: 10 },
      selected_mcps: ['weapons-arsenal', 'hull-propulsion'],
      selected_subagents: ['aesthetic-designer', 'combat-strategist'],
      mcpsDistDir: '/tmp'
    });

    assert.ok(fs.existsSync(path.join(tempDir, '.agents', 'mcp_config.json')));
    assert.ok(fs.existsSync(path.join(tempDir, '.agents', 'agents', 'aesthetic-designer.md')));
    assert.ok(fs.existsSync(path.join(tempDir, '.agents', 'agents', 'combat-strategist.md')));
    assert.ok(fs.existsSync(path.join(tempDir, 'GEMINI.md')));

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
