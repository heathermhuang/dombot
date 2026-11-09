import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions, Request } from 'miniflare';
import { build } from 'esbuild';

const owner = '11111111-1111-4111-8111-111111111111';
const root = 'test-only-parkio-pilot-root-'.repeat(3);
let mf: Miniflare;
const names = [
  'normal',
  'disabled',
  'expired',
  'launch-fails',
  'close-fails',
  'native-not-found',
  'lookup-fails',
  'automatic',
  'not-authenticated',
  'scheduled',
  'scheduled-fails',
  'scheduled-uncertain',
  'delayed-close',
  'scheduled-contract-fails',
];
const reads = new Map<string, number>();
let releaseRead: (() => void) | undefined;
let pausedRead: Promise<void> | undefined;

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
          const call = (reads.get(name) ?? 0) + 1;
          reads.set(name, call);
          if (name === 'scheduled' && call === 2 && pausedRead)
            await pausedRead;
          if (
            ['scheduled-fails', 'scheduled-contract-fails'].includes(name) &&
            call > 1
          )
            return new Response('Unavailable', { status: 503 });
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
    accept?: string;
    body?: string;
  } = {},
) {
  const worker = await mf.getWorker(name);
  return worker.fetch(
    new Request('http://localhost' + path, {
      method: options.method ?? 'GET',
      redirect: 'manual',
      headers: {
        Origin: options.origin ?? 'http://localhost',
        'Content-Type': 'application/json',
        ...(options.identity ? { 'X-Test-Identity': options.identity } : {}),
        ...(options.stale ? { 'X-Test-Stale': '1' } : {}),
        ...(options.accept ? { Accept: options.accept } : {}),
      },
      body: options.method === 'POST' ? (options.body ?? '{}') : undefined,
    }),
  );
}
const action = (name: string, path: string) =>
  request(name, '/' + path, { identity: owner, method: 'POST' });
async function state(name: string) {
  const res = await request(name, '/status', { identity: owner });
  expect(res.status).toBe(200);
  return res.json();
}
async function fixture(name: string, path: string) {
  const ns = await mf.getDurableObjectNamespace('PARKIO_PILOT', name);
  return ns
    .get(ns.idFromName('owner/' + owner))
    .fetch('https://parkio-pilot.internal/' + path, { method: 'POST' });
}

describe('owner-only Park.io pilot runtime', () => {
  it('does not repeat a failed contract read or continue its automatic schedule', async () => {
    await action('scheduled-contract-fails', 'start');
    await action('scheduled-contract-fails', 'native-complete');
    expect(
      (await state('scheduled-contract-fails')).nextCheckAt,
    ).not.toBeNull();
    expect(
      (await action('scheduled-contract-fails', 'native-contract')).status,
    ).toBe(409);
    const repeated = await action(
      'scheduled-contract-fails',
      'native-contract',
    );
    expect(await repeated.json()).toEqual({
      error: 'contract_outcome_unknown',
    });
    await fixture('scheduled-contract-fails', 'fixture-alarm');
    expect(reads.get('scheduled-contract-fails')).toBe(2);
    expect(await state('scheduled-contract-fails')).toMatchObject({
      phase: 'blocked',
      nextCheckAt: null,
    });
  });
  it('completes an asynchronous browser close through its alarm without another login or duplicate Worker read', async () => {
    await action('delayed-close', 'start');
    const pending = await action('delayed-close', 'native-complete');
    expect(pending.status).toBe(200);
    expect(await pending.json()).toMatchObject({
      phase: 'closing',
      browserClosed: false,
    });
    expect(reads.get('delayed-close') ?? 0).toBe(0);
    const result = await fixture('delayed-close', 'fixture-alarm');
    expect(await result.json()).toMatchObject({
      phase: 'passed',
      browserClosed: true,
      authenticationFlow: 'native_credentials',
    });
    expect((await action('delayed-close', 'native-complete')).status).toBe(200);
    expect(reads.get('delayed-close')).toBe(1);
  });
  it('journals pending checks, executes bounded scheduled reads once, and preserves the original retention', async () => {
    await action('scheduled', 'start');
    await action('scheduled', 'native-complete');
    const first = await state('scheduled');
    expect(first.authenticationFlow).toBe('native_credentials');
    expect(first.nextCheckAt).toBe(first.checkedAt + 60000);
    expect(
      first.checkHistory.map((c: { outcome: string }) => c.outcome),
    ).toEqual(['passed']);
    pausedRead = new Promise((resolve) => {
      releaseRead = resolve;
    });
    const followup = fixture('scheduled', 'fixture-followup-due');
    try {
      await expect
        .poll(async () => (await state('scheduled')).phase)
        .toBe('rechecking');
      expect(
        (await request('scheduled', '/native-proof', { identity: owner }))
          .status,
      ).toBe(409);
      expect((await state('scheduled')).checkHistory.at(-1).outcome).toBe(
        'pending',
      );
    } finally {
      releaseRead?.();
      pausedRead = undefined;
    }
    await followup;
    await fixture('scheduled', 'fixture-alarm');
    const second = await state('scheduled');
    expect(reads.get('scheduled')).toBe(2);
    expect(second.expiresAt).toBe(first.expiresAt);
    await fixture('scheduled', 'fixture-close-budget-used');
    expect((await state('scheduled')).phase).toBe('passed');
    expect(
      (await request('scheduled', '/native-proof', { identity: owner })).status,
    ).toBe(200);
    expect(second.nextCheckAt).toBeGreaterThan(Date.now() + 22 * 3600000);
    expect(
      second.checkHistory.map((c: { outcome: string }) => c.outcome),
    ).toEqual(['passed', 'passed']);
    await fixture('scheduled', 'fixture-followup-due');
    await fixture('scheduled', 'fixture-alarm');
    const third = await state('scheduled');
    expect(reads.get('scheduled')).toBe(3);
    expect(third.nextCheckAt).toBeNull();
    expect(third.checkHistory).toHaveLength(3);
  });
  it('holds failed and uncertain scheduled outcomes instead of retrying or claiming success', async () => {
    await action('scheduled-fails', 'start');
    await action('scheduled-fails', 'native-complete');
    await fixture('scheduled-fails', 'fixture-followup-due');
    await fixture('scheduled-fails', 'fixture-alarm');
    const failed = await state('scheduled-fails');
    expect(failed.phase).toBe('blocked');
    expect(failed.checkHistory.at(-1).outcome).toBe('failed');
    expect(failed.nextCheckAt).toBeNull();
    expect(reads.get('scheduled-fails')).toBe(2);
    await action('scheduled-uncertain', 'start');
    await action('scheduled-uncertain', 'native-complete');
    await fixture('scheduled-uncertain', 'fixture-interrupted');
    await fixture('scheduled-uncertain', 'fixture-alarm');
    const unknown = await state('scheduled-uncertain');
    expect(unknown).toMatchObject({
      phase: 'blocked',
      error: 'check_outcome_unknown',
      nextCheckAt: null,
    });
    expect(unknown.checkHistory.at(-1).outcome).toBe('unknown');
    expect(reads.get('scheduled-uncertain')).toBe(1);
  });
  it('automatically captures, closes and independently compares holdings once for concurrent completion requests', async () => {
    expect((await action('automatic', 'start')).status).toBe(303);
    expect(
      (await request('automatic', '/native-proof', { identity: owner })).status,
    ).toBe(409);
    const results = await Promise.all(
      Array.from({ length: 8 }, () => action('automatic', 'native-complete')),
    );
    for (const r of results) {
      expect(r.status, await r.clone().text()).toBe(200);
      expect((await r.json()).phase).toBe('passed');
    }
    const proof = await request('automatic', '/native-proof', {
      identity: owner,
    });
    expect(proof.headers.get('cache-control')).toBe('no-store');
    expect(await proof.json()).toMatchObject({
      phase: 'passed',
      browserClosed: true,
      count: 2,
      accountIdentityQualified: false,
      holdings: [
        { domain: 'alpha.test', expirationDate: '2028-02-29' },
        { domain: 'beta.test', expirationDate: '2029-01-01' },
      ],
    });
    expect((await action('automatic', 'native-complete')).status).toBe(200);
    expect((await action('automatic', 'native-retest')).status).toBe(409);
    const before = reads.get('automatic');
    const contract = await action('automatic', 'native-contract');
    expect(contract.status).toBe(200);
    expect(await contract.json()).toMatchObject({
      exportRows: 2,
      uniqueDomains: 2,
      ownershipQualified: false,
    });
    expect((await action('automatic', 'native-contract')).status).toBe(200);
    expect(reads.get('automatic')).toBe((before ?? 0) + 1);
  });
  it('does not treat an unauthenticated page as a completed proof', async () => {
    await action('not-authenticated', 'start');
    const result = await action('not-authenticated', 'native-complete');
    expect(result.status).toBe(409);
    expect(await result.json()).toEqual({ error: 'authentication_required' });
    expect(
      (await request('not-authenticated', '/native-proof', { identity: owner }))
        .status,
    ).toBe(409);
  });
  it('serves native fields without a viewer and retains owner/fresh-auth/CSRF admission', async () => {
    expect((await request('normal', '/native')).status).toBe(303);
    expect(
      (await request('normal', '/native', { identity: 'other-user' })).status,
    ).toBe(403);
    expect(
      (
        await request('normal', '/native', { identity: owner, stale: true })
      ).headers.get('location'),
    ).toContain('/account/reauth');
    const page = await request('normal', '/native', { identity: owner });
    const html = await page.text();
    expect(html).toContain('id="native-username"');
    expect(html).toContain('id="native-password"');
    expect(html).not.toContain('<iframe');
    expect(html).not.toContain('name="password"');
    expect(html).not.toContain('synthetic-only');
    expect(page.headers.get('content-security-policy')).toContain(
      "form-action 'none'",
    );
    const rejected = await request('normal', '/native-connection', {
      identity: owner,
      method: 'POST',
      body: '{"password":"synthetic-secret"}',
    });
    expect(rejected.status).toBe(400);
    expect(await rejected.text()).not.toContain('synthetic-secret');
    expect((await state('normal')).phase).toBe('not_started');
    expect(
      (
        await request('normal', '/native-connection', {
          identity: owner,
          method: 'POST',
          origin: 'https://other.test',
        })
      ).status,
    ).toBe(403);
  });
  it('recovers an idle-closed expired browser in one start request when native lookup throws 404', async () => {
    await action('native-not-found', 'start');
    const previous = await state('native-not-found');
    const ns = await mf.getDurableObjectNamespace(
      'PARKIO_PILOT',
      'native-not-found',
    );
    await ns
      .get(ns.idFromName('owner/' + owner))
      .fetch('https://parkio-pilot.internal/fixture-idle', { method: 'POST' });
    const next = await action('native-not-found', 'start');
    expect(next.status, await next.clone().text()).toBe(303);
    const current = await state('native-not-found');
    expect(current.phase).toBe('login');
    expect(current.attemptId).not.toBe(previous.attemptId);
  });
  it('keeps uncertain provider lookup failures blocked instead of treating every failure as closure', async () => {
    await action('lookup-fails', 'start');
    const previous = await state('lookup-fails');
    const ns = await mf.getDurableObjectNamespace(
      'PARKIO_PILOT',
      'lookup-fails',
    );
    await ns
      .get(ns.idFromName('owner/' + owner))
      .fetch('https://parkio-pilot.internal/fixture-idle', { method: 'POST' });
    expect((await action('lookup-fails', 'start')).status).toBe(409);
    expect((await state('lookup-fails')).attemptId).toBe(previous.attemptId);
  });
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
    const document = await request('normal', '/', { identity: owner });
    expect(document.headers.get('referrer-policy')).toBe('same-origin');
    const entry = await document.text();
    expect(entry).not.toContain('rel="noreferrer"');
    expect(entry).toContain('Sign in to Park.io');
    expect(entry).not.toContain('Open mobile sign-in');
    expect(entry).not.toContain('Open desktop sign-in');
    expect(entry).not.toContain('target="_blank"');
    const first = await action('normal', 'start');
    expect(first.status).toBe(303);
    expect(first.headers.get('referrer-policy')).toBe('same-origin');
    expect(first.headers.get('location')).toBe('/admin/parkio-pilot/sign-in');
    const before = await state('normal');
    expect(before.phase).toBe('login');
    await action('normal', 'start');
    expect((await state('normal')).attemptId).toBe(before.attemptId);
  });
  it('keeps the native keyboard page and connection grant behind owner admission', async () => {
    expect((await request('normal', '/sign-in')).status).toBe(303);
    expect(
      (await request('normal', '/sign-in', { identity: 'other-user' })).status,
    ).toBe(403);
    const page = await request('normal', '/sign-in', { identity: owner });
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('id="parkio-keyboard"');
    expect(html).toContain('type="password"');
    expect(html).toContain('readonly disabled');
    expect(html).toContain('autocomplete="off"');
    expect(html).toContain('referrerpolicy="no-referrer"');
    expect(html).not.toContain('synthetic-only');
    expect(page.headers.get('content-security-policy')).toContain(
      'wss://live.browser.run',
    );
    expect(
      (
        await request('normal', '/mobile-connection', {
          identity: 'other-user',
          method: 'POST',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request('normal', '/mobile-connection', {
          identity: owner,
          method: 'POST',
          origin: 'https://other.test',
        })
      ).status,
    ).toBe(403);
    const grant = await action('normal', 'mobile-connection');
    expect(grant.status).toBe(200);
    expect(grant.headers.get('cache-control')).toBe('no-store');
    const data = await grant.json();
    expect(data.socketUrl).toMatch(
      /^wss:\/\/live\.browser\.run\/api\/devtools\/browser\//,
    );
    expect(JSON.stringify(await state('normal'))).not.toContain(
      'synthetic-only',
    );
  });
  it('continues to reject null-origin submissions instead of weakening CSRF', async () => {
    expect(
      (
        await request('normal', '/start', {
          identity: owner,
          method: 'POST',
          origin: 'null',
        })
      ).status,
    ).toBe(403);
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
    const navigation = await request('launch-fails', '/start', {
      identity: owner,
      method: 'POST',
      accept: 'text/html',
    });
    expect(navigation.headers.get('content-type')).toContain('text/html');
    const html = await navigation.text();
    expect(html).toContain('Could not open Park.io');
    expect(html).toContain('Return to Park.io connection');
    expect(html).not.toContain('"error":');
  });
  it('does not claim portability or allow a Worker read if browser closure fails', async () => {
    await action('close-fails', 'start');
    await action('close-fails', 'inspect');
    await action('close-fails', 'capture');
    expect((await state('close-fails')).browserClosed).toBe(false);
    expect((await action('close-fails', 'retest')).status).toBe(409);
  });
});
