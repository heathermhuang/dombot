import { expect, it } from 'vitest';
import { landerRequest } from './lander-connections';
import { verifyGatewayRequest } from '../shared/gateway-proof';
const workspace = '11111111-1111-4111-8111-111111111111',
  requestId = '22222222-2222-4222-8222-222222222222',
  secret = 'fixture-key'.repeat(4);
const setup = () => ({
  workspace,
  requestId,
  domain: 'fixture.example',
  accountId: 'dynadot',
  expiresAt: Date.now() + 3600000,
});
function fixture(s = setup()) {
  const calls: Request[] = [];
  const env = {
    CANONICAL_ORIGIN: 'https://accounts.example',
    WORKSPACES: JSON.stringify([
      { id: workspace, binding: 'WORKSPACE_0', label: 'Fixture' },
    ]),
    GATEWAY_KEYS: JSON.stringify({ [workspace]: secret }),
    DYNDNS_SETUP_FIXTURE: JSON.stringify(s),
    WORKSPACE_0: {
      fetch: async (r: Request) => {
        calls.push(r);
        const proof = await verifyGatewayRequest(secret, workspace, r);
        expect(proof?.sales?.purpose).toBe('sales-connections');
        if (r.method === 'GET')
          return Response.json({
            domain: s.domain,
            scope: s,
            requestId: s.requestId,
            reconciliation: false,
          });
        const body = await r.json();
        expect(body).toEqual({ requestId, unused: true, expectedScope: s });
        return Response.json({
          domain: s.domain,
          state: 'configured',
          nameservers: ['ns1.dyna-ns.net', 'ns2.dyna-ns.net'],
          receipt: 'dns-setup:' + requestId,
        });
      },
    },
  } as unknown as HostedEnv;
  return { env, calls, s };
}
const path = '/sales/lander/dns-setup';
it('keeps the one-domain setup page unavailable without its exact host scope', async () => {
  const { env, calls } = fixture();
  env.DYNDNS_SETUP_FIXTURE = undefined;
  const r = await landerRequest(
    env,
    workspace,
    'owner@example.invalid',
    path,
    new Request('https://accounts.example' + path),
  );
  expect(r.status).toBe(404);
  expect(calls).toHaveLength(0);
});
it('renders the fixed approved domain and confirmation without client-chosen DNS fields', async () => {
  const { env, calls } = fixture();
  const r = await landerRequest(
    env,
    workspace,
    'owner@example.invalid',
    path,
    new Request('https://accounts.example' + path),
  );
  const html = await r.text();
  expect(r.headers.get('Cache-Control')).toBe('no-store');
  expect(html).toContain('Move fixture.example to Dynadot DNS');
  expect(html).toContain('name="unused" required');
  expect(html).not.toContain(secret);
  expect(calls).toHaveLength(1);
});
it('forwards only the exact server scope and request id through purpose-bound admission', async () => {
  const { env, calls } = fixture();
  const form = new FormData();
  form.set('requestId', requestId);
  form.set('unused', 'on');
  form.set('domain', 'not-authorized.example');
  form.set('accountId', 'foreign');
  const r = await landerRequest(
    env,
    workspace,
    'owner@example.invalid',
    path,
    new Request('https://accounts.example' + path, {
      method: 'POST',
      body: form,
    }),
  );
  expect(r.status).toBe(200);
  const html = await r.text();
  expect(html).toContain(
    'DNS propagation, lander HTTPS and restoration checks still need to finish',
  );
  expect(html).not.toContain('not-authorized.example');
  expect(calls).toHaveLength(1);
});
it.each(['wrong-id', 'not-confirmed'])(
  'refuses %s before forwarding a mutation',
  async (mode) => {
    const { env, calls } = fixture();
    const form = new FormData();
    form.set(
      'requestId',
      mode === 'wrong-id' ? '33333333-3333-4333-8333-333333333333' : requestId,
    );
    if (mode !== 'not-confirmed') form.set('unused', 'on');
    await expect(
      landerRequest(
        env,
        workspace,
        'owner@example.invalid',
        path,
        new Request('https://accounts.example' + path, {
          method: 'POST',
          body: form,
        }),
      ),
    ).resolves.toMatchObject({ status: 409 });
    expect(calls).toHaveLength(0);
  },
);
it('refuses mismatched gateway and portfolio setup scopes', async () => {
  const { env } = fixture();
  env.WORKSPACE_0 = {
    fetch: async () =>
      Response.json({
        domain: 'fixture.example',
        scope: { ...setup(), accountId: 'foreign' },
        requestId,
        reconciliation: false,
      }),
  } as Fetcher;
  await expect(
    landerRequest(
      env,
      workspace,
      'owner@example.invalid',
      path,
      new Request('https://accounts.example' + path),
    ),
  ).resolves.toMatchObject({ status: 409 });
});

it('shows a recoverable HTML page for failed setup without leaking private worker errors', async () => {
  const { env } = fixture();
  env.WORKSPACE_0 = {
    fetch: async () =>
      new Response('private provider diagnostic', { status: 500 }),
  } as Fetcher;
  const form = new FormData();
  form.set('requestId', requestId);
  form.set('unused', 'on');
  const r = await landerRequest(
    env,
    workspace,
    'owner@example.invalid',
    path,
    new Request('https://accounts.example' + path, {
      method: 'POST',
      body: form,
    }),
  );
  expect(r.status).toBe(409);
  expect(r.headers.get('Content-Type')).toContain('text/html');
  expect(r.headers.get('Cache-Control')).toBe('no-store');
  const html = await r.text();
  expect(html).toContain('Check setup status');
  expect(html).not.toContain('private provider diagnostic');
});

it('keeps failed setup page reads recoverable without a raw admission exception', async () => {
  const { env } = fixture();
  env.WORKSPACE_0 = {
    fetch: async () => new Response('private failure', { status: 500 }),
  } as Fetcher;
  const r = await landerRequest(
    env,
    workspace,
    'owner@example.invalid',
    path,
    new Request('https://accounts.example' + path),
  );
  expect(r.status).toBe(409);
  expect(await r.text()).toContain('Back to portfolio');
});
