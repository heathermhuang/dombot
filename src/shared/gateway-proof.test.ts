import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  signGatewayRequest,
  verifyGatewayRequest,
  PROOF_HEADER,
  MCP_DELEGATION_TOKEN,
  delegatedMcpAuth,
} from './gateway-proof';
const secret = 'synthetic-proof-only-key-'.repeat(3),
  workspace = '11111111-1111-4111-8111-111111111111';
afterEach(() => vi.useRealTimers());
describe('private gateway proof diagnostics', () => {
  it('limits shared MCP delegation to its tenant, request, expiry, and read scope', async () => {
    const request = new Request('https://example.test/mcp', {
      method: 'POST',
      body: '{"method":"tools/list"}',
      headers: { Authorization: `Bearer ${MCP_DELEGATION_TOKEN}` },
    });
    request.headers.set(
      PROOF_HEADER,
      await signGatewayRequest(secret, workspace, null, request, undefined, {
        clientId: '22222222-2222-4222-8222-222222222222',
        scopes: ['portfolio:read'],
        expiresAt: Math.floor(Date.now() / 1000) + 60,
      }),
    );
    const env = {
      DOMBOT_AUTH: 'gateway',
      DOMBOT_GATEWAY_SECRET: secret,
      DOMBOT_WORKSPACE_ID: workspace,
      DOMBOT_PUBLIC_BASE_PATH: '/w/' + workspace,
    };
    expect(await delegatedMcpAuth(request, env)).toMatchObject({
      scopes: ['portfolio:read'],
      resource: new URL('https://example.test/w/' + workspace + '/mcp'),
    });
    expect(
      await delegatedMcpAuth(request, { ...env, DOMBOT_AUTH: 'password' }),
    ).toBeNull();
    expect(
      await delegatedMcpAuth(request, {
        ...env,
        DOMBOT_WORKSPACE_ID: 'another',
      }),
    ).toBeNull();
    const ownerApi = new Request(
      'https://example.test/api/getRegistrarCredentials',
      {
        method: 'POST',
        headers: request.headers,
        body: '{"method":"tools/list"}',
      },
    );
    expect(await verifyGatewayRequest(secret, workspace, ownerApi)).toBeNull();
    const altered = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: '{"method":"tools/call"}',
    });
    expect(await delegatedMcpAuth(altered, env)).toBeNull();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 61000);
    expect(await delegatedMcpAuth(request, env)).toBeNull();
  });
  it('reports a future-issued proof without accepting it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const now = Date.now(),
      request = new Request('https://example.test/publishing/preview');
    vi.setSystemTime(now + 10000);
    request.headers.set(
      PROOF_HEADER,
      await signGatewayRequest(secret, workspace, 'owner', request),
    );
    vi.setSystemTime(now);
    const reasons: string[] = [];
    expect(
      await verifyGatewayRequest(secret, workspace, request, (r) =>
        reasons.push(r),
      ),
    ).toBeNull();
    expect(reasons).toEqual(['issued_in_future']);
  });
  it('accepts a small cross-host clock offset but keeps tenant and request binding', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const now = Date.now(),
      request = new Request('https://example.test/publishing/preview');
    vi.setSystemTime(now + 3000);
    request.headers.set(
      PROOF_HEADER,
      await signGatewayRequest(secret, workspace, 'owner', request),
    );
    vi.setSystemTime(now);
    expect(await verifyGatewayRequest(secret, workspace, request)).toEqual({
      owner: 'owner',
    });
    expect(
      await verifyGatewayRequest(
        secret,
        '22222222-2222-4222-8222-222222222222',
        request,
      ),
    ).toBeNull();
    const changed = new Request('https://example.test/publishing', {
      headers: request.headers,
    });
    expect(await verifyGatewayRequest(secret, workspace, changed)).toBeNull();
    vi.setSystemTime(now + 39000);
    expect(await verifyGatewayRequest(secret, workspace, request)).toBeNull();
  });
  it('keeps expired and wrongly signed requests rejected', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const now = Date.now(),
      request = new Request('https://example.test/publishing/preview');
    request.headers.set(
      PROOF_HEADER,
      await signGatewayRequest(secret, workspace, 'owner', request),
    );
    vi.setSystemTime(now + 60000);
    const reasons: string[] = [];
    expect(
      await verifyGatewayRequest(secret, workspace, request, (r) =>
        reasons.push(r),
      ),
    ).toBeNull();
    expect(reasons).toEqual(['expired']);
    vi.setSystemTime(now);
    expect(
      await verifyGatewayRequest(
        'different-synthetic-key-'.repeat(3),
        workspace,
        request,
      ),
    ).toBeNull();
  });
});
