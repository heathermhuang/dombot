import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions, Request } from 'miniflare';
import { build } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
import { tokenHash } from './crypto';
import { signGatewayRequest, PROOF_HEADER } from '../shared/gateway-proof';
import {
  adminSnapshotSchema,
  summarizeAdmin,
  failureCode,
} from './admin-metrics';
import { aggregateAdmin, isAdmin } from './admin';
import gatewayWorker from './gateway';
import type {
  Domain,
  DomainEvent,
  ImportedDomain,
  RegistrarMeta,
} from '../shared/ipc';

const workspace = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const key = 'test-admin-gateway-key-'.repeat(3);
const tokens = {
  admin: 'a'.repeat(64),
  user: 'b'.repeat(64),
  old: 'c'.repeat(64),
};
let mf: Miniflare, db: D1Database, gateway: Fetcher, tenant: Fetcher;
async function call(
  path: string,
  who: keyof typeof tokens | null = 'admin',
  method = 'GET',
  body?: Record<string, string>,
  origin = 'http://localhost',
) {
  return gateway.fetch(
    new Request('http://localhost' + path, {
      method,
      redirect: 'manual',
      headers: {
        Origin: origin,
        ...(who ? { Cookie: `dd_session=${tokens[who]}` } : {}),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body ? new URLSearchParams(body) : undefined,
    }),
  );
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
          d1Databases: { CONTROL_DB: 'admin-control' },
          serviceBindings: { WORKSPACE_0: 'tenant' },
          bindings: {
            AUTH_PEPPER: 'synthetic-pepper'.repeat(4),
            WORKSPACES: JSON.stringify([
              {
                id: workspace,
                binding: 'WORKSPACE_0',
                label: 'Admin portfolio',
              },
            ]),
            GATEWAY_KEYS: JSON.stringify({ [workspace]: key }),
            ADMIN_USER_IDS: '["admin"]',
          },
        },
        {
          name: 'tenant',
          modules: true,
          script: tenantScript,
          compatibilityDate: '2026-09-09',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: { DB: 'admin-tenant' },
          durableObjects: {
            WORKSPACE_COORDINATOR: {
              className: 'WorkspaceCoordinator',
              useSQLite: true,
            },
          },
          serviceBindings: { ASSETS: () => new Response('assets') },
          bindings: {
            DOMBOT_AUTH: 'gateway',
            DOMBOT_SECRET: btoa('synthetic-test-root-key-32-bytes!!'),
            DOMBOT_GATEWAY_SECRET: key,
            DOMBOT_WORKSPACE_ID: workspace,
            DOMBOT_PUBLIC_BASE_PATH: `/w/${workspace}`,
          },
        },
      ],
    }),
  );
  db = (await mf.getD1Database(
    'CONTROL_DB',
    'gateway',
  )) as unknown as D1Database;
  const sql = (path: string) =>
    readFileSync(path, 'utf8')
      .replace(/^--.*$/gm, '')
      .replace(/\n/g, ' ');
  for (const file of readdirSync('hosted/migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort())
    await db.exec(sql('hosted/migrations/' + file));
  const tdb = await mf.getD1Database('DB', 'tenant');
  await tdb.exec(sql('migrations/0001_docs.sql'));
  await tdb.exec(sql('migrations/0002_publication.sql'));
  await tdb
    .prepare('INSERT INTO docs(ns,key,value,updated_at) VALUES(?,?,?,?)')
    .bind(
      'imported-domains',
      'private-holding.test',
      JSON.stringify({
        addedAt: Date.now(),
        updatedAt: Date.now(),
        registrar: null,
      }),
      Date.now(),
    )
    .run();
  for (const [id, w] of [
    ['admin', workspace],
    ['user', other],
  ]) {
    await db
      .prepare('INSERT INTO workspaces(id,label) VALUES(?,?)')
      .bind(w, id)
      .run();
    await db
      .prepare(
        'INSERT INTO users(id,email,workspace_id,password_hash,created_at) VALUES(?,?,?,?,?)',
      )
      .bind(id, id + '@example.test', w, 'private-password-hash', Date.now())
      .run();
  }
  for (const [name, token] of Object.entries(tokens))
    await db
      .prepare(
        'INSERT INTO sessions(token_hash,user_id,expires_at,authenticated_at,auth_method) VALUES(?,?,?,?,?)',
      )
      .bind(
        await tokenHash(token),
        name === 'user' ? 'user' : 'admin',
        Date.now() + 86400_000,
        name === 'old' ? Date.now() - 600_000 : Date.now(),
        'password',
      )
      .run();
  gateway = await mf.getWorker('gateway');
  tenant = await mf.getWorker('tenant');
}, 60_000);
afterAll(async () => {
  await mf?.dispose();
});

describe('restricted admin with real gateway, coordinator and isolated D1', () => {
  it('denies anonymous and normal-user access and requires fresh authentication', async () => {
    expect((await call('/admin', null)).headers.get('location')).toBe(
      '/login?next=%2Fadmin',
    );
    expect((await call('/admin', 'user')).status).toBe(403);
    expect((await call('/admin/users/admin', 'user')).status).toBe(403);
    expect((await call('/admin', 'old')).headers.get('location')).toBe(
      '/account/reauth?next=%2Fadmin',
    );
  });
  it('fails closed on absent or malformed operator allowlists', () => {
    const user = { id: 'admin', email: '', workspace_id: workspace, label: '' };
    expect(isAdmin({} as HostedEnv, user)).toBe(false);
    expect(isAdmin({ ADMIN_USER_IDS: 'admin' } as HostedEnv, user)).toBe(false);
    expect(isAdmin({ ADMIN_USER_IDS: '["admin",3]' } as HostedEnv, user)).toBe(
      false,
    );
  });
  it('shows unknown counts before observation and does not leak portfolio or credentials', async () => {
    const response = await call('/admin');
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(html).toContain('Unknown');
    expect(html).toContain('2 enabled');
    expect(html).not.toContain('private-holding.test');
    expect(html).not.toContain('private-password-hash');
  });
  it('rejects cross-origin refresh and customer access to the private observation endpoint', async () => {
    expect(
      (
        await call(
          '/admin/refresh',
          'admin',
          'POST',
          {},
          'https://foreign.test',
        )
      ).status,
    ).toBe(403);
    expect(
      (await call(`/w/${workspace}/platform-internal/admin-snapshot`)).status,
    ).toBe(404);
    expect(
      (await tenant.fetch('http://localhost/platform-internal/admin-snapshot'))
        .status,
    ).toBe(403);
    const request = new Request(
      'http://localhost/platform-internal/admin-snapshot',
    );
    request.headers.set(
      PROOF_HEADER,
      await signGatewayRequest(key, workspace, 'admin', request),
    );
    expect((await tenant.fetch(request)).status).toBe(403);
  });
  it('observes imported holdings through the real engine and leaves unavailable users unknown', async () => {
    const response = await call('/admin/refresh', 'admin', 'POST', {});
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain(
      'refreshed=1&unavailable=1',
    );
    const row = await db
      .prepare('SELECT snapshot FROM admin_snapshots WHERE workspace_id=?')
      .bind(workspace)
      .first<{ snapshot: string }>();
    const value = adminSnapshotSchema.parse(JSON.parse(row!.snapshot));
    expect(value.owned).toBe(1);
    expect(value.imported).toBe(1);
    expect(value.accounts).toEqual([]);
    expect(row!.snapshot).not.toContain('private-holding.test');
    const html = await (await call('/admin/users/admin')).text();
    expect(html).toContain('Owned: 1');
    const unknown = await (await call('/admin/users/user')).text();
    expect(unknown).toContain('No observation yet');
    expect(
      await db.prepare('SELECT COUNT(*) n FROM admin_audit').first('n'),
    ).toBeGreaterThan(0);
  });
  it('health probes storage and exposes the bounded scope', async () => {
    const response = await call('/health', null);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      scope: 'gateway-storage',
    });
  });
  it('returns unavailable health when storage fails instead of a fixed OK', async () => {
    const env = {
      CONTROL_DB: {
        prepare() {
          throw Error('storage unavailable');
        },
      },
    } as unknown as HostedEnv;
    const response = await gatewayWorker.fetch(
      new globalThis.Request('http://localhost/health'),
      env,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      ok: false,
      scope: 'gateway-storage',
    });
  });
  it('records sync outcomes after the engine consumes the request, without recursive observation events', async () => {
    const request = new Request('http://localhost/api/listPortfolio', {
      method: 'POST',
      headers: {
        Origin: 'http://localhost',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ args: [true] }),
    });
    request.headers.set(
      PROOF_HEADER,
      await signGatewayRequest(key, workspace, 'admin', request),
    );
    expect((await tenant.fetch(request)).status).toBe(200);
    await call('/admin/refresh', 'admin', 'POST', { q: 'admin' });
    const row = await db
      .prepare('SELECT snapshot FROM admin_snapshots WHERE workspace_id=?')
      .bind(workspace)
      .first<{ snapshot: string }>();
    expect(
      adminSnapshotSchema.parse(JSON.parse(row!.snapshot)).operations,
    ).toMatchObject([{ kind: 'sync', status: 'ok', code: 'none' }]);
    expect(
      await db
        .prepare('SELECT unavailable FROM admin_snapshots WHERE workspace_id=?')
        .bind(other)
        .first('unavailable'),
    ).toBe(1);
  });
  it('escapes user content, supports search and returns 404 for missing users', async () => {
    await db
      .prepare('UPDATE users SET email=? WHERE id=?')
      .bind('<script>alert(1)</script>@test', 'user')
      .run();
    const html = await (await call('/admin?q=script')).text();
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect((await call('/admin/users/missing')).status).toBe(404);
  });
});

describe('admin metric meaning', () => {
  it('deduplicates names within a user, excludes archive and includes only unmatched imports', () => {
    const domains = [
      { domainName: 'one.test', source: 'registrar' },
      { domainName: 'ONE.test', source: 'registrar' },
      { domainName: 'sold.test', source: 'registrar' },
    ] as Domain[];
    const imported = {
      'one.test': { addedAt: 1 },
      'two.test': { addedAt: 1 },
    } as Record<string, ImportedDomain>;
    const events = [
      { id: '1', domain: 'sold.test', type: 'sold' },
    ] as DomainEvent[];
    const s = summarizeAdmin(domains, imported, events, [], 1440, []);
    expect(s).toMatchObject({ owned: 2, imported: 1, archived: 1 });
  });
  it('classifies failures without persisting secret messages and preserves failed, never and disabled states', () => {
    const meta = ['failed', 'never', 'disabled', 'stale'].map((state, n) => ({
      name: 'dynadot',
      configured: true,
      enabled: state !== 'disabled',
      sync: {
        domainCount: n,
        lastSyncedAt: state === 'never' ? null : 1,
        lastError:
          state === 'failed' ? '429 https://secret.test/?key=private' : null,
      },
    })) as RegistrarMeta[];
    const s = summarizeAdmin([], {}, [], meta, 60, [], 200_000_000);
    expect(s.accounts.map((a) => a.state)).toEqual([
      'failed',
      'never',
      'disabled',
      'stale',
    ]);
    expect(JSON.stringify(s)).not.toContain('private');
    expect(failureCode('proxy timed out')).toBe('network');
  });
  it('keeps unknown, stale and disabled users separate from observed totals', () => {
    const s = summarizeAdmin([], {}, [], [], 1440, [], 1);
    const rows = [1, 2, 3].map((n) => ({
      id: String(n),
      email: '',
      workspace_id: '',
      created_at: 0,
      enabled: n === 3 ? 0 : 1,
      snapshot: n === 2 ? null : JSON.stringify({ ...s, owned: 7 }),
      observed_at: 1,
    }));
    expect(aggregateAdmin(rows, 2_000_000)).toMatchObject({
      users: 3,
      observed: 1,
      unknown: 1,
      stale: 1,
      owned: 7,
    });
  });
});

it('restricts retained sync diagnostics to the freshly authenticated sole admin', async () => {
  expect((await call('/admin/sync-monitor', 'user')).status).toBe(403);
  expect((await call('/admin/sync-monitor', 'old')).status).toBe(303);
  expect((await call('/admin/sync-monitor', null)).status).toBe(303);
  const response = await call('/admin/sync-monitor');
  expect(response.status).toBe(200);
  expect(await response.text()).toContain(
    'Successful retries do not erase retained failures',
  );
});

it('shows only a fresh admin the targeted user inventory and audits the read', async () => {
  for (const who of ['user', 'old', null] as const)
    expect((await call('/admin/users/admin/domains', who)).status).toBe(
      who === 'user' ? 403 : 303,
    );
  const response = await call('/admin/users/admin/domains');
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const html = await response.text();
  expect(html).toContain('private-holding.test');
  expect(html).toContain('Known annual renewal subtotal');
  expect(html).toContain('Unknown price');
  expect(html).not.toContain('private-password-hash');
  const audit = await db
    .prepare(
      'SELECT actor_id,target_user_id FROM admin_audit WHERE target_user_id=? ORDER BY created_at DESC LIMIT 1',
    )
    .bind('admin')
    .first();
  expect(audit).toMatchObject({ actor_id: 'admin', target_user_id: 'admin' });
  const values = (
    await db
      .prepare('SELECT snapshot FROM admin_snapshots')
      .all<{ snapshot: string }>()
  ).results;
  expect(JSON.stringify(values)).not.toContain('private-holding.test');
});
it('does not substitute zero when the inventory cannot be reached', async () => {
  const response = await call('/admin/users/user/domains');
  expect(response.status).toBe(503);
  expect(await response.text()).toContain(
    'no domains or prices have been replaced with zero',
  );
});
