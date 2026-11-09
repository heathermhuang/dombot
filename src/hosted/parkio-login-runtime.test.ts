import { signGatewayRequest, PROOF_HEADER } from '../shared/gateway-proof';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import {
  Miniflare,
  convertV4MiniflareOptions,
  Request as MfRequest,
} from 'miniflare';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
const owner = '11111111-1111-4111-8111-111111111111',
  workspace = '22222222-2222-4222-8222-222222222222',
  other = '33333333-3333-4333-8333-333333333333',
  third = '44444444-4444-4444-8444-444444444444';
let mf: Miniflare;
const cases = [
  'basic',
  'budget',
  'scope',
  'completed',
  'integration',
  'integration-owner',
  'unknown-close',
  'revoked',
  'rotating',
  'fractional-expiry',
];
const csv =
  'Order ID,Domain,Created Date,Paid Date,Amount (USD),Expiration Date,On park.io\n12,alpha.test,2025-01-01,2025-01-02,100,2028-02-29,Yes\n13,beta.test,2025-01-01,2025-01-02,100,2029-01-01,Yes\n';
const reads = new Map<string, number>();
beforeAll(async () => {
  const result = await build({
    entryPoints: ['src/hosted/test-fixtures/parkio-connector.ts'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    external: ['cloudflare:*'],
    logLevel: 'silent',
  });
  mf = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      workers: cases.map((name) => ({
        name,
        modules: true,
        script: result.outputFiles[0].text,
        compatibilityDate: '2026-09-09',
        compatibilityFlags: ['nodejs_compat'],
        durableObjects: {
          PARKIO_LOGIN: { className: 'TestParkioLogin', useSQLite: true },
          PARKIO_PILOT: { className: 'TestOwnerPilot', useSQLite: true },
        },
        d1Databases: { CONTROL_DB: name + '-control', DB: name + '-tenant' },
        serviceBindings: {
          PARKIO_BROWSER: () => new Response('unused'),
          WORKSPACE_0: name,
        },
        bindings: {
          PARKIO_LOGIN_SECRET: 'test-only-root-'.repeat(4),
          TEST_MODE:
            name === 'unknown-close'
              ? 'close-fails'
              : name === 'fractional-expiry'
                ? 'fractional-expiry'
                : 'scheduled',
          PARKIO_CONNECTOR_ENABLED: 'true',
          PARKIO_CONNECTOR_WORKSPACES: JSON.stringify([workspace]),
          AUTH_PEPPER: 'test-auth-pepper-'.repeat(4),
          WORKSPACES: JSON.stringify([
            { id: workspace, binding: 'WORKSPACE_0', label: 'Test' },
          ]),
          GATEWAY_KEYS: JSON.stringify({ [workspace]: 'a'.repeat(64) }),
          DOMBOT_AUTH: 'gateway',
          DOMBOT_GATEWAY_SECRET: 'a'.repeat(64),
          DOMBOT_WORKSPACE_ID: workspace,
          DOMBOT_PARKIO_ENABLED: 'true',
          DOMBOT_SECRET: Buffer.from(new Uint8Array(32).fill(1)).toString(
            'base64',
          ),
          PARKIO_PILOT_ENABLED: 'true',
          PARKIO_PILOT_OWNER_ID: owner,
          PARKIO_PILOT_SECRET: 'test-pilot-root-'.repeat(4),
          PARKIO_PILOT_EXPIRES_AT: new Date(
            Date.now() + 86400000,
          ).toISOString(),
        },
        outboundService: async (request) => {
          reads.set(name, (reads.get(name) ?? 0) + 1);
          return new Response(
            new URL(request.url).pathname === '/orders/index'
              ? '<!doctype html><html><a href="/users/edit/123">Account</a></html>'
              : csv,
            {
              headers: {
                ...(name === 'rotating'
                  ? {
                      'Set-Cookie':
                        'parkio_user_signin=rotated-in-producer; Path=/; Secure; HttpOnly',
                    }
                  : {}),
                'Content-Type':
                  new URL(request.url).pathname === '/orders/index'
                    ? 'text/html'
                    : 'text/csv',
              },
            },
          );
        },
      })),
    }),
  );
  for (const name of cases) {
    await (
      await mf.getD1Database('CONTROL_DB', name)
    ).exec(
      'CREATE TABLE parkio_login_slots(scope TEXT PRIMARY KEY, acquired_at INTEGER NOT NULL)',
    );
    await (
      await mf.getD1Database('CONTROL_DB', name)
    ).exec(
      'CREATE TABLE rate_limits(key TEXT PRIMARY KEY,count INTEGER,expires_at INTEGER)',
    );
    const control = await mf.getD1Database('CONTROL_DB', name);
    await control.exec(
      'CREATE TABLE workspaces(id TEXT PRIMARY KEY,enabled INTEGER)',
    );
    await control
      .prepare('INSERT INTO workspaces VALUES(?,1)')
      .bind(workspace)
      .run();
    await control.exec(
      'CREATE TABLE users(id TEXT PRIMARY KEY,workspace_id TEXT)',
    );
    await control.exec(
      'CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT,expires_at INTEGER)',
    );
    await control
      .prepare('INSERT INTO users VALUES(?,?)')
      .bind(owner, workspace)
      .run();
    await control
      .prepare('INSERT INTO sessions VALUES(?,?,?)')
      .bind('a'.repeat(64), owner, Date.now() + 86400000)
      .run();
    for (const [id, hash] of [
      [other, 'c'.repeat(64)],
      [third, 'd'.repeat(64)],
    ]) {
      await control
        .prepare('INSERT INTO users VALUES(?,?)')
        .bind(id, workspace)
        .run();
      await control
        .prepare('INSERT INTO sessions VALUES(?,?,?)')
        .bind(hash, id, Date.now() + 86400000)
        .run();
    }
    const gatewayHash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode('fixture-session'),
        ),
      ),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('');
    await control
      .prepare('INSERT INTO sessions VALUES(?,?,?)')
      .bind(gatewayHash, owner, Date.now() + 86400000)
      .run();
    const db = await mf.getD1Database('DB', name);
    await db.exec(
      'CREATE TABLE docs(ns TEXT,key TEXT,value TEXT,PRIMARY KEY(ns,key))',
    );
    const sql = await fs.readFile('migrations/0010_parkio.sql', 'utf8');
    await db.batch(
      sql
        .replace(/^--.*$/gm, '')
        .split(';')
        .filter((v) => v.trim())
        .map((v) => db.prepare(v)),
    );
  }
}, 30000);
afterAll(async () => {
  await mf?.dispose();
});
async function call(
  name: string,
  action: string,
  {
    user = owner,
    target = owner,
    session,
    intent,
    body = {},
  }: {
    user?: string;
    target?: string;
    session?: string;
    intent?: string;
    body?: unknown;
  } = {},
) {
  const ns = await mf.getDurableObjectNamespace('PARKIO_LOGIN', name);
  return ns
    .get(ns.idFromName(workspace + '/' + target))
    .fetch('https://parkio-login.internal/' + action, {
      method: 'POST',
      headers: {
        'X-Parkio-Owner': user,
        'X-Parkio-Workspace': workspace,
        'X-Parkio-Session':
          session ??
          (user === owner
            ? 'a'.repeat(64)
            : user === other
              ? 'c'.repeat(64)
              : 'd'.repeat(64)),
        ...(intent ? { 'X-Parkio-Intent': intent } : {}),
      },
      body: JSON.stringify(body),
    });
}
const start = (name: string, key = crypto.randomUUID(), user = owner) =>
  call(name, 'start', {
    user,
    target: user,
    body: { sourceId: key, intentKey: key, expectedEpoch: null },
  }).then(async (r) => ({ status: r.status, data: await r.json() }));
describe('temporary Park.io login broker', () => {
  it('reuses the same attempt and does not acquire a second browser on a lost response retry', async () => {
    const key = crypto.randomUUID();
    const a = await start('basic', key),
      b = await start('basic', key);
    expect(a.status).toBe(200);
    expect(b.data.attemptId).toBe(a.data.attemptId);
    expect(
      (await (await call('basic', 'fixture-metrics', { intent: key })).json())
        .acquisitions,
    ).toBe(1);
  });
  it('caps browser resources globally and releases a slot only after verified closure', async () => {
    const a = await start('budget'),
      b = await start('budget', crypto.randomUUID(), other);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect((await start('budget', crypto.randomUUID(), third)).data.error).toBe(
      'browser_capacity',
    );
    await call('budget', 'cancel', { intent: a.data.intentId });
    expect((await start('budget', crypto.randomUUID(), third)).status).toBe(
      200,
    );
  });
  it('rejects another owner, another session and a replaced intent before issuing view access', async () => {
    const first = await start('scope');
    expect(
      (
        await (
          await call('scope', 'mobile', {
            intent: first.data.intentId,
            user: other,
          })
        ).json()
      ).error,
    ).toBe('scope_mismatch');
    expect(
      (
        await (
          await call('scope', 'mobile', {
            intent: first.data.intentId,
            session: 'b'.repeat(64),
          })
        ).json()
      ).error,
    ).toBe('session_changed');
    const second = await start('scope');
    expect(second.status).toBe(200);
    expect(
      (
        await (
          await call('scope', 'mobile', { intent: first.data.intentId })
        ).json()
      ).error,
    ).toBe('connection_replaced');
  });
  it('keeps a portable candidate server-only, clears it after transfer and resumes from a durable completion receipt', async () => {
    const started = await start('completed'),
      intent = started.data.intentId;
    const completed = await call('completed', 'complete', { intent });
    expect(completed.status).toBe(200);
    expect((await completed.json()).phase).toBe('passed');
    const candidate = await (
      await call('completed', 'candidate', { intent })
    ).json();
    expect(candidate.credential).toMatchObject({
      accountId: '123',
      accountPath: '/orders/index',
      exportPath: '/orders/export/active/123.csv',
    });
    expect(candidate.credential.cookies[0].name).toBe('parkio_user_signin');
    expect(reads.get('completed')).toBe(1);
    await call('completed', 'transferred', { intent });
    expect(
      await (await call('completed', 'status', { intent })).json(),
    ).toMatchObject({ phase: 'connected', browserClosed: true });
    expect(
      (await (await call('completed', 'candidate', { intent })).json()).error,
    ).toBe('proof_not_ready');
    const db = await mf.getD1Database('CONTROL_DB', 'completed');
    expect(
      (
        await db
          .prepare('SELECT COUNT(*) AS n FROM parkio_login_slots')
          .first<{ n: number }>()
      )?.n,
    ).toBe(0);
  });
});

async function gateway(
  name: string,
  path: string,
  body?: unknown,
  intent?: string,
  origin = 'http://localhost',
) {
  const worker = await mf.getWorker(name);
  return worker.fetch(
    new MfRequest('http://localhost/connectors/parkio' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'X-Test-User': owner,
        'X-Test-Workspace': workspace,
        'X-Test-Session': 'fixture-session',
        Origin: origin,
        Accept: 'application/json',
        ...(intent ? { 'X-Parkio-Intent': intent } : {}),
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}
async function tenantState(name: string) {
  const worker = await mf.getWorker(name);
  const request = new Request('https://tenant.test/connectors/parkio');
  request.headers.set(
    PROOF_HEADER,
    await signGatewayRequest('a'.repeat(64), workspace, owner, request),
  );
  return worker.fetch(request.url, {
    headers: Object.fromEntries(request.headers),
  });
}
describe('Park.io gateway-to-private-tenant handoff', () => {
  it('requires same-origin consent and starts no browser on opening the connection page', async () => {
    const response = await gateway('integration', '');
    expect(response.status, await response.clone().text()).toBe(200);
    expect(
      (
        await gateway(
          'integration',
          '/start',
          { intentKey: crypto.randomUUID() },
          undefined,
          'http://127.0.0.1',
        )
      ).status,
    ).toBe(403);
    const db = await mf.getD1Database('CONTROL_DB', 'integration');
    expect(
      (
        await db
          .prepare('SELECT COUNT(*) AS n FROM parkio_login_slots')
          .first<{ n: number }>()
      )?.n,
    ).toBe(0);
  });
  it('imports once, resumes after the temporary credential is cleared, and never returns cookies to the browser', async () => {
    const key = crypto.randomUUID();
    const begun = await gateway('integration', '/start', { intentKey: key });
    expect(begun.status, await begun.clone().text()).toBe(200);
    expect((await begun.json()).url).toBe(
      '/connectors/parkio/native?intent=' + key,
    );
    const native = await gateway('integration', '/native?intent=' + key);
    expect(native.headers.get('Content-Security-Policy')).toContain(
      'wss://live.browser.run',
    );
    expect(
      (await gateway('integration', '/native-complete', {}, key)).status,
    ).toBe(200);
    const active = await gateway('integration', '/native-activate', {}, key);
    expect(active.status, await active.clone().text()).toBe(200);
    const saved = await active.json();
    expect(saved).toMatchObject({
      connected: true,
      source: { id: key, count: 2, connection: 'connected' },
    });
    expect(JSON.stringify(saved)).not.toContain('synthetic-private-cookie');
    const before = reads.get('integration');
    expect(
      (await gateway('integration', '/native-activate', {}, key)).status,
    ).toBe(200);
    expect(reads.get('integration')).toBe(before);
    expect(
      await (await gateway('integration', '/status', undefined, key)).json(),
    ).toMatchObject({ phase: 'connected' });
    const view = await (await tenantState('integration')).json();
    expect(view.sources.length).toBe(1);
    expect(JSON.stringify(view)).not.toContain('cookies');
    expect(JSON.stringify(view)).not.toContain('accountId');
  });
  it('promotes the owner proof with explicit retention consent without opening another browser', async () => {
    const ns = await mf.getDurableObjectNamespace(
      'PARKIO_PILOT',
      'integration-owner',
    );
    const actor = ns.get(ns.idFromName('owner/' + owner));
    const legacy = (action: string) =>
      actor.fetch('https://parkio-pilot.internal/' + action, {
        method: 'POST',
        headers: { 'X-Pilot-Owner': owner },
      });
    const created = await (await legacy('start')).json();
    expect((await legacy('complete')).status).toBe(200);
    const target = await (await legacy('qualifyTenant')).json();
    expect(target).toMatchObject({
      passed: true,
      accountIdentityMatch: true,
      count: 2,
      baselineMatch: true,
    });
    const db = await mf.getD1Database('DB', 'integration-owner');
    expect(
      (
        await db
          .prepare('SELECT COUNT(*) AS n FROM parkio_sources')
          .first<{ n: number }>()
      )?.n,
    ).toBe(0);
    const readsBefore = reads.get('integration-owner');
    await legacy('qualifyTenant');
    expect(reads.get('integration-owner')).toBe(readsBefore);
    expect(
      (await gateway('integration-owner', '/owner-session', {})).status,
    ).toBe(409);
    const saved = await (
      await gateway('integration-owner', '/owner-session', {
        consent: 'save_parkio_session_30_days',
      })
    ).json();
    expect(saved).toMatchObject({
      connected: true,
      source: { id: created.attemptId, count: 2 },
    });
    expect(saved.source.nextAttemptAt).toBeLessThan(Date.now() + 120000);
    const count = reads.get('integration-owner');
    expect(
      (
        await gateway('integration-owner', '/owner-session', {
          consent: 'save_parkio_session_30_days',
        })
      ).status,
    ).toBe(200);
    expect(reads.get('integration-owner')).toBe(count);
    expect((await (await legacy('status')).json()).phase).toBe('cancelled');
    expect(
      (await (await call('integration-owner', 'fixture-metrics')).json())
        .acquisitions,
    ).toBe(0);
  });
  it('keeps the browser slot on an unconfirmed close', async () => {
    const a = await start('unknown-close');
    const state = await (
      await call('unknown-close', 'cancel', { intent: a.data.intentId })
    ).json();
    expect(state.browserClosed).toBe(false);
    expect(state.phase).toBe('cleanup_required');
    await start('unknown-close', crypto.randomUUID(), other);
    expect(
      (await start('unknown-close', crypto.randomUUID(), third)).data.error,
    ).toBe('browser_capacity');
  });
});

describe('sign-in revocation recovery', () => {
  it('closes a temporary browser and blocks candidate access when the consenting session is revoked', async () => {
    const opened = await start('revoked');
    const intent = opened.data.intentId;
    const db = await mf.getD1Database('CONTROL_DB', 'revoked');
    await db
      .prepare('DELETE FROM sessions WHERE token_hash=?')
      .bind('a'.repeat(64))
      .run();
    await call('revoked', 'fixture-alarm', { intent });
    const state = await (await call('revoked', 'status', { intent })).json();
    expect(state.phase).toBe('cancelled');
    expect(state.browserClosed).toBe(true);
    expect(
      (
        await db
          .prepare('SELECT COUNT(*) AS n FROM parkio_login_slots')
          .first<{ n: number }>()
      )?.n,
    ).toBe(0);
    expect(
      (await (await call('revoked', 'candidate', { intent })).json()).error,
    ).toBe('proof_not_ready');
  });
});

describe('qualified connection-cookie rotation', () => {
  it('preserves an allowed rotated session during the first portable read', async () => {
    const begun = await start('rotating'),
      intent = begun.data.intentId;
    const response = await call('rotating', 'complete', { intent });
    expect(response.status).toBe(200);
    const state = await response.json();
    expect(state.phase).toBe('passed');
    expect(state.result.cookieRotationObserved).toBe(true);
    const captured = await (
      await call('rotating', 'candidate', { intent })
    ).json();
    expect(captured.credential.cookies[0].value).toBe('rotated-in-producer');
  });
});

describe('native cookie expiration precision', () => {
  it('preserves a fractional CDP expiry without rejecting the portable candidate', async () => {
    const opened = await start('fractional-expiry'),
      intent = opened.data.intentId;
    expect(
      (await call('fractional-expiry', 'complete', { intent })).status,
    ).toBe(200);
    const response = await call('fractional-expiry', 'candidate', { intent });
    expect(response.status).toBe(200);
    const c = (await response.json()).credential;
    expect(Number.isInteger(c.expiresAt)).toBe(true);
    expect(c.expiresAt).toBeLessThanOrEqual(c.cookies[0].expires * 1000);
    expect(c.expiresAt).toBeGreaterThan(Date.now());
  });
});
