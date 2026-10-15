import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

// The handshake between the running app and the stdio shim (`DomBot
// --mcp-stdio`, see ./stdio.ts). The app writes this file when its MCP server
// comes up; a shim process reads it to learn where the server is and how to
// authenticate. Both run as the same user with the same userData dir, so a
// 0600 file is the trust boundary — the same one mcp-tokens.json relies on.

export interface StdioConfig {
  /** The MCP endpoint, e.g. http://127.0.0.1:4123/mcp */
  url: string;
  /** Per-listener signing key. Kept off the wire; the field name is legacy. */
  token: string;
}

/** Where the handshake file lives — surfaced in shim errors for debugging. */
export function stdioConfigPath(): string {
  return path.join(app.getPath('userData'), 'mcp-stdio.json');
}

function configFile(): string {
  return stdioConfigPath();
}

/** The current config, or null if the app has never started its MCP server. */
export function readStdioConfig(): StdioConfig | null {
  try {
    const raw = JSON.parse(
      fs.readFileSync(configFile(), 'utf8'),
    ) as Partial<StdioConfig>;
    if (typeof raw.url !== 'string' || typeof raw.token !== 'string')
      return null;
    return { url: raw.url, token: raw.token };
  } catch {
    return null;
  }
}

/**
 * Publish the current listener key atomically, replacing any older credential.
 * Shims read the new key when they reconnect after an app restart.
 */
export function writeStdioConfig(
  url: string,
  token = randomBytes(32).toString('hex'),
): StdioConfig {
  const config = { url, token };
  const tmp = `${configFile()}.${randomBytes(8).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2), {
    mode: 0o600,
    flag: 'wx',
  });
  fs.renameSync(tmp, configFile());
  return config;
}
