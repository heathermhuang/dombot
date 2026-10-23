import type { Server } from 'node:http';
import { app } from 'electron';
import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createMcpRoutes } from '../../core/mcp/routes';
import { writeStdioConfig } from './stdio-config';
import {
  createStdioVerifier,
  isStdioProof,
  signStdioResponse,
} from './stdio-auth';
import { stdioCommand } from './stdio';
import type { McpInfo } from '../../shared/ipc';

// The desktop host's MCP server: the shared Hono routes (src/core/mcp/routes.ts)
// served on loopback. Auth is OAuth 2.1 — clients register dynamically and the
// human approves each new connection in the DomBot window — plus two static
// tokens: the stdio shim's per-install token, and DOMBOT_MCP_TOKEN for
// dev/testing.

let httpServer: Server | null = null;
let info: McpInfo | null = null;

/** Current server status, or a stopped placeholder if it never started. */
export function getMcpInfo(): McpInfo {
  return info ?? { running: false, url: '', stdioCommand: '', stdioArgs: [] };
}

const TOKEN_TTL_SEC = 365 * 24 * 60 * 60;

/** Tokens the desktop accepts without the approval flow. */
async function verifyStaticToken(
  token: string,
  request: Request,
  verifyStdio: ReturnType<typeof createStdioVerifier>,
) {
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SEC;
  const resource = new URL('/mcp', request.url);
  // Dev/testing escape hatch: a static token via env.
  const staticToken = process.env.DOMBOT_MCP_TOKEN;
  if (staticToken && token === staticToken) {
    return {
      token,
      clientId: 'static',
      scopes: ['portfolio:read'],
      resource,
      expiresAt,
    };
  }
  // The key stays in the owner-only file; only one-use request proofs cross TCP.
  // Never accept the old per-install bearer credential from a copied config.
  if (await verifyStdio(token, request)) {
    return {
      token,
      clientId: 'stdio',
      scopes: ['portfolio:read'],
      resource,
      expiresAt,
      extra: { clientName: 'Local stdio' },
    };
  }
  return null;
}

/**
 * Starts the local MCP server on loopback. Idempotent. Port pinnable via
 * DOMBOT_MCP_PORT.
 */
export async function startMcpServer(): Promise<McpInfo> {
  if (info?.running) return info;

  const host = '127.0.0.1';
  const port = Number(process.env.DOMBOT_MCP_PORT) || 4123;
  const mcpUrl = new URL('/mcp', `http://${host}:${port}`);
  const config = { url: mcpUrl.href, token: randomBytes(32).toString('hex') };
  const hono = createDesktopMcpApp(config, app.getVersion());

  await new Promise<void>((resolve, reject) => {
    // Loopback only — never expose registrar control beyond this machine.
    const server = serve({ fetch: hono.fetch, port, hostname: host }, () =>
      resolve(),
    ) as Server;
    server.once('error', reject);
    httpServer = server;
  });

  // Rotate on every listener start; a captured proof from a stopped app cannot
  // be replayed after the real app starts. Fail closed if publication fails.
  try {
    writeStdioConfig(config.url, config.token);
  } catch (error) {
    await stopMcpServer();
    throw error;
  }

  const stdio = stdioCommand();
  info = {
    running: true,
    url: mcpUrl.href,
    stdioCommand: stdio.command,
    stdioArgs: stdio.args,
  };
  return info;
}

export function createDesktopMcpApp(
  config: { url: string; token: string },
  version: string,
): Hono {
  const verifyStdio = createStdioVerifier(config);

  const hono = new Hono();
  hono.use('/mcp', async (c, next) => {
    await next();
    const proof = (c.req.header('authorization') ?? '').replace(
      /^Bearer /i,
      '',
    );
    if (isStdioProof(proof))
      c.res = await signStdioResponse(proof, c.res, config.token);
  });
  hono.route(
    '/',
    createMcpRoutes({
      version,
      enforceScopes: true,
      verifyStaticToken: (token, request) =>
        verifyStaticToken(token, request, verifyStdio),
      autoApprove: process.env.DOMBOT_MCP_AUTOAPPROVE === '1',
    }),
  );

  return hono;
}

/** Stops the server. Requests are stateless, so there's nothing else to tear down. */
export async function stopMcpServer(): Promise<void> {
  if (httpServer) {
    const server = httpServer;
    httpServer = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  info = null;
}
