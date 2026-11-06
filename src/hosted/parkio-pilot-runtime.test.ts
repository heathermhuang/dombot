import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions, Request } from 'miniflare';
import { build } from 'esbuild';

const owner = '11111111-1111-4111-8111-111111111111';
const root = 'test-only-parkio-pilot-root-'.repeat(3);
let mf: Miniflare;
const names = ['normal', 'disabled', 'expired', 'launch-fails', 'close-fails'];

beforeAll(async () => {
  const result = await build({
    entryPoints: ['src/hosted/test-fixtures/parkio-pilot.ts'],
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
      workers: names.map((name) => ({
        name,
        modules: true,
        script: result.outputFiles[0].text,
        compatibilityDate: '2026-09-09',
        compatibilityFlags: ['nodejs_compat'],
        durableObjects: {
          PARKIO_PILOT: { className: 'TestParkioPilot', useSQLite: true },
        },
        d1Databases: { CONTROL_DB: name + '-control' },
        serviceBindings: { PARKIO_BROWSER: () => new Response('unused') },
        bindings: {
          ADMIN_USER_IDS: JSON.stringify([owner]),
          PARKIO_PILOT_ENABLED: name === 'disabled' ? 'false' : 'true',
          PARKIO_PILOT_OWNER_ID: owner,
          PARKIO_PILOT_SECRET: root,
          PARKIO_PILOT_EXPIRES_AT: new Date(
            Date.now() + (name === 'expired' ? -1000 : 86400000),
          ).toISOString(),
          TEST_MODE: name,
        },
        outboundService: async (request) => {
          const url = new URL(request.url);
          if (
            url.origin !== 'https://park.io' ||
            url.pathname !== '/orders/export/active.csv' ||
            request.headers.get('cookie') !== 'session=synthetic-private-cookie'
          )
            return new Response(
              'Fixture outbound refused ' + url.origin + url.pathname,
              { status: 403 },
            );
          return new Response(
            'Domain,Expires\nalpha.test,2028-02-29\nbeta.test,2029-01-01\n',
            { headers: { 'Content-Type': 'text/csv' } },
          );
        },
      })),
    }),
  );
  for (const name of names) {
    const db = await mf.getD1Database('CONTROL_DB', name);
    await db.exec('CREATE TABLE passkeys (id TEXT, user_id TEXT)');
  }
}, 30_000);
afterAll(async () => {
  await mf?.dispose();
});

async function request(
  name: string,
  path = '/',
  options: {
    identity?: string;
    method?: string;
    origin?: string;
    stale?: boolean;
  } = {},
) {
  const worker = await mf.getWorker(name);
  return worker.fetch(
    new Request('http://localhost' + path, {
      method: options.method ?? 'GET',
      redirect: 'manual',
      headers: {
        Origin: options.origin ?? 'http://localhost',
        ...(options.identity ? { 'X-Test-Identity': options.identity } : {}),
        ...(options.stale ? { 'X-Test-Stale': '1' } : {}),
      },
    }),
  );
}
const action = (name: string, path: string) =>
  request(name, '/' + path, { identity: owner, method: 'POST' });
async function state(name: string) {
  const res = await request(name, '/', { identity: owner });
  const html = await res.text();
  const raw = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)?.[1];
  expect(raw).toBeTruthy();
  return JSON.parse(
    raw!
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>'),
  );
}

describe('owner-only Park.io pilot runtime', () => {
  it('fails closed when disabled or expired and does not expose a sign-in view', async () => {
    const response = await action('disabled', 'start');
    expect(response.status, await response.clone().text()).toBe(404);
    expect((await action('expired', 'start')).status).toBe(404);
  });
  it('requires a current owner/admin session and same-origin mutations', async () => {
    expect((await request('normal')).status).toBe(303);
    expect(
      (await request('normal', '/', { identity: 'another-user' })).status,
    ).toBe(403);
    const stale = await request('normal', '/', {
      identity: owner,
      stale: true,
    });
    expect(stale.headers.get('location')).toContain('/account/reauth');
    expect(
      (
        await request('normal', '/start', {
          identity: owner,
          method: 'POST',
          origin: 'https://attacker.test',
        })
      ).status,
    ).toBe(403);
  });
  it('opens a scoped sign-in view and returns safe, idempotent status', async () => {
    const first = await action('normal', 'start');
    expect(first.status).toBe(303);
    expect(first.headers.get('location')).toMatch(
      /^https:\/\/live\.browser\.run\//,
    );
    const before = await state('normal');
    expect(before.phase).toBe('login');
    await action('normal', 'start');
    expect((await state('normal')).attemptId).toBe(before.attemptId);
  });
  it('requires export inspection, captures encrypted state, verifies closure, then compares Worker holdings', async () => {
    expect((await action('normal', 'capture')).status).toBe(409);
    expect((await action('normal', 'inspect')).status).toBe(303);
    expect((await state('normal')).cookieNames).toEqual(['session']);
    expect((await action('normal', 'capture')).status).toBe(303);
    const captured = await state('normal');
    expect(captured.phase).toBe('ready');
    expect(captured.browserClosed).toBe(true);
    expect(captured.count).toBe(2);
    expect(JSON.stringify(captured)).not.toContain('synthetic-private-cookie');
    expect((await action('normal', 'view')).status).toBe(409);
    expect((await action('normal', 'retest')).status).toBe(303);
    expect((await state('normal')).result).toEqual({
      count: 2,
      namesMatch: true,
      expiriesMatch: true,
      cookieRotationObserved: false,
    });
    expect((await state('normal')).phase).toBe('passed');
    expect((await action('normal', 'retest')).status).toBe(409);
  });
  it('clears captured session access and blocks further reads', async () => {
    expect((await action('normal', 'cancel')).status).toBe(303);
    expect((await state('normal')).phase).toBe('cancelled');
    expect((await action('normal', 'retest')).status).toBe(409);
  });
  it('sanitizes upstream errors and never silently repeats an uncertain launch', async () => {
    const failed = await action('launch-fails', 'start');
    expect(await failed.text()).not.toContain('raw secret');
    expect((await state('launch-fails')).phase).toBe('cleanup_required');
    expect((await action('launch-fails', 'start')).status).toBe(409);
  });
  it('does not claim portability or allow a Worker read if browser closure fails', async () => {
    await action('close-fails', 'start');
    await action('close-fails', 'inspect');
    await action('close-fails', 'capture');
    expect((await state('close-fails')).browserClosed).toBe(false);
    expect((await action('close-fails', 'retest')).status).toBe(409);
  });
});
