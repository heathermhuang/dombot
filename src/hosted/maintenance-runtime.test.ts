import { afterAll, beforeAll, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions, Request } from 'miniflare';
import { build } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
import { signGatewayRequest } from '../shared/gateway-proof';
const id = '11111111-1111-4111-8111-111111111111';
const key = 'test-only-maintenance-gateway-key'.repeat(3);
let mf: Miniflare, tenant: Fetcher, db: D1Database;
async function signed(
  path: string,
  method = 'GET',
  args?: unknown[],
  owner: string | null = 'test-owner',
) {
  const request = new Request('http://localhost' + path, {
    method,
    headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' },
    body: args ? JSON.stringify({ args }) : undefined,
  });
  request.headers.set(
    'x-dombot-gateway-proof',
    await signGatewayRequest(key, id, owner, request),
  );
  const response = await tenant.fetch(request);
  return response;
}
async function health() {
  const r = await signed('/platform-internal/health', 'GET', undefined, null);
  expect(r.status).toBe(200);
  return r.json() as Promise<{
    alarmAt: number | null;
    maintenance: { inspection: { state: string }; paused: boolean };
  }>;
}
beforeAll(async () => {
  const script = (
    await build({
      stdin: {
        contents:
          "import tenant, { WorkspaceCoordinator } from './src/hosted/tenant'; export default tenant; export class TestCoordinator extends WorkspaceCoordinator { async fireAlarm() { return super.alarm(); } }",
        resolveDir: process.cwd(),
      },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'node',
      external: ['cloudflare:*'],
      logLevel: 'silent',
    })
  ).outputFiles[0].text;
  mf = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      workers: [
        {
          name: 'tenant',
          modules: true,
          script,
          compatibilityDate: '2026-09-09',
          compatibilityFlags: ['nodejs_compat'],
          d1Databases: { DB: 'maintenance-test' },
          durableObjects: {
            WORKSPACE_COORDINATOR: {
              className: 'TestCoordinator',
              useSQLite: true,
            },
          },
          serviceBindings: { ASSETS: () => new Response('test') },
          bindings: {
            DOMBOT_AUTH: 'gateway',
            DOMBOT_SECRET: btoa('x'.repeat(32)),
            DOMBOT_WORKSPACE_ID: id,
            DOMBOT_GATEWAY_SECRET: key,
            DOMBOT_PLATFORM_ALARMS: 'true',
            DOMBOT_EMPTY_SLEEP: 'true',
            DOMBOT_CENTRAL_PRICING: 'true',
          },
        },
      ],
    }),
  );
  tenant = await mf.getWorker('tenant');
  db = await mf.getD1Database('DB', 'tenant');
  for (const f of readdirSync('migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort())
    await db.exec(
      readFileSync('migrations/' + f, 'utf8')
        .replace(/^--.*$/gm, '')
        .replace(/\n/g, ' '),
    );
}, 60000);
afterAll(async () => {
  await mf?.dispose();
});
it('restricts pricing continuation to private null-owner proofs and preserves empty sleep and pause', async () => {
  const pricing = async (
    step: boolean,
    owner: string | null = null,
    secret = key,
  ) => {
    const request = new Request(
      'http://localhost/platform-internal/renewal-pricing',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step }),
      },
    );
    request.headers.set(
      'x-dombot-gateway-proof',
      await signGatewayRequest(secret, id, owner, request),
    );
    return tenant.fetch(request);
  };
  expect((await pricing(false, 'test-owner')).status).toBe(403);
  expect((await pricing(false, null, 'foreign-key'.repeat(4))).status).toBe(
    403,
  );
  const status = await pricing(false);
  expect(status.status).toBe(200);
  expect(await status.json()).toMatchObject({ remaining: 0, failed: 0 });
  expect((await health()).alarmAt).toBeNull();
  await signed('/platform-internal/pause', 'POST', undefined, null);
  expect(await (await pricing(true)).json()).toEqual({
    remaining: 0,
    failed: 0,
    paused: true,
  });
  expect((await health()).alarmAt).toBeNull();
  await signed('/platform-internal/resume', 'POST', undefined, null);
});
it('keeps empty browsing asleep, wakes for actual due work, completes it, then sleeps again', async () => {
  expect((await signed('/api/getSettings', 'POST', [])).status).toBe(200);
  expect((await signed('/api/listPortfolio', 'POST', [false])).status).toBe(
    200,
  );
  expect((await health()).alarmAt).toBeNull();
  expect(
    (await signed('/platform-internal/reconcile', 'POST', undefined, null))
      .status,
  ).toBe(200);
  expect((await health()).maintenance.inspection.state).toBe('empty');
  await db
    .prepare('INSERT INTO sales_abuse VALUES(?,?,?)')
    .bind('expired-test', 1, 1)
    .run();
  await signed('/platform-internal/reconcile', 'POST', undefined, null);
  expect((await health()).alarmAt).not.toBeNull();
  const namespace = await mf.getDurableObjectNamespace(
    'WORKSPACE_COORDINATOR',
    'tenant',
  );
  const stub = namespace.get(namespace.idFromName(id));
  await stub.fireAlarm();
  expect(await db.prepare('SELECT 1 FROM sales_abuse').first()).toBeNull();
  expect((await health()).maintenance.inspection.state).toBe('empty');
  expect((await health()).alarmAt).toBeNull();
  await stub.fireAlarm();
  expect((await health()).alarmAt).toBeNull();
}, 20000);
it('starts maintenance when a browser writes registrar credentials and preserves operator pause', async () => {
  expect(
    (
      await signed('/api/saveRegistrarCredentials', 'POST', [
        'porkbun',
        { apiKey: 'test-only-key', secretApiKey: 'test-only-secret' },
      ])
    ).status,
  ).toBe(200);
  expect((await health()).maintenance.inspection.state).toBe('work');
  expect((await health()).alarmAt).not.toBeNull();
  await signed('/platform-internal/pause', 'POST', undefined, null);
  await signed('/api/getSettings', 'POST', []);
  expect((await health()).alarmAt).toBeNull();
  await signed('/platform-internal/resume', 'POST', undefined, null);
  expect((await health()).alarmAt).not.toBeNull();
});
it('rejects owner and foreign-tenant lifecycle controls and does not let diagnostic reads rearm a pause', async () => {
  for (const suffix of ['health', 'pause', 'resume', 'reconcile'])
    expect(
      (
        await signed(
          '/platform-internal/' + suffix,
          suffix === 'health' ? 'GET' : 'POST',
        )
      ).status,
    ).toBe(403);
  const foreign = new Request('http://localhost/platform-internal/reconcile', {
    method: 'POST',
  });
  foreign.headers.set(
    'x-dombot-gateway-proof',
    await signGatewayRequest(
      key,
      '22222222-2222-4222-8222-222222222222',
      null,
      foreign,
    ),
  );
  expect((await tenant.fetch(foreign)).status).toBe(403);
  await signed('/platform-internal/pause', 'POST', undefined, null);
  expect(
    (await signed('/platform-internal/sync-monitor', 'GET', undefined, null))
      .status,
  ).toBe(200);
  expect((await health()).alarmAt).toBeNull();
});
