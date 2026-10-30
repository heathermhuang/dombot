import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readdirSync, readFileSync } from 'node:fs';
import { continueRenewalPricing, reservePricingStep } from './renewal-pricing';
import { Accounts } from './accounts';
import { verifyGatewayRequest } from '../shared/gateway-proof';

const id = '11111111-1111-4111-8111-111111111111';
const key = 'synthetic-pricing-key-'.repeat(3);
let mf: Miniflare, db: D1Database, env: HostedEnv;
let pending = 100,
  nextAt = 0,
  paused = false,
  failStep = false;
const fetch = vi.fn(async (request: Request) => {
  const proof = await verifyGatewayRequest(key, id, request);
  expect(proof?.owner).toBeNull();
  expect(new URL(request.url).pathname).toBe(
    '/platform-internal/renewal-pricing',
  );
  const { step } = (await request.json()) as { step: boolean };
  if (step && failStep) throw Error('ambiguous connection loss');
  if (step) pending--;
  return Response.json({
    remaining: pending,
    failed: 0,
    ...(nextAt ? { nextAt } : {}),
    ...(paused ? { paused: true } : {}),
  });
});
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      d1Databases: { CONTROL_DB: 'renewal-continuation-test' },
    }),
  );
  db = (await mf.getD1Database('CONTROL_DB')) as unknown as D1Database;
  for (const file of readdirSync('hosted/migrations')
    .filter((f) => f.endsWith('.sql'))
    .sort())
    await db.exec(
      readFileSync('hosted/migrations/' + file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/--[^\n]*/g, '')
        .replace(/\n/g, ' '),
    );
  await db
    .prepare('INSERT INTO workspaces(id,label) VALUES(?,?)')
    .bind(id, 'Synthetic pricing')
    .run();
  await db
    .prepare(
      'INSERT INTO users(id,email,workspace_id,password_hash,created_at) VALUES(?,?,?,?,?)',
    )
    .bind('synthetic-owner', 'pricing@example.test', id, 'unused', Date.now())
    .run();
}, 30000);
afterAll(async () => {
  await mf?.dispose();
});
beforeEach(async () => {
  vi.useRealTimers();
  pending = 100;
  nextAt = 0;
  paused = false;
  failStep = false;
  fetch.mockClear();
  await db.batch(
    [
      'renewal_pricing_checks',
      'rate_limits',
      'sync_monitor_accounts',
      'pending_workspaces',
    ].map((t) => db.prepare('DELETE FROM ' + t)),
  );
  await db.prepare('UPDATE workspaces SET enabled=1').run();
  await db
    .prepare(
      'INSERT INTO sync_monitor_accounts(workspace_id,account_id,seq,last_good_at) VALUES(?,?,?,?)',
    )
    .bind(id, 'dynadot', 1, Date.now())
    .run();
  env = {
    CONTROL_DB: db,
    AUTH_PEPPER: 'synthetic-pepper',
    GATEWAY_KEYS: JSON.stringify({ [id]: key }),
    WORKSPACES: JSON.stringify([
      { id, binding: 'WORKSPACE_0', label: 'Synthetic pricing' },
    ]),
    RENEWAL_PRICING_ENABLED: 'true',
    WORKSPACE_0: { fetch },
  } as unknown as HostedEnv;
});
it('continues without a browser and shares the existing 15-step quota with it', async () => {
  expect(await reservePricingStep(env, id)).toBe(true); // competing browser step
  await continueRenewalPricing(env);
  expect(pending).toBe(86);
  expect(fetch).toHaveBeenCalledTimes(15); // status + fourteen steps
  expect(await reservePricingStep(env, id)).toBe(false);
  const accounts = new Accounts(db, env.AUTH_PEPPER);
  for (let i = 0; i < 5; i++)
    expect(await accounts.rateLimit(`provider:${id}`, 20)).toBe(true);
  expect(await accounts.rateLimit(`provider:${id}`, 20)).toBe(false);
  const calls = fetch.mock.calls.length;
  await continueRenewalPricing(env);
  expect(fetch).toHaveBeenCalledTimes(calls);
});
it('fences overlapping cron invocations and records actual completion', async () => {
  pending = 4;
  await Promise.all([continueRenewalPricing(env), continueRenewalPricing(env)]);
  expect(pending).toBe(0);
  expect(fetch).toHaveBeenCalledTimes(5);
  expect(
    await db
      .prepare(
        'SELECT outcome,remaining,lease_until FROM renewal_pricing_checks',
      )
      .first(),
  ).toMatchObject({ outcome: 'complete', remaining: 0, lease_until: 0 });
});
it('honors provider cooldowns and operator pauses without spending quota', async () => {
  nextAt = Date.now() + 3600_000;
  await continueRenewalPricing(env);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(
    await db.prepare('SELECT count(*) n FROM rate_limits').first(),
  ).toEqual({ n: 0 });
  await db.prepare('DELETE FROM renewal_pricing_checks').run();
  nextAt = 0;
  paused = true;
  await continueRenewalPricing(env);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(
    await db.prepare('SELECT outcome FROM renewal_pricing_checks').first(),
  ).toEqual({ outcome: 'paused' });
});
it('does not replay an uncertain step or report an unavailable result as complete', async () => {
  failStep = true;
  await continueRenewalPricing(env);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(
    await db.prepare('SELECT outcome FROM renewal_pricing_checks').first(),
  ).toEqual({ outcome: 'unavailable' });
  await continueRenewalPricing(env);
  expect(fetch).toHaveBeenCalledTimes(2);
});
it('does not visit unobserved empty, disabled, pending, or feature-disabled portfolios', async () => {
  env.RENEWAL_PRICING_ENABLED = 'false';
  await continueRenewalPricing(env);
  env.RENEWAL_PRICING_ENABLED = 'true';
  await db.prepare('DELETE FROM sync_monitor_accounts').run();
  await continueRenewalPricing(env);
  await db
    .prepare(
      'INSERT INTO sync_monitor_accounts(workspace_id,account_id,seq) VALUES(?,?,?)',
    )
    .bind(id, 'dynadot', 1)
    .run();
  await db.prepare('UPDATE workspaces SET enabled=0').run();
  await continueRenewalPricing(env);
  await db.prepare('UPDATE workspaces SET enabled=1').run();
  env.ON_DEMAND_ENABLED = 'true';
  await db
    .prepare(
      'INSERT INTO pending_workspaces(workspace_id,created_at) VALUES(?,?)',
    )
    .bind(id, Date.now())
    .run();
  await continueRenewalPricing(env);
  expect(fetch).not.toHaveBeenCalled();
});
it('notices a new successful inventory before a completed checkpoint is due', async () => {
  pending = 0;
  await continueRenewalPricing(env);
  await db
    .prepare('UPDATE sync_monitor_accounts SET last_good_at=last_good_at+1000')
    .run();
  pending = 1;
  await continueRenewalPricing(env);
  expect(pending).toBe(0);
  expect(fetch).toHaveBeenCalledTimes(3);
});
