import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMcpRoutes } from '../core/mcp/routes';
import { MemoryDocStore } from '../core/storage/doc-store';
import { configureStore, hydrateStores } from '../core/storage/namespace';
import { updateSettings } from '../core/services/settings';
const calls = vi.hoisted(() => ({
  availability: vi.fn<(domains: string[]) => Promise<unknown[]>>(
    async () => [],
  ),
}));
vi.mock('../core/services/registrars', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../core/services/registrars')>();
  return {
    ...actual,
    getRegistrarClient: () => ({ checkAvailability: calls.availability }),
  };
});
const origin = 'https://bounded-mcp.example';
let app: ReturnType<typeof createMcpRoutes>;
beforeEach(async () => {
  configureStore(new MemoryDocStore());
  await hydrateStores();
  updateSettings({ mcpEnabled: true });
  calls.availability.mockClear();
  app = createMcpRoutes({
    version: 'controlled',
    enforceScopes: true,
    verifyStaticToken: (token) => ({
      token,
      clientId: 'controlled',
      scopes: ['portfolio:read'],
      resource: new URL(origin + '/mcp'),
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    }),
  });
});
async function rpc(method: string, params?: unknown) {
  const r = await app.request(origin + '/mcp', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer controlled',
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  expect(r.status).toBe(200);
  return r.json();
}
const domains = (n: number) =>
  Array.from({ length: n }, (_, i) => `controlled-${i}.example`);
describe('availability input bounds before registrar calls', () => {
  it('advertises the batch limit in MCP tool discovery', async () => {
    const listed = await rpc('tools/list');
    const tool = listed.result.tools.find(
      (t: { name: string }) => t.name === 'registrar_check_availability',
    );
    expect(tool.inputSchema.properties.domains.maxItems).toBe(100);
  });
  it('permits exactly 100 names in one bounded provider invocation', async () => {
    const requested = domains(100);
    const r = await rpc('tools/call', {
      name: 'registrar_check_availability',
      arguments: { registrar: 'gandi', domains: requested },
    });
    expect(r.error).toBeUndefined();
    expect(r.result.isError).not.toBe(true);
    expect(calls.availability).toHaveBeenCalledExactlyOnceWith(requested);
  });
  it('rejects 101 names without invoking a provider', async () => {
    const r = await rpc('tools/call', {
      name: 'registrar_check_availability',
      arguments: { registrar: 'gandi', domains: domains(101) },
    });
    expect(r.error?.message ?? r.result?.content?.[0]?.text).toMatch(/100/);
    expect(calls.availability).not.toHaveBeenCalled();
  });
  it('keeps the existing nonempty requirement', async () => {
    const r = await rpc('tools/call', {
      name: 'registrar_check_availability',
      arguments: { registrar: 'gandi', domains: [] },
    });
    expect(r.error ?? r.result?.isError).toBeTruthy();
    expect(calls.availability).not.toHaveBeenCalled();
  });
});
