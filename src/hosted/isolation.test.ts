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
            WORKSPACE_9: 'tenant2',
          },
          bindings: {
            SOURCE_COMMIT: 'a'.repeat(40),
            SALES_CUSTOM_HOSTS_ENABLED: 'true',
            AUTH_PEPPER: 'test-only-authentication-pepper-'.repeat(3),
            WORKSPACES: JSON.stringify(
              ids.map((id, i) => ({
                id,
                binding: i === 2 ? 'WORKSPACE_9' : `WORKSPACE_${i}`,
                label: `Workspace ${i}`,
              })),
            ),
            GATEWAY_KEYS: JSON.stringify(
              Object.fromEntries(ids.slice(0, 2).map((id, i) => [id, keys[i]])),
            ),
            EXTRA_GATEWAY_KEYS: JSON.stringify({ [ids[2]]: keys[2] }),
          },
        },
        ...ids.map((id, i) => ({
          name: `tenant${i}`,
          modules: true,
          script: tenantScript,
          compatibilityDate: '2026-09-09',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: { DB: `tenant-db-${i}` },
          durableObjects: {
            WORKSPACE_COORDINATOR: {
              className: 'WorkspaceCoordinator',
              useSQLite: true,
            },
          },
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
            DOMBOT_OWNER_SITE_V2: 'true',
            DOMBOT_GATEWAY_SECRET: keys[i],
            DOMBOT_WORKSPACE_ID: id,
            DOMBOT_PUBLIC_BASE_PATH: `/w/${id}`,
            DOMBOT_PLATFORM_ALARMS: i === 0 ? 'true' : 'false',
            DOMBOT_SALES_EDGE_SECRET: 'test-only-anonymous-edge-key'.repeat(3),
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
  await control.exec(sql('hosted/migrations/0005_passwordless_passkeys.sql'));
  await control.exec(sql('hosted/migrations/0002_password_recovery.sql'));
  await control.exec(sql('hosted/migrations/0003_lifecycle.sql'));
  await control.exec(sql('hosted/migrations/0007_sales_hostnames.sql'));
  await control.exec(sql('hosted/migrations/0010_shared_mcp.sql'));
  await control.exec(sql('hosted/migrations/0011_passkey_names.sql'));
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

describe('owner site routing and isolation', () => {
  it('caps pricing below the shared quota, provides a cooldown, and reserves owner refresh slots', async () => {
    const db = await mf.getD1Database('CONTROL_DB', 'gateway');
    const bucket = Math.floor(Date.now() / 600_000);
    const providerKey = `${await tokenHash(`provider:${ids[1]}`)}:${bucket}`;
    const pricingKey = `${await tokenHash(`pricing:${ids[1]}`)}:${bucket}`;
    try {
      for (let n = 0; n < 15; n++)
        expect((await api(1, 'stepRenewalPricing')).status).toBe(200);
      for (const method of ['stepRenewalPricing', '%73tepRenewalPricing']) {
        const rejected = await api(1, method);
        expect(rejected.status).toBe(429);
        const seconds = Number(rejected.headers.get('Retry-After'));
        expect(seconds).toBeGreaterThan(0);
        expect(seconds).toBeLessThanOrEqual(600);
      }
      for (let n = 0; n < 5; n++)
        expect((await api(1, 'lookupRegistrations', [[]])).status).toBe(200);
      expect((await api(1, 'lookupRegistrations', [[]])).status).toBe(429);
      // A different portfolio has an independent bounded allowance.
      expect((await api(0, 'stepRenewalPricing')).status).toBe(200);
    } finally {
      await db
        .prepare('DELETE FROM rate_limits WHERE key IN (?1,?2)')
        .bind(providerKey, pricingKey)
        .run();
    }
  }, 30_000);

  it('serves selected collection routes anonymously without opening private editor routes', async () => {
    const { emptyOwnerSite } = await import('../shared/owner-site');
    const site = emptyOwnerSite();
    site.handle = 'sample-owner';
    site.profile.name = 'Sample owner, tenant A';
    site.domainPresentations = [
      {
        id: 'past',
        domain: 'past.example',
        ownership: 'historical',
        availability: 'not-for-sale',
        description: 'Sample data',
        askingPrice: null,
        currency: 'USD',
      },
    ];
    site.collections = [
      {
        id: 'sample',
        slug: 'sample',
        title: 'Sample collection',
        intro: 'Sample .example data',
        domainIds: ['past'],
      },
    ];
    site.homepage.collectionIds = ['sample'];
    const saved = await request(
      `/w/${ids[0]}/publishing/site`,
      'PUT',
      { draft: site, revision: null },
      cookies[0],
    );
    expect(saved.status).toBe(200);
    const { revision } = (await saved.json()) as { revision: string };
    expect(
      (
        await request(
          `/w/${ids[0]}/publishing/publish`,
          'POST',
          { revision },
          cookies[0],
        )
      ).status,
    ).toBe(200);
    const publicPath = `/w/${ids[0]}/p/sample-owner`;
    const publicSite = await request(publicPath);
    expect(publicSite.status).toBe(200);
    expect(await publicSite.text()).toContain(`${publicPath}/c/sample`);
    const collection = await request(`${publicPath}/c/sample`);
    expect(collection.status).toBe(200);
    expect(await collection.text()).toContain('past.example');
    expect((await request(`/w/${ids[1]}/p/sample-owner/c/sample`)).status).toBe(
      404,
    );
    for (const cookie of [undefined, cookies[1]])
      for (const path of ['/publishing/site', '/publishing/preview'])
        expect(
          (await request(`/w/${ids[0]}${path}`, 'GET', undefined, cookie))
            .status,
        ).toBe(cookie ? 403 : 401);
    expect((await request(`${publicPath}/c/sample/edit`)).status).toBe(303);
  });
});

describe('real gateway and isolated Worker instances', () => {
  it('retains legacy first-visit alarms when the sleep policy is off and rejects anonymous edge authority', async () => {
    const response = await api(0, 'getSettings');
    expect(response.status).toBe(200);
    const manifest = JSON.parse(
      readFileSync('hosted/dombot-engine.lock.json', 'utf8'),
    );
    expect(response.headers.get('X-DomBot-Engine')).toBe(manifest.version);
    expect(response.headers.get('X-DomBot-Engine-Source')).toBe(
      manifest.sourceSha256,
    );
    const tenant = await mf.getWorker('tenant0');
    const health = new Request('http://localhost/platform-internal/health');
    health.headers.set(
      'x-dombot-gateway-proof',
      await signGatewayRequest(keys[0], ids[0], null, health),
    );
    const current = (await (await tenant.fetch(health)).json()) as {
      workspace: string;
      alarmAt: number;
    };
    expect(current.workspace).toBe(ids[0]);
    expect(current.alarmAt).toBeGreaterThan(Date.now());
    const edge = new Request(health.url);
    edge.headers.set(
      'x-dombot-gateway-proof',
      await signGatewayRequest(
        'test-only-anonymous-edge-key'.repeat(3),
        ids[0],
        null,
        edge,
        {
          purpose: 'sales-public',
          host: 'example.test',
          listing: null,
          epoch: 0,
        },
      ),
    );
    expect((await tenant.fetch(edge)).status).toBe(403);
    const pause = new Request('http://localhost/platform-internal/pause', {
      method: 'POST',
    });
    pause.headers.set(
      'x-dombot-gateway-proof',
      await signGatewayRequest(keys[0], ids[0], null, pause),
    );
    expect(
      ((await (await tenant.fetch(pause)).json()) as { alarmAt: number | null })
        .alarmAt,
    ).toBeNull();
  });
  it('keeps platform operator endpoints outside public and customer routes', async () => {
    for (const suffix of ['health', 'pause'])
      for (const session of [undefined, cookies[0], cookies[1]])
        expect(
          (
            await request(
              `/w/${ids[0]}/platform-internal/${suffix}`,
              'POST',
              { args: [] },
              session,
            )
          ).status,
        ).toBe(404);
  });
  it('preserves the origin signal for native login forms', async () => {
    const response = await request('/login');
    expect(response.headers.get('Referrer-Policy')).toBe('same-origin');
    expect(await response.text()).toContain('action="/auth/email/request"');
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
    cookies[2] = responses
      .find((response) => response.status === 303)!
      .headers.get('set-cookie')!
      .split(';')[0];
    const control = await mf.getD1Database('CONTROL_DB', 'gateway');
    expect(
      await control
        .prepare('SELECT count(*) as count FROM users WHERE workspace_id=?1')
        .bind(ids[2])
        .first(),
    ).toEqual({ count: 1 });
  });
  it('serves a cold workspace bootstrap burst without stranding queued reads', async () => {
    const methods = [
      'getAppInfo',
      'getRegistrarMetadata',
      'getMcpInfo',
      'hydrateFromCache',
      'getFolders',
      'getSettings',
    ];
    const responses = await Promise.all([
      request(`/w/${ids[2]}/publishing`, 'GET', undefined, cookies[2]),
      ...methods.map((method) => api(2, method)),
    ]);
    expect(responses.map((response) => response.status)).toEqual(
      responses.map(() => 200),
    );
    expect(await responses[1].json()).toMatchObject({
      result: { platform: 'web' },
    });
    expect(await responses[4].json()).toMatchObject({
      result: { portfolio: null },
    });
    expect((await api(2, 'getRegistrarMetadata')).status).toBe(200);
  }, 10_000);

  it('reports the live hosted engine and gateway source without replacing the base app identity', async () => {
    const response = await api(2, 'getAppInfo');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: { version: string; hosted: unknown };
    };
    expect(body.result.version).toBe('1.5.2');
    expect(body.result.hosted).toEqual({
      engineVersion: response.headers.get('X-DomBot-Engine'),
      engineSource: response.headers.get('X-DomBot-Engine-Source'),
      sourceCommit: 'a'.repeat(40),
    });
    expect(response.headers.get('X-DomBot-Engine')).toBeTruthy();
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
  it('preserves the workspace destination and email after a failed sign-in', async () => {
    const next = `/w/${ids[0]}/settings?tab=mcp`;
    const login = (email: string, submitted: string) =>
      gateway.fetch(
        new Request('http://localhost/session/login', {
          method: 'POST',
          headers: {
            Origin: 'http://localhost',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ email, password: submitted, next }),
          redirect: 'manual',
        }),
      );
    const failed = await login(emails[0], 'incorrect-password');
    expect(failed.status).toBe(401);
    const html = await failed.text();
    expect(html).toContain(`name="next" value="${next}"`);
    expect(html).toContain(`value="${emails[0]}"`);
    expect(html).not.toContain('incorrect-password');
    const retried = await login(` ${emails[0].toUpperCase()} `, password);
    expect(retried.status).toBe(303);
    expect(retried.headers.get('location')).toBe(next);
  });
  it('always permits same-origin logout when the sign-in IP allowance is exhausted', async () => {
    const control = await mf.getD1Database('CONTROL_DB', 'gateway');
    const bucket = `${await tokenHash('ip:192.0.2.40')}:${Math.floor(Date.now() / 600_000)}`;
    await control
      .prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES(?1,30,?2)')
      .bind(bucket, Date.now() + 600_000)
      .run();
    const login = await gateway.fetch(
      new Request('http://localhost/session/login', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ email: emails[1], password }),
        redirect: 'manual',
      }),
    );
    expect(login.status).toBe(303);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const logout = (origin: string) =>
      gateway.fetch(
        new Request('http://localhost/session/logout', {
          method: 'POST',
          headers: {
            Origin: origin,
            Cookie: cookie,
            'cf-connecting-ip': '192.0.2.40',
          },
          redirect: 'manual',
        }),
      );
    expect((await logout('https://evil.example')).status).toBe(403);
    expect((await request('/session', 'GET', undefined, cookie)).status).toBe(
      200,
    );
    const response = await logout('http://localhost');
    expect(response.status).toBe(303);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    expect((await request('/session', 'GET', undefined, cookie)).status).toBe(
      401,
    );
    expect((await api(1, 'getFolders')).status).toBe(200);
    await control
      .prepare('DELETE FROM rate_limits WHERE key=?1')
      .bind(bucket)
      .run();
  });
  it('revokes every browser session only for the signed-in owner', async () => {
    const login = () =>
      gateway.fetch(
        new Request('http://localhost/session/login', {
          method: 'POST',
          headers: {
            Origin: 'http://localhost',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ email: emails[2], password }),
          redirect: 'manual',
        }),
      );
    const second = await login();
    expect(second.status).toBe(303);
    const secondCookie = second.headers.get('set-cookie')!.split(';')[0];
    const revoke = (origin: string, cookie?: string) =>
      gateway.fetch(
        new Request('http://localhost/account/sessions/logout', {
          method: 'POST',
          headers: {
            Origin: origin,
            'Content-Type': 'application/x-www-form-urlencoded',
            ...(cookie ? { Cookie: cookie } : {}),
          },
          body: new URLSearchParams({ workspaceId: ids[0], email: emails[0] }),
          redirect: 'manual',
        }),
      );
    expect((await revoke('http://localhost')).status).toBe(401);
    expect((await revoke('https://evil.example', cookies[2])).status).toBe(403);
    expect(
      (await request('/session', 'GET', undefined, secondCookie)).status,
    ).toBe(200);
    const response = await revoke('http://localhost', cookies[2]);
    expect(response.status).toBe(303);
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    for (const cookie of [cookies[2], secondCookie])
      expect((await request('/session', 'GET', undefined, cookie)).status).toBe(
        401,
      );
    expect((await api(0, 'getFolders')).status).toBe(200);
    expect((await api(1, 'getFolders')).status).toBe(200);
    const notice = await request(response.headers.get('location')!);
    expect(await notice.text()).toContain(
      'Every browser session has been signed out',
    );
    const restored = await login();
    expect(restored.status).toBe(303);
    cookies[2] = restored.headers.get('set-cookie')!.split(';')[0];
  });
  it('immediately suspends browser and MCP access without affecting another tenant', async () => {
    const control = await mf.getD1Database('CONTROL_DB', 'gateway');
    const before = await (await api(0, 'getFolders')).json();
    await control
      .prepare('UPDATE workspaces SET enabled=0 WHERE id=?1')
      .bind(ids[0])
      .run();
    try {
      expect(
        (await request('/session', 'GET', undefined, cookies[0])).status,
      ).toBe(401);
      expect((await api(0, 'getFolders')).status).toBe(404);
      expect(
        (
          await api(0, 'createFolder', [
            { name: 'Must not be saved', color: 'teal' },
          ])
        ).status,
      ).toBe(404);
      expect((await request(`/w/${ids[0]}/mcp`)).status).toBe(404);
      expect((await request(`/w/${ids[0]}/p/public`)).status).toBe(404);
      expect((await api(1, 'getFolders')).status).toBe(200);
    } finally {
      await control
        .prepare('UPDATE workspaces SET enabled=1 WHERE id=?1')
        .bind(ids[0])
        .run();
    }
    expect(await (await api(0, 'getFolders')).json()).toEqual(before);
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
  it('gates bulk steps/results and hostname detachment on fresh authentication in the Workers runtime', async () => {
    const control = await mf.getD1Database('CONTROL_DB', 'gateway');
    await control
      .prepare(
        "INSERT INTO sales_hostnames(hostname,workspace_id,listing_id,domain,epoch,status,challenge_hash,plan,updated_at,control_expires_at) VALUES('freshness.example',?,'listing','freshness.example',7,'active','fixture','{}',1,9999999999999)",
      )
      .bind(ids[0])
      .run();
    const before = await control
      .prepare(
        "SELECT * FROM sales_hostnames WHERE hostname='freshness.example'",
      )
      .first();
    const sessionHash = await tokenHash(cookies[0].split('=')[1]);
    await control
      .prepare('UPDATE sessions SET authenticated_at=0 WHERE token_hash=?')
      .bind(sessionHash)
      .run();
    try {
      for (const [name, args] of [
        ['stepBulk', ['absent-job']],
        ['getBulkJob', []],
        ['deleteDomains', [['freshness.example']]],
      ] as const) {
        const r = await api(0, name, [...args]);
        expect(r.status).toBe(428);
        expect(r.headers.get('X-DomBot-Engine')).toBeNull();
      }
      expect(
        await control
          .prepare(
            "SELECT * FROM sales_hostnames WHERE hostname='freshness.example'",
          )
          .first(),
      ).toEqual(before);
    } finally {
      await control
        .prepare('UPDATE sessions SET authenticated_at=? WHERE token_hash=?')
        .bind(Date.now(), sessionHash)
        .run();
    }
    const job = await api(0, 'getBulkJob');
    expect(job.status).toBe(200);
    expect(job.headers.get('X-DomBot-Engine')).not.toBeNull();
    const deleted = await api(0, 'deleteDomains', [['freshness.example']]);
    expect(deleted.status).toBe(200);
    expect(deleted.headers.get('X-DomBot-Engine')).not.toBeNull();
    expect(
      await control
        .prepare(
          "SELECT status,epoch,control_expires_at FROM sales_hostnames WHERE hostname='freshness.example'",
        )
        .first(),
    ).toEqual({ status: 'detached', epoch: 8, control_expires_at: 0 });
    // Hono's strict API route does not dispatch this spelling; the asset
    // fallback rejects its POST. This is not a reproduced export bypass.
    const tenant = await mf.getWorker('tenant0');
    const raw = new Request('http://localhost/api/exportData/', {
      method: 'POST',
      body: '{"args":[]}',
      headers: {
        Origin: 'http://localhost',
        'Content-Type': 'application/json',
      },
    });
    raw.headers.set(
      'x-dombot-gateway-proof',
      await signGatewayRequest(keys[0], ids[0], 'owner', raw),
    );
    expect((await tenant.fetch(raw)).status).toBe(405);
    await control
      .prepare("DELETE FROM sales_hostnames WHERE hostname='freshness.example'")
      .run();
  });
  it('connects two accounts through one MCP URL with isolated, revocable read-only grants', async () => {
    const control = await mf.getD1Database('CONTROL_DB', 'gateway');
    const verifier = 'shared-pkce-'.repeat(6);
    const challenge = Buffer.from(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
    ).toString('base64url');
    const registered = await request('/register', 'POST', {
      client_name: 'Shared test assistant',
      redirect_uris: ['http://127.0.0.1:4567/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
    });
    expect(registered.status).toBe(201);
    const client = (await registered.json()) as {
      client_id: string;
      grant_types: string[];
    };
    expect(client.grant_types).toEqual(['authorization_code']);
    const params = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: 'http://127.0.0.1:4567/callback',
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: 'http://localhost/mcp',
      state: 'client-state',
    });
    expect((await request('/mcp')).status).toBe(401);
    expect(
      await (await request('/.well-known/oauth-protected-resource/mcp')).json(),
    ).toMatchObject({
      resource: 'http://localhost/mcp',
      scopes_supported: ['portfolio:read'],
    });
    const invalidScope = new URLSearchParams(params);
    invalidScope.set('scope', 'domains:write');
    expect((await request('/authorize?' + invalidScope)).status).toBe(400);
    const sharedTokens: string[] = [];
    const mcp = (
      token: string,
      method: string,
      rpcParams?: unknown,
      extra: Record<string, string> = {},
      path = '/mcp',
    ) =>
      gateway.fetch(
        new Request('http://localhost' + path, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            ...extra,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method,
            params: rpcParams,
          }),
        }),
      );
    for (let i = 0; i < 2; i++) {
      await api(i, 'updateSettings', [{ mcpEnabled: true }]);
      await api(i, 'createFolder', [
        { name: 'Shared sentinel ' + i, description: '', color: 'blue' },
      ]);
      const authorization = await request('/authorize?' + params);
      const consentPath = authorization.headers.get('location')!;
      expect((await request(consentPath)).headers.get('location')).toBe(
        '/login?next=' + encodeURIComponent(consentPath),
      );
      const consent = await request(consentPath, 'GET', undefined, cookies[i]);
      const html = await consent.text();
      expect(html).toContain('Shared test assistant');
      const id = html.match(/name="id" value="([a-f0-9]+)"/)![1];
      const csrf = html.match(/name="csrf" value="([a-f0-9]+)"/)![1];
      const form = { id, csrf, decision: 'approve' };
      expect(
        (await request('/oauth/consent', 'POST', form, cookies[1 - i])).status,
      ).toBe(403);
      expect(
        (
          await request(
            '/oauth/consent',
            'POST',
            { ...form, csrf: 'bad' },
            cookies[i],
          )
        ).status,
      ).toBe(403);
      const approved = await request(
        '/oauth/consent',
        'POST',
        form,
        cookies[i],
      );
      expect(approved.status, await approved.clone().text()).toBe(303);
      const callback = new URL(approved.headers.get('location')!);
      expect(callback.searchParams.get('state')).toBe('client-state');
      expect(callback.searchParams.get('iss')).toBe('http://localhost');
      expect(
        (await request('/oauth/consent', 'POST', form, cookies[i])).status,
      ).toBe(403);
      const exchange = {
        grant_type: 'authorization_code',
        client_id: client.client_id,
        code: callback.searchParams.get('code'),
        code_verifier: verifier,
        redirect_uri: 'http://127.0.0.1:4567/callback',
        resource: 'http://localhost/mcp',
      };
      expect(
        (
          await request('/token', 'POST', {
            ...exchange,
            code_verifier: 'wrong'.repeat(12),
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await request('/token', 'POST', {
            ...exchange,
            resource: 'http://localhost/w/' + ids[i] + '/mcp',
          })
        ).status,
      ).toBe(400);
      const issued = await Promise.all([
        request('/token', 'POST', exchange),
        request('/token', 'POST', exchange),
      ]);
      expect(issued.map((r) => r.status).sort()).toEqual([200, 400]);
      const token = (
        (await issued.find((r) => r.status === 200)!.json()) as {
          access_token: string;
        }
      ).access_token;
      sharedTokens.push(token);
      expect(
        await control
          .prepare('SELECT token_hash FROM mcp_grants WHERE token_hash=?')
          .bind(token)
          .first(),
      ).toBeNull();
      const tools = (await (await mcp(token, 'tools/list')).json()) as {
        result: { tools: { name: string }[] };
      };
      expect(tools.result.tools.some((t) => t.name === 'portfolio_query')).toBe(
        true,
      );
      expect(tools.result.tools.some((t) => t.name === 'domain_dns_set')).toBe(
        false,
      );
      const folders = await (
        await mcp(
          token,
          'tools/call',
          { name: 'folder_list', arguments: {} },
          {
            Cookie: cookies[1 - i],
            'x-dombot-workspace': ids[1 - i],
            'x-dombot-gateway-proof': 'forged',
          },
          '/mcp?workspace=' + ids[1 - i],
        )
      ).text();
      expect(folders).toContain('Shared sentinel ' + i);
      expect(folders).not.toContain('Shared sentinel ' + (1 - i));
      const denied = await (
        await mcp(token, 'tools/call', {
          name: 'domain_dns_set',
          arguments: {},
        })
      ).text();
      expect(denied).toMatch(/not found|Unknown tool/i);
      expect(
        (
          await mcp(token, 'tools/call', {
            name: 'domain_renew',
            arguments: {},
          })
        ).status,
      ).toBe(403);
      expect(
        (await mcp(token, 'tools/list', undefined, {}, '/w/' + ids[i] + '/mcp'))
          .status,
      ).toBe(401);
      expect(await (await api(i, 'getMcpInfo')).json()).toMatchObject({
        result: { url: 'http://localhost/mcp' },
      });
    }
    await api(0, 'updateSettings', [{ mcpEnabled: false }]);
    expect((await mcp(sharedTokens[0], 'tools/list')).status).toBe(404);
    await api(0, 'updateSettings', [{ mcpEnabled: true }]);
    const pairs = (await (await api(0, 'listMcpClients')).json()) as {
      result: { clientId: string }[];
    };
    const sharedId = pairs.result.find((r) =>
      r.clientId.startsWith('shared:'),
    )!.clientId;
    await api(1, 'revokeMcpClient', [sharedId]);
    expect((await mcp(sharedTokens[0], 'tools/list')).status).toBe(200);
    await api(0, 'revokeMcpClient', [sharedId]);
    expect((await mcp(sharedTokens[0], 'tools/list')).status).toBe(401);
    expect((await mcp(sharedTokens[1], 'tools/list')).status).toBe(200);
    await control
      .prepare('UPDATE workspaces SET enabled=0 WHERE id=?')
      .bind(ids[1])
      .run();
    expect((await mcp(sharedTokens[1], 'tools/list')).status).toBe(401);
    await control
      .prepare('UPDATE workspaces SET enabled=1 WHERE id=?')
      .bind(ids[1])
      .run();
    await control
      .prepare('UPDATE mcp_grants SET expires_at=1 WHERE token_hash=?')
      .bind(await tokenHash(sharedTokens[1]))
      .run();
    expect((await mcp(sharedTokens[1], 'tools/list')).status).toBe(401);
  }, 30_000);
  it('runs workspace-specific MCP approval and refuses token reuse in another workspace', async () => {
    tokens = [];
    const clientIds: string[] = [];
    const approvalRevision = async (i: number) => {
      const body = (await (await api(i, 'getRevisions')).json()) as {
        result: { approvals: number };
      };
      return body.result.approvals;
    };
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
      clientIds.push(client.client_id);
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
      const beforeAuthorize = await approvalRevision(i);
      expect((await request(root + '/authorize?' + params)).status).toBe(200);
      expect(await approvalRevision(i)).toBeGreaterThan(beforeAuthorize);
      const pending = (await (await api(i, 'listPendingApprovals')).json()) as {
        result: { id: string; scopes: string[] }[];
      };
      expect(pending.result[0].scopes).toEqual(['portfolio:read']);
      await api(i, 'resolveApproval', [pending.result[0].id, true]);
      const status = (await (
        await request(root + '/oauth/status?id=' + pending.result[0].id)
      ).json()) as { redirect: string };
      const beforeExchange = await approvalRevision(i);
      const token = await request(root + '/token', 'POST', {
        grant_type: 'authorization_code',
        client_id: client.client_id,
        code: new URL(status.redirect).searchParams.get('code'),
        code_verifier: verifier,
        redirect_uri: 'http://127.0.0.1:3456/callback',
      });
      expect(token.status, await token.clone().text()).toBe(200);
      expect(await approvalRevision(i)).toBeGreaterThan(beforeExchange);
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
    expect(JSON.stringify(denied)).toMatch(
      /not found|Unknown tool|spending budget is zero/i,
    );
    // Public traffic from another Cloudflare source must not spend the owner's allowance.
    for (let n = 0; n < 600; n++) {
      const unauthorized = await gateway.fetch(
        new Request(`http://localhost/w/${ids[0]}/mcp`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            'cf-connecting-ip': '198.51.100.9',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
        }),
      );
      expect([401, 429]).toContain(unauthorized.status);
    }
    expect((await mcp(0, tokens[0], 'tools/list')).status).toBe(200);
    const beforeRevoke = await approvalRevision(1);
    expect(
      (
        await request(`/w/${ids[1]}/revoke`, 'POST', {
          client_id: clientIds[1],
          token: tokens[1],
        })
      ).status,
    ).toBe(200);
    expect(await approvalRevision(1)).toBeGreaterThan(beforeRevoke);
    expect((await mcp(1, tokens[1], 'tools/list')).status).toBe(401);
  }, 15_000);
  it('consumes operator recovery once, rejects expired/cross-origin proof, and revokes existing sessions', async () => {
    const control = await mf.getD1Database('CONTROL_DB', 'gateway');
    const code = 'c'.repeat(64);
    const form = (password: string, origin = 'http://localhost') =>
      gateway.fetch(
        new Request('http://localhost/recover', {
          method: 'POST',
          headers: {
            Origin: origin,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ code, password, confirm: password }),
          redirect: 'manual',
        }),
      );
    const seed = async (expires: number) =>
      control
        .prepare(
          "INSERT INTO password_resets(token_hash,user_id,expires_at,operator_case) SELECT ?1,id,?2,'controlled-test' FROM users WHERE email=?3 ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at,consumed_at=NULL,consumption_id=NULL",
        )
        .bind(await tokenHash(code), expires, emails[2])
        .run();
    await seed(Date.now() - 1);
    expect((await form('replacement-recovery-password')).status).toBe(400);
    await seed(Date.now() + 900_000);
    const mismatch = await gateway.fetch(
      new Request('http://localhost/recover', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          code,
          password: 'replacement-recovery-password',
          confirm: 'different-password',
        }),
      }),
    );
    expect(mismatch.status).toBe(400);
    const mismatchHtml = await mismatch.text();
    expect(mismatchHtml).toContain(`name="code" value="${code}"`);
    expect(mismatchHtml).toContain('role="alert"');
    expect(mismatchHtml).not.toContain('value="replacement-recovery-password"');
    expect(
      (await form('replacement-recovery-password', 'https://evil.example'))
        .status,
    ).toBe(403);
    expect((await api(2, 'getFolders')).status).toBe(200);
    const responses = await Promise.all([
      form('replacement-recovery-password'),
      form('replacement-recovery-password'),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 400]);
    expect((await form('replacement-recovery-password')).status).toBe(400);
    expect((await api(2, 'getFolders')).status).toBe(401);
    expect((await api(1, 'getFolders')).status).toBe(200);
    const login = async (pass: string) =>
      gateway.fetch(
        new Request('http://localhost/session/login', {
          method: 'POST',
          headers: {
            Origin: 'http://localhost',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ email: emails[2], password: pass }),
          redirect: 'manual',
        }),
      );
    expect((await login(password)).status).toBe(401);
    expect((await login('replacement-recovery-password')).status).toBe(303);
    const recoveryPage = await request('/recover?code=' + code);
    expect(recoveryPage.headers.get('Referrer-Policy')).toBe('same-origin');
  });

  it('requires the current password and revokes all browser sessions on change', async () => {
    const form = (
      path: string,
      body: Record<string, string>,
      cookie?: string,
    ) =>
      gateway.fetch(
        new Request('http://localhost' + path, {
          method: 'POST',
          headers: {
            Origin: 'http://localhost',
            'Content-Type': 'application/x-www-form-urlencoded',
            ...(cookie ? { Cookie: cookie } : {}),
          },
          body: new URLSearchParams(body),
          redirect: 'manual',
        }),
      );
    const second = await form('/session/login', { email: emails[0], password });
    expect(second.status).toBe(303);
    const secondCookie = second.headers.get('set-cookie')!.split(';')[0];
    const next = 'different-long-staging-password';
    expect(
      (
        await form(
          '/account/password',
          { oldPassword: 'wrong-password', newPassword: next },
          cookies[0],
        )
      ).status,
    ).toBe(401);
    expect((await api(0, 'getFolders')).status).toBe(200);
    expect(
      (
        await form(
          '/account/password',
          { oldPassword: password, newPassword: next },
          cookies[0],
        )
      ).status,
    ).toBe(303);
    expect((await api(0, 'getFolders')).status).toBe(401);
    expect((await api(0, 'getFolders', [], secondCookie)).status).toBe(401);
    expect(
      (await form('/session/login', { email: emails[0], password })).status,
    ).toBe(401);
    expect(
      (await form('/session/login', { email: emails[0], password: next }))
        .status,
    ).toBe(303);
  });

  it('accepts bounded public requests without allocating a workspace and closes only a reauthenticated owner', async () => {
    const control = await mf.getD1Database('CONTROL_DB', 'gateway');
    const before = await control
      .prepare('SELECT count(*) AS n FROM workspaces')
      .first();
    const submit = (
      path: string,
      body: Record<string, string>,
      cookie?: string,
      origin = 'http://localhost',
    ) =>
      gateway.fetch(
        new Request('http://localhost' + path, {
          method: 'POST',
          headers: {
            Origin: origin,
            'Content-Type': 'application/x-www-form-urlencoded',
            ...(cookie ? { Cookie: cookie } : {}),
          },
          body: new URLSearchParams(body),
          redirect: 'manual',
        }),
      );
    expect(
      (
        await submit(
          '/signup',
          { email: 'new-domainer@example.test' },
          undefined,
          'https://foreign.test',
        )
      ).status,
    ).toBe(403);
    expect(
      (await submit('/signup', { email: 'new-domainer@example.test' })).status,
    ).toBe(202);
    expect(
      (await control.prepare('SELECT count(*) AS n FROM workspaces').first())
        ?.n,
    ).toBe(before?.n);
    const login = await submit('/session/login', {
      email: emails[2],
      password: 'replacement-recovery-password',
    });
    expect(login.status).toBe(303);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    expect(
      (
        await submit(
          '/account/close',
          { password: 'wrong', confirmation: 'CLOSE MY ACCOUNT' },
          cookie,
        )
      ).status,
    ).toBe(401);
    expect((await api(2, 'getFolders', [], cookie)).status).toBe(200);
    expect(
      (await api(2, 'updateSettings', [{ autoSyncIntervalMinutes: 1 }], cookie))
        .status,
    ).toBe(400);
    expect(
      (
        await api(
          2,
          'updateSettings',
          [{ autoSyncIntervalMinutes: 60, mcpEnabled: true }],
          cookie,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await submit(
          '/account/close',
          {
            password: 'replacement-recovery-password',
            confirmation: 'CLOSE MY ACCOUNT',
          },
          cookie,
        )
      ).status,
    ).toBe(200);
    expect((await api(2, 'getFolders', [], cookie)).status).toBe(404);
    expect((await request('/session', 'GET', undefined, cookie)).status).toBe(
      401,
    );
    expect(
      (await request(`/w/${ids[2]}/.well-known/oauth-protected-resource/mcp`))
        .status,
    ).toBe(404);
    expect((await api(1, 'getFolders')).status).toBe(200);
    const closed = await control
      .prepare(
        'SELECT workspace_id,purge_after,requested_at FROM closure_requests',
      )
      .first();
    expect(closed?.workspace_id).toBe(ids[2]);
    expect(Number(closed?.purge_after) - Number(closed?.requested_at)).toBe(
      30 * 86400_000,
    );
  });

  it('revokes browser sessions immediately on logout', async () => {
    expect(
      (await request(`/w/${ids[1]}/auth/logout`, 'POST', {}, cookies[1]))
        .status,
    ).toBe(200);
    expect((await api(1, 'getFolders')).status).toBe(401);
  });
});
