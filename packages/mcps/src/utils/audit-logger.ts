import * as fs from 'node:fs';
import * as path from 'node:path';

export function logMcpToolExecution(serverName: string, toolName: string, args: unknown, result: unknown): void {
  try {
    const sessionDir = process.env.BOOTH_SESSION_DIR || '/tmp/booth_session';
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }
    const logPath = path.join(sessionDir, 'mcp_audit.log');
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      server: serverName,
      tool: toolName,
      args,
      result
    }) + '\n';
    fs.appendFileSync(logPath, entry, 'utf8');
  } catch (err) {
    // Non-blocking logger
    console.error(`[MCP Audit Error] ${serverName}:${toolName}:`, err);
  }
}
