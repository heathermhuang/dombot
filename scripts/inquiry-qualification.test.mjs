// Disposable non-production D1 databases and captured mail only. No import QA lease.
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readdirSync, readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { sqlStatements } from './prepare-on-demand.mjs';
import { SalesStore, readPublicSale } from '../src/worker/sales-store';
import { SalesInquiryStore } from '../src/worker/sales-inquiry-store';
import { createPublicSalesRoutes } from '../src/worker/public-sales';
import { createSalesInternalRoutes } from '../src/worker/sales-internal';
import { emptySale } from '../src/shared/hosted-sales';
import { sourcePriceFingerprint } from '../src/core/publication/sales';
import { MemoryDocStore } from '../src/core/storage/doc-store';
import { configureStore, hydrateStores } from '../src/core/storage/namespace';
import {
  drainSalesWorkspace,
  salesRecipientHash,
} from '../src/hosted/sales-notifications';
let mf, db, control;
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      modules: true,
      script: 'export default {fetch(){return new Response("fixture")}}',
      d1Databases: { DB: 'inquiry-local', CONTROL: 'inquiry-control-local' },
      outboundService: () => {
        throw Error('External access forbidden');
      },
    }),
  );
  db = await mf.getD1Database('DB');
  control = await mf.getD1Database('CONTROL');
  for (const [directory, target] of [
    ['migrations', db],
    ['hosted/migrations', control],
  ])
    for (const name of readdirSync(directory)
      .filter((n) => n.endsWith('.sql'))
      .sort())
      for (const sql of sqlStatements(
        readFileSync(directory + '/' + name, 'utf8'),
      ))
        await target.prepare(sql).run();
}, 30000);
afterAll(async () => {
  vi.unstubAllGlobals();
  await mf?.dispose();
});
it('qualifies submit, captured confirmation mail, conversation/reply, replay, rate limits and mail uncertainty', async () => {
  configureStore(new MemoryDocStore());
  await hydrateStores();
  const workspace = crypto.randomUUID(),
    user = crypto.randomUUID(),
    key = 'synthetic-gateway'.repeat(4),
    origin = 'https://inquiry.fixture.invalid';
  const tenantEnv = {
    DB: db,
    DOMBOT_SECRET: btoa('q'.repeat(32)),
    DOMBOT_GATEWAY_SECRET: key,
    DOMBOT_WORKSPACE_ID: workspace,
    DOMBOT_AUTH: 'password',
    DOMBOT_SALES_ORIGIN: origin + '/w/' + workspace,
    DOMBOT_PUBLIC_BASE_PATH: '/w/' + workspace,
    SALES_INQUIRIES_ENABLED: 'true',
    SALES_PRIVACY_REVIEWED: 'true',
    SALES_TURNSTILE_SECRET: 'synthetic-only',
    SALES_TURNSTILE_SITEKEY: 'synthetic-only',
    SALES_MAIL_ENABLED: 'true',
  };
  const store = await SalesStore.from(tenantEnv),
    inbox = new SalesInquiryStore(store, origin + '/w/' + workspace);
  const draft = emptySale(
    'inquiry.fixture.invalid',
    sourcePriceFingerprint(null),
  );
  const revision = await store.save(draft, null);
  const observation = async () => ({
    price: null,
    ownershipFingerprint: 'fixture-owner',
    controlExpiresAt: Date.now() + 3600000,
    available: true,
    reason: null,
  });
  const review = await store.prepare([{ id: draft.id, revision }], observation);
  await store.publish(review.id, observation);
  const published = await readPublicSale(db, draft.domain);
  const app = new Hono();
  app.route('/sales-internal', createSalesInternalRoutes());
  app.route('/', createPublicSalesRoutes());
  app.route('/w/' + workspace, createPublicSalesRoutes());
  const mail = [];
  let failMail = false,
    challenge = true,
    challengeCalls = 0;
  const env = {
    CONTROL_DB: control,
    AUTH_PEPPER: 'synthetic-pepper'.repeat(4),
    CANONICAL_ORIGIN: origin,
    WORKSPACES: JSON.stringify([
      { id: workspace, label: 'Local inquiry fixture', binding: 'WORKSPACE_0' },
    ]),
    GATEWAY_KEYS: JSON.stringify({ [workspace]: key }),
    WORKSPACE_0: { fetch: (r) => app.fetch(r, tenantEnv) },
    SALES_MAIL_ENABLED: 'true',
    SALES_MAIL_DELIVERY_VERIFIED: 'true',
    SALES_EMAIL_FROM: 'sales@mail.domains.domains',
    SALES_MAIL_DAILY_LIMIT: '100',
    SALES_MAIL_MONTHLY_LIMIT: '1000',
    SALES_EMAIL: {
      send: async (message) => {
        mail.push(message);
        if (failMail) throw Error('Synthetic unknown delivery');
        return { messageId: 'captured-' + mail.length };
      },
    },
  };
  await control
    .prepare('INSERT INTO workspaces(id,label) VALUES(?,?)')
    .bind(workspace, 'Local inquiry fixture')
    .run();
  await control
    .prepare(
      'INSERT INTO users(id,email,workspace_id,password_hash,created_at) VALUES(?,?,?,?,?)',
    )
    .bind(user, 'owner@fixture.invalid', workspace, 'not-a-login', Date.now())
    .run();
  await control
    .prepare(
      'INSERT INTO sales_verified_recipients(workspace_id,email_hash,verified_at) VALUES(?,?,?)',
    )
    .bind(
      workspace,
      salesRecipientHash(env, 'owner@fixture.invalid'),
      Date.now(),
    )
    .run();
  vi.stubGlobal('fetch', async (url) => {
    expect(String(url)).toBe(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    );
    challengeCalls++;
    return Response.json({
      success: challenge,
      hostname: 'inquiry.fixture.invalid',
      action: 'sales-inquiry',
    });
  });
  const input = {
    idempotencyKey: crypto.randomUUID(),
    observedRevision: published.revision,
    name: 'Synthetic sender',
    email: 'sender@fixture.invalid',
    offer: null,
    message: 'Synthetic inquiry; no commercial offer.',
    turnstileToken: 'fixture-only',
    website: '',
  };
  const post = (path, body, ip = '192.0.2.1') =>
    app.request(
      origin + path,
      {
        method: 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          'cf-connecting-ip': ip,
        },
        body: JSON.stringify(body),
      },
      tenantEnv,
    );
  const path = '/d/' + draft.domain + '/inquiries';
  challenge = false;
  expect((await post(path, input)).status).toBe(400);
  challenge = true;
  const submitted = await post(path, input);
  expect(submitted.status).toBe(202);
  const receipt = await submitted.json();
  const checks = challengeCalls;
  expect((await post(path, input)).status).toBe(202);
  expect(challengeCalls).toBe(checks);
  await drainSalesWorkspace(env, workspace);
  expect(mail).toHaveLength(1);
  expect(mail[0].to).toBe(input.email);
  const verifyUrl = mail[0].text.match(
    /https:\/\/inquiry\.fixture\.invalid\/w\/[a-f0-9-]+\/i\/[A-Za-z0-9_-]+/,
  )[0];
  expect((await app.request(verifyUrl, {}, tenantEnv)).status).toBe(200);
  expect((await inbox.lead(receipt.id)).verification).toBe('pending');
  for (let n = 0; n < 2; n++)
    expect(
      (
        await app.request(
          verifyUrl + '/confirm',
          { method: 'POST', headers: { Origin: origin } },
          tenantEnv,
        )
      ).status,
    ).toBe(200);
  await drainSalesWorkspace(env, workspace);
  expect(mail).toHaveLength(2);
  expect(mail[1].to).toBe('owner@fixture.invalid');
  let lead = await inbox.lead(receipt.id);
  await inbox.message(lead.id, {
    direction: 'private-note',
    body: 'PRIVATE_NOTE_SENTINEL',
    revision: lead.revision,
    idempotencyKey: crypto.randomUUID(),
  });
  lead = await inbox.lead(receipt.id);
  await inbox.message(lead.id, {
    direction: 'reply',
    body: 'Synthetic owner reply.',
    revision: lead.revision,
    idempotencyKey: crypto.randomUUID(),
  });
  await drainSalesWorkspace(env, workspace);
  expect(mail).toHaveLength(3);
  expect(mail[2].to).toBe(input.email);
  expect(mail[2].text).not.toContain('PRIVATE_NOTE_SENTINEL');
  const threadUrl = mail[2].text.match(
    /https:\/\/inquiry\.fixture\.invalid\/w\/[a-f0-9-]+\/t\/[A-Za-z0-9_-]+/,
  )[0];
  const thread = await (await app.request(threadUrl, {}, tenantEnv)).text();
  expect(thread).toContain('Synthetic owner reply.');
  expect(thread).not.toContain('PRIVATE_NOTE_SENTINEL');
  const body = new URLSearchParams({
    body: 'Synthetic sender follow-up.',
    idempotencyKey: crypto.randomUUID(),
  });
  for (let n = 0; n < 2; n++)
    expect(
      (
        await app.request(
          threadUrl + '/messages',
          {
            method: 'POST',
            headers: {
              Origin: origin,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body,
          },
          tenantEnv,
        )
      ).status,
    ).toBe(303);
  expect(
    (await inbox.thread(lead.id)).messages.filter(
      (m) => m.body === 'Synthetic sender follow-up.',
    ),
  ).toHaveLength(1);
  for (let n = 0; n < 2; n++)
    expect((await post(path, input)).status).toBe(202);
  expect((await post(path, input)).status).toBe(429);
  const next = { ...input, idempotencyKey: crypto.randomUUID() };
  expect((await post(path, next, '192.0.2.2')).status).toBe(202);
  failMail = true;
  await drainSalesWorkspace(env, workspace);
  const sent = mail.length;
  await drainSalesWorkspace(env, workspace);
  expect(mail).toHaveLength(sent);
  expect(
    Number(
      await control
        .prepare(
          "SELECT count(*) n FROM sales_delivery_receipts WHERE state='unknown'",
        )
        .first('n'),
    ),
  ).toBeGreaterThan(0);
}, 15000);
