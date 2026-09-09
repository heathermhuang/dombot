import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions, Request } from 'miniflare';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { tokenHash } from './crypto';
import { signGatewayRequest } from '../shared/gateway-proof';

const ids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
];
const keys = ids.map((_, i) => `staging-only-gateway-key-${i}-`.repeat(3));
const emails = ['one@example.test', 'two@example.test', 'three@example.test'];
const password = 'staging-test-long-password';
let mf: Miniflare;
let gateway: Fetcher;
let cookies: string[] = [];
let tokens: string[] = [];
const api = (
  i: number,
  method: string,
  args: unknown[] = [],
  cookie = cookies[i],
) => request(`/w/${ids[i]}/api/${method}`, 'POST', { args }, cookie);
async function request(
  path: string,
  method = 'GET',
  body?: unknown,
  cookie?: string,
) {
  return gateway.fetch(
    new Request('http://localhost' + path, {
      method,
      headers: {
        Origin: 'http://localhost',
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    }),
  );
}
async function signup(i: number) {
  // The customer-facing flow uses standard HTML forms.
  const result = await gateway.fetch(
    new Request('http://localhost/session/join', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        email: emails[i],
        password,
        code: `invite-${i}`,
      }),
      redirect: 'manual',
    }),
  );
  expect(result.status, await result.clone().text()).toBe(303);
  return result.headers.get('set-cookie')!.split(';')[0];
}

beforeAll(async () => {
  const bundle = async (entry: string) =>
    (
      await build({
        entryPoints: [entry],
        bundle: true,
        write: false,
        platform: 'node',
        format: 'esm',
        external: ['cloudflare:*'],
        logLevel: 'silent',
      })
    ).outputFiles[0].text;
  const [gateScript, tenantScript] = await Promise.all([
    bundle('src/hosted/gateway.ts'),
    bundle('src/hosted/tenant.ts'),
  ]);
  mf = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      workers: [
        {
          name: 'gateway',
          modules: true,
          script: gateScript,
          compatibilityDate: '2026-09-09',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: { CONTROL_DB: 'control' },
          serviceBindings: {
            WORKSPACE_0: 'tenant0',
            WORKSPACE_1: 'tenant1',
            WORKSPACE_2: 'tenant2',
          },
          bindings: {
            AUTH_PEPPER: 'test-only-authentication-pepper-'.repeat(3),
            WORKSPACES: JSON.stringify(
              ids.map((id, i) => ({
                id,
                binding: `WORKSPACE_${i}`,
                label: `Workspace ${i}`,
              })),
            ),
            GATEWAY_KEYS: JSON.stringify(
              Object.fromEntries(ids.map((id, i) => [id, keys[i]])),
            ),
          },
        },
        ...ids.map((id, i) => ({
          name: `tenant${i}`,
          modules: true,
          script: tenantScript,
          compatibilityDate: '2026-09-09',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: { DB: `tenant-db-${i}` },
          serviceBindings: {
            ASSETS: () =>
              new Response('<html><body>Private workspace</body></html>', {
                headers: { 'Content-Type': 'text/html' },
              }),
          },
          bindings: {
            DOMBOT_SECRET: btoa(
              String.fromCharCode(...new Uint8Array(32).fill(i + 1)),
            ),
            DOMBOT_AUTH: 'gateway',
            DOMBOT_GATEWAY_SECRET: keys[i],
            DOMBOT_WORKSPACE_ID: id,
            DOMBOT_PUBLIC_BASE_PATH: `/w/${id}`,
          },
        })),
      ],
    }),
  );
  const control = await mf.getD1Database('CONTROL_DB', 'gateway');
  const sql = (p: string) =>
    readFileSync(p, 'utf8')
      .replace(/^--.*$/gm, '')
      .replace(/\n/g, ' ');
  await control.exec(sql('hosted/migrations/0001_control.sql'));
  for (let i = 0; i < ids.length; i++) {
    const db = await mf.getD1Database('DB', `tenant${i}`);
    await db.exec(sql('migrations/0001_docs.sql'));
    await db.exec(sql('migrations/0002_publication.sql'));
    await control.batch([
      control
        .prepare('INSERT INTO workspaces(id,label) VALUES(?1,?2)')
        .bind(ids[i], `Workspace ${i}`),
      control
        .prepare(
          'INSERT INTO invitations(token_hash,email,workspace_id,expires_at) VALUES(?1,?2,?3,?4)',
        )
        .bind(
          await tokenHash(`invite-${i}`),
          emails[i],
          ids[i],
          Date.now() + 3600_000,
        ),
    ]);
  }
  gateway = await mf.getWorker('gateway');
  cookies = [await signup(0), await signup(1)];
}, 60_000);
afterAll(async () => {
  await mf?.dispose();
});

describe('real gateway and isolated Worker instances', () => {
  it('preserves the origin signal for native login forms', async () => {
    const response = await request('/login');
    expect(response.headers.get('Referrer-Policy')).toBe('same-origin');
    expect(await response.text()).toContain('action="/session/login"');
  });
  it('rejects cross-origin signup and mismatched invitations', async () => {
    const send = (origin: string, email: string) =>
      gateway.fetch(
        new Request('http://localhost/session/join', {
          method: 'POST',
          headers: {
            Origin: origin,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ email, password, code: 'invite-2' }),
        }),
      );
    expect((await send('https://evil.example', emails[2])).status).toBe(403);
    expect((await send('http://localhost', 'wrong@example.test')).status).toBe(
      400,
    );
  });

  it('allocates a reserved workspace only once under concurrent signup', async () => {
    const claim = () =>
      gateway.fetch(
        new Request('http://localhost/session/join', {
          method: 'POST',
          headers: {
            Origin: 'http://localhost',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            email: emails[2],
            password,
            code: 'invite-2',
          }),
          redirect: 'manual',
        }),
      );
    const responses = await Promise.all([claim(), claim()]);
    expect(responses.map((r) => r.status).sort()).toEqual([303, 400]);
    const control = await mf.getD1Database('CONTROL_DB', 'gateway');
    expect(
      await control
        .prepare('SELECT count(*) as count FROM users WHERE workspace_id=?1')
        .bind(ids[2])
        .first(),
    ).toEqual({ count: 1 });
  });
  it('creates distinct workspaces and rejects invitation reuse', async () => {
    for (let i = 0; i < 2; i++) {
      const response = await request('/session', 'GET', undefined, cookies[i]);
      expect(await response.json()).toMatchObject({
        email: emails[i],
        workspaceId: ids[i],
      });
    }
    const response = await gateway.fetch(
      new Request('http://localhost/session/join', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          email: emails[0],
          password,
          code: 'invite-0',
        }),
      }),
    );
    expect(response.status).toBe(400);
  });
  it('persists account data only in its own instance and rejects every foreign private surface', async () => {
    for (let i = 0; i < 2; i++) {
      expect(
        (
          await api(i, 'createFolder', [
            {
              name: `Tenant ${i} secret`,
              description: 'private',
              color: 'teal',
            },
          ])
        ).status,
      ).toBe(200);
      expect(
        JSON.stringify(await (await api(i, 'getFolders')).json()),
      ).toContain(`Tenant ${i} secret`);
      expect(
        JSON.stringify(await (await api(i, 'getFolders')).json()),
      ).not.toContain(`Tenant ${1 - i} secret`);
    }
    for (const name of [
      'hydrateFromCache',
      'exportData',
      'getRegistrarCredentials',
      'getFolders',
      'listPendingApprovals',
      'resolveApproval',
      'importData',
      'applyDomainOp',
    ])
      expect((await api(1, name, [], cookies[0])).status).toBe(403);
    for (const path of ['/publishing', '/publishing/preview'])
      expect(
        (await request(`/w/${ids[1]}${path}`, 'GET', undefined, cookies[0]))
          .status,
      ).toBe(403);
    const db0 = await mf.getD1Database('DB', 'tenant0');
    const db1 = await mf.getD1Database('DB', 'tenant1');
    const value0 = await db0
      .prepare("SELECT value FROM docs WHERE ns='folders'")
      .first<{ value: string }>();
    const value1 = await db1
      .prepare("SELECT value FROM docs WHERE ns='folders'")
      .first<{ value: string }>();
    expect(value0?.value).not.toContain('Tenant 0 secret');
    expect(value0?.value).not.toEqual(value1?.value);
  });
  it('denies direct tenant access and forged cross-tenant gateway proofs', async () => {
    const tenant = await mf.getWorker('tenant1');
    expect(
      (
        await tenant.fetch('http://localhost/api/getFolders', {
          method: 'POST',
          body: '{"args":[]}',
        })
      ).status,
    ).toBe(403);
    const req = new Request('http://localhost/api/getFolders', {
      method: 'POST',
      body: '{"args":[]}',
    });
    req.headers.set(
      'x-dombot-gateway-proof',
      await signGatewayRequest(keys[0], ids[0], 'owner', req),
    );
    expect((await tenant.fetch(req)).status).toBe(403);
    const attack = await request(
      `/w/${ids[1]}/api/getFolders`,
      'POST',
      { args: [] },
      cookies[0],
    );
    expect(attack.status).toBe(403);
  });
  it('runs workspace-specific MCP approval and refuses token reuse in another workspace', async () => {
    tokens = [];
    for (let i = 0; i < 2; i++) {
      expect(
        (await api(i, 'updateSettings', [{ mcpEnabled: true }])).status,
      ).toBe(200);
      const root = `/w/${ids[i]}`;
      const metadata = await (
        await request(root + '/.well-known/oauth-authorization-server')
      ).json();
      expect(metadata).toMatchObject({
        issuer: `http://localhost${root}/`,
        token_endpoint: `http://localhost${root}/token`,
      });
      const registration = await request(root + '/register', 'POST', {
        client_name: 'Isolated test client',
        redirect_uris: ['http://127.0.0.1:3456/callback'],
        token_endpoint_auth_method: 'none',
      });
      const client = (await registration.json()) as { client_id: string };
      const verifier = 'a'.repeat(64);
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(verifier),
      );
      const challenge = Buffer.from(digest).toString('base64url');
      const params = new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: 'http://127.0.0.1:3456/callback',
        response_type: 'code',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        scope: 'portfolio:read',
        resource: `http://localhost${root}/mcp`,
      });
      expect((await request(root + '/authorize?' + params)).status).toBe(200);
      const pending = (await (await api(i, 'listPendingApprovals')).json()) as {
        result: { id: string; scopes: string[] }[];
      };
      expect(pending.result[0].scopes).toEqual(['portfolio:read']);
      await api(i, 'resolveApproval', [pending.result[0].id, true]);
      const status = (await (
        await request(root + '/oauth/status?id=' + pending.result[0].id)
      ).json()) as { redirect: string };
      const token = await request(root + '/token', 'POST', {
        grant_type: 'authorization_code',
        client_id: client.client_id,
        code: new URL(status.redirect).searchParams.get('code'),
        code_verifier: verifier,
        redirect_uri: 'http://127.0.0.1:3456/callback',
      });
      expect(token.status, await token.clone().text()).toBe(200);
      tokens.push(
        ((await token.json()) as { access_token: string }).access_token,
      );
    }
    const mcp = (i: number, token: string, method: string, params?: unknown) =>
      gateway.fetch(
        new Request(`http://localhost/w/${ids[i]}/mcp`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        }),
      );
    expect((await mcp(1, tokens[0], 'tools/list')).status).toBe(401);
    const tools = (await (await mcp(0, tokens[0], 'tools/list')).json()) as {
      result: { tools: { name: string }[] };
    };
    expect(tools.result.tools.some((t) => t.name === 'portfolio_query')).toBe(
      true,
    );
    for (const name of [
      'domain_renew',
      'domain_auth_code_get',
      'domain_dns_set',
    ])
      expect(tools.result.tools.some((t) => t.name === name)).toBe(false);
    const denied = await (
      await mcp(0, tokens[0], 'tools/call', {
        name: 'domain_renew',
        arguments: { domain: 'sentinel.example', years: 1 },
      })
    ).json();
    expect(JSON.stringify(denied)).toMatch(/not found|Unknown tool/i);
  });
  it('revokes browser sessions immediately on logout', async () => {
    expect(
      (await request(`/w/${ids[1]}/auth/logout`, 'POST', {}, cookies[1]))
        .status,
    ).toBe(200);
    expect((await api(1, 'getFolders')).status).toBe(401);
  });
});
