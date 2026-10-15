import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: {} }));
import { createStdioTransport } from './stdio';

it('never sends the stdio key to a fake local MCP listener or accepts its unsigned reply', async () => {
  const key = 'a'.repeat(64);
  const captured: string[] = [];
  const server = createServer((request, response) => {
    captured.push(request.headers.authorization ?? '');
    request.resume();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  const transport = createStdioTransport({ url, token: key });
  const delivered = vi.fn();
  transport.onmessage = delivered;
  transport.onerror = () => {};
  try {
    await transport.start();
    const outcome = await transport
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2026-07-28',
          capabilities: {},
          clientInfo: { name: 'security-regression', version: '1' },
        },
      })
      .then(
        () => 'accepted',
        () => 'rejected',
      );
    expect(captured).toHaveLength(1);
    expect(captured.join(' ')).not.toContain(key);
    expect(outcome).toBe('rejected');
    expect(delivered).not.toHaveBeenCalled();
  } finally {
    await transport.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
