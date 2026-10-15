import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const storage = vi.hoisted(() => ({ directory: '' }));
vi.mock('electron', () => ({ app: { getPath: () => storage.directory } }));
import { createDesktopMcpApp } from './server';
import { createStdioTransport } from './stdio';
import { createStdioFetch, createStdioVerifier } from './stdio-auth';
import { writeStdioConfig } from './stdio-config';
import { MemoryDocStore } from '../../core/storage/doc-store';
import { configureStore, hydrateStores } from '../../core/storage/namespace';
import { updateSettings } from '../../core/services/settings';

const config = { url: 'http://127.0.0.1:4123/mcp', token: 'b'.repeat(64) };
const message = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2026-07-28',
    capabilities: {},
    clientInfo: { name: 'security-regression', version: '1' },
  },
});
const init = {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  },
  body: message,
};
beforeEach(async () => {
  configureStore(new MemoryDocStore());
  await hydrateStores();
  updateSettings({ mcpEnabled: true });
});
afterEach(() => vi.restoreAllMocks());

it('preserves a real SDK initialize, tools list and legitimate tool call over authenticated local HTTP', async () => {
  let server!: Server;
  const port = await new Promise<number>((resolve) => {
    server = serve(
      {
        fetch: (request) => app.fetch(request),
        port: 0,
        hostname: '127.0.0.1',
      },
      (info) => resolve(info.port),
    ) as Server;
  });
  const current = { ...config, url: `http://127.0.0.1:${port}/mcp` };
  const app = createDesktopMcpApp(current, 'test');
  const client = new Client({ name: 'legitimate-stdio-client', version: '1' });
  try {
    await client.connect(createStdioTransport(current));
    expect(
      (await client.listTools()).tools.some(
        (tool) => tool.name === 'folder_list',
      ),
    ).toBe(true);
    expect(
      await client.callTool({ name: 'folder_list', arguments: {} }),
    ).toMatchObject({ content: [{ type: 'text' }] });
  } finally {
    await client.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('rejects replay, body substitution, stale proofs and proofs from an earlier listener key', async () => {
  const app = createDesktopMcpApp(config, 'test');
  let captured!: Request;
  const send: typeof fetch = async (input, options) => {
    const request = new Request(input, options);
    captured = request.clone();
    return app.fetch(request);
  };
  const response = await createStdioFetch(config, send)(config.url, init);
  expect(response.status).toBe(200);
  expect((await app.fetch(captured.clone())).status).toBe(401);
  const replacement = createDesktopMcpApp(
    { ...config, token: 'c'.repeat(64) },
    'test',
  );
  expect((await replacement.fetch(captured.clone())).status).toBe(401);
  expect(
    (
      await createDesktopMcpApp(config, 'test').fetch(
        new Request(captured, { body: message + ' ' }),
      )
    ).status,
  ).toBe(401);
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 31_000);
  expect(
    (await createDesktopMcpApp(config, 'test').fetch(captured.clone())).status,
  ).toBe(401);
});

it('rejects the raw file key and preserves the disabled-MCP gate', async () => {
  const app = createDesktopMcpApp(config, 'test');
  expect(
    (
      await app.fetch(
        new Request(config.url, {
          ...init,
          headers: { ...init.headers, authorization: `Bearer ${config.token}` },
        }),
      )
    ).status,
  ).toBe(401);
  updateSettings({ mcpEnabled: false });
  const send: typeof fetch = async (input, options) =>
    app.fetch(new Request(input, options));
  expect((await createStdioFetch(config, send)(config.url, init)).status).toBe(
    404,
  );
});

it('rejects an invalid request MAC before reading its body', async () => {
  const request = new Request(config.url, init);
  const clone = vi.spyOn(request, 'clone').mockImplementation(() => {
    throw new Error('Untrusted body must not be read');
  });
  const invalid = `stdio-v1.${Date.now()}.${'1'.repeat(32)}.${'2'.repeat(64)}.${'0'.repeat(64)}`;
  expect(await createStdioVerifier(config)(invalid, request)).toBe(false);
  expect(clone).not.toHaveBeenCalled();
});

it('refuses a tampered authenticated response before delivering it to the SDK', async () => {
  const app = createDesktopMcpApp(config, 'test');
  const send: typeof fetch = async (input, options) => {
    const response = await app.fetch(new Request(input, options));
    return new Response('forged tool output', {
      status: response.status,
      headers: response.headers,
    });
  };
  await expect(
    createStdioFetch(config, send)(config.url, init),
  ).rejects.toThrow('could not authenticate');
});

it('refuses changed destinations before sending credentials or arguments', async () => {
  const send = vi.fn<typeof fetch>();
  const request = createStdioFetch(config, send);
  await expect(request('http://127.0.0.1:4124/mcp', init)).rejects.toThrow(
    'changed its endpoint',
  );
  await expect(
    request(config.url + '?redirect=elsewhere', init),
  ).rejects.toThrow('changed its endpoint');
  expect(send).not.toHaveBeenCalled();
});

it('rotates the listener key and replaces legacy broadly readable config files with mode 0600', () => {
  storage.directory = mkdtempSync(join(tmpdir(), 'dombot-stdio-config-'));
  const file = join(storage.directory, 'mcp-stdio.json');
  try {
    writeFileSync(file, JSON.stringify(config), { mode: 0o644 });
    const first = writeStdioConfig(config.url);
    const second = writeStdioConfig(config.url);
    expect(first.token).not.toBe(config.token);
    expect(second.token).not.toBe(first.token);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(second);
    if (process.platform !== 'win32')
      expect(statSync(file).mode & 0o777).toBe(0o600);
  } finally {
    rmSync(storage.directory, { recursive: true });
  }
});
