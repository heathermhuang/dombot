// Disposable non-production D1 databases and captured mail only. No import QA lease.
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readdirSync, readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { sqlStatements } from './prepare-on-demand.mjs';
import { SalesStore, readPublicSale } from '../src/worker/sales-store';
import { SalesInquiryStore } from '../src/worker/sales-inquiry-store';
import { createPublicSalesRoutes } from '../src/worker/public-sales';
import gateway from '../src/hosted/gateway';
import {
  exportSales,
  restoreSales,
  salesBackupSchema,
} from '../src/worker/sales-backup';
import { createSalesInternalRoutes } from '../src/worker/sales-internal';
import { emptySale } from '../src/shared/hosted-sales';
import { sourcePriceFingerprint } from '../src/core/publication/sales';
import { MemoryDocStore } from '../src/core/storage/doc-store';
import { configureStore, hydrateStores } from '../src/core/storage/namespace';
import {
  drainSalesWorkspace,
  salesRecipientHash,
} from '../src/hosted/sales-notifications';
let mf, db, control, unlisted;
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      modules: true,
      script: 'export default {fetch(){return new Response("fixture")}}',
      d1Databases: {
        DB: 'inquiry-local',
        CONTROL: 'inquiry-control-local',
        UNLISTED: 'unlisted-local',
      },
      outboundService: () => {
        throw Error('External access forbidden');
      },
    }),
  );
  db = await mf.getD1Database('DB');
  control = await mf.getD1Database('CONTROL');
  unlisted = await mf.getD1Database('UNLISTED');
  for (const [directory, target] of [
    ['migrations', db],
    ['hosted/migrations', control],
    ['migrations', unlisted],
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
  const confirm = () =>
    app.request(
      verifyUrl + '/confirm',
      { method: 'POST', headers: { Origin: origin } },
      tenantEnv,
    );
  const confirmations = await Promise.all([confirm(), confirm()]);
  expect(confirmations.map((response) => response.status)).toEqual([303, 303]);
  const firstThreadPath = confirmations[0].headers.get('Location');
  expect(firstThreadPath).toMatch(/^\/w\/[a-f0-9-]+\/t\/[A-Za-z0-9_-]+$/);
  expect(confirmations[1].headers.get('Location')).toBe(firstThreadPath);
  const firstThreadUrl = new URL(firstThreadPath, origin).href;
  expect(
    await (await app.request(firstThreadUrl, {}, tenantEnv)).text(),
  ).toContain('Awaiting seller review');
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
  for (const url of [firstThreadUrl, threadUrl]) {
    const thread = await (await app.request(url, {}, tenantEnv)).text();
    expect(thread).toContain('Synthetic owner reply.');
    expect(thread).toContain('Seller replied');
    expect(thread).not.toContain('PRIVATE_NOTE_SENTINEL');
  }
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

async function qualifyUnlisted(environment) {
  configureStore(new MemoryDocStore());
  await hydrateStores();
  const workspace = crypto.randomUUID(),
    reviewer = crypto.randomUUID();
  const other = crypto.randomUUID();
  const key = 'synthetic-unlisted-gateway'.repeat(3);
  const production = environment === 'production origin';
  const origin = production
    ? 'https://domains.domains'
    : 'https://domains-intake-qa-abcdef01.fixture.workers.dev';
  const reviewerBinding = production
    ? 'OFF_MARKET_PRODUCTION_REVIEWER'
    : 'OFF_MARKET_STAGING_REVIEWER';
  const buyer = 'unlisted-buyer@fixture.invalid';
  const owner = `unlisted-reviewer-${reviewer}@fixture.invalid`;
  const tenantEnv = {
    DB: unlisted,
    DOMBOT_SECRET: btoa('u'.repeat(32)),
    DOMBOT_GATEWAY_SECRET: key,
    DOMBOT_WORKSPACE_ID: workspace,
    DOMBOT_AUTH: 'gateway',
    DOMBOT_SALES_ORIGIN: origin + '/w/' + workspace,
    DOMBOT_PUBLIC_BASE_PATH: '/w/' + workspace,
    SALES_INQUIRIES_ENABLED: 'true',
    SALES_PRIVACY_REVIEWED: 'true',
    SALES_TURNSTILE_SECRET: 'synthetic-only',
    SALES_TURNSTILE_SITEKEY: 'synthetic-only',
    SALES_MAIL_ENABLED: 'true',
  };
  const sales = await SalesStore.from(tenantEnv);
  const inbox = new SalesInquiryStore(sales, tenantEnv.DOMBOT_SALES_ORIGIN);
  const saved = emptySale('private-fixture.example', 'private fixture');
  await sales.save(saved, null);
  const app = new Hono();
  app.route('/sales-internal', createSalesInternalRoutes());
  app.route('/', createPublicSalesRoutes());
  const mail = [];
  const env = {
    CONTROL_DB: control,
    AUTH_PEPPER: 'synthetic-intake-pepper'.repeat(3),
    CANONICAL_ORIGIN: origin,
    [reviewerBinding]: reviewer,
    OFF_MARKET_STAGING_BUYER_EMAIL: production ? undefined : buyer,
    PUBLIC_REGISTRATION_ENABLED: 'false',
    WORKSPACES: JSON.stringify([
      {
        id: workspace,
        label: 'Controlled local reviewer',
        binding: 'WORKSPACE_0',
      },
      { id: other, label: 'Other test account', binding: 'WORKSPACE_1' },
    ]),
    GATEWAY_KEYS: JSON.stringify({
      [workspace]: key,
      [other]: key + '-other',
    }),
    WORKSPACE_0: { fetch: (r) => app.fetch(r, tenantEnv) },
    WORKSPACE_1: {
      fetch: (r) =>
        app.fetch(r, {
          ...tenantEnv,
          DB: db,
          DOMBOT_WORKSPACE_ID: other,
          DOMBOT_GATEWAY_SECRET: key + '-other',
        }),
    },
    SALES_MAIL_ENABLED: 'true',
    SALES_MAIL_DELIVERY_VERIFIED: 'true',
    SALES_EMAIL_FROM: 'sales@mail.domains.domains',
    SALES_MAIL_DAILY_LIMIT: '100',
    SALES_MAIL_MONTHLY_LIMIT: '1000',
    SALES_EMAIL: {
      send: async (message) => {
        mail.push(message);
        return { messageId: 'unlisted-capture-' + mail.length };
      },
    },
  };
  await control.batch([
    ...[workspace, other].map((id) =>
      control
        .prepare('INSERT INTO workspaces(id,label) VALUES(?,?)')
        .bind(id, 'Local qualification'),
    ),
    control
      .prepare(
        'INSERT INTO users(id,email,workspace_id,password_hash,created_at) VALUES(?,?,?,?,?)',
      )
      .bind(reviewer, owner, workspace, 'fixture-only', Date.now()),
    control
      .prepare(
        'INSERT INTO sales_verified_recipients(workspace_id,email_hash,verified_at) VALUES(?,?,?)',
      )
      .bind(workspace, salesRecipientHash(env, owner), Date.now()),
  ]);
  vi.stubGlobal('fetch', async (url) => {
    expect(String(url)).toBe(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    );
    return Response.json({
      success: true,
      hostname: new URL(origin).hostname,
      action: 'sales-inquiry',
    });
  });
  const send = (path, options = {}, bindings = env) =>
    gateway.fetch(new Request(origin + path, options), bindings);
  const get = (path) => send(path);
  const input = {
    idempotencyKey: crypto.randomUUID(),
    domain: 'private-fixture.example',
    name: 'Synthetic inquirer',
    email: buyer,
    message: 'Private synthetic request.',
    turnstileToken: 'fixture-only',
    website: '',
  };
  const post = (path, data = input, caller = origin) =>
    send(path, {
      method: 'POST',
      headers: {
        Origin: caller,
        'Content-Type': 'application/json',
        'cf-connecting-ip': '192.0.2.47',
      },
      body: JSON.stringify(data),
    });
  const requestPath = '/request-domain';
  try {
    expect(
      (await send(requestPath, {}, { ...env, [reviewerBinding]: undefined }))
        .status,
    ).toBe(404);
    const form = await get(requestPath);
    expect(form.status).toBe(200);
    expect(await form.text()).not.toContain(saved.domain);
    expect(
      (await post(requestPath, input, 'https://other.example')).status,
    ).toBe(403);
    if (production) {
      expect(
        (
          await send(
            requestPath,
            {},
            {
              ...env,
              OFF_MARKET_PRODUCTION_REVIEWER: undefined,
              OFF_MARKET_STAGING_REVIEWER: reviewer,
              OFF_MARKET_STAGING_BUYER_EMAIL: buyer,
            },
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await send(
            requestPath,
            {},
            {
              ...env,
              OFF_MARKET_PRODUCTION_REVIEWER: other,
            },
          )
        ).status,
      ).toBe(404);
    } else {
      expect(
        (
          await post(requestPath, {
            ...input,
            email: 'outside@fixture.invalid',
          })
        ).status,
      ).toBe(404);
    }
    expect((await get('/w/' + other + requestPath)).status).toBe(404);
    const receipt = await post(requestPath);
    expect(receipt.status).toBe(202);
    const { id } = await receipt.json();
    expect(await (await post(requestPath)).json()).toMatchObject({ id });
    expect(
      (await post(requestPath, { ...input, domain: 'other.example' })).status,
    ).toBe(409);
    const raw = await unlisted
      .prepare('SELECT listing_id,sealed FROM sales_leads WHERE id=?')
      .bind(id)
      .first();
    expect(raw.listing_id).toBeNull();
    expect(raw.sealed).not.toContain(input.domain);
    expect(
      await unlisted
        .prepare('SELECT count(*) AS n FROM sales_leads')
        .first('n'),
    ).toBe(1);
    await drainSalesWorkspace(env, workspace);
    expect(mail.map((message) => message.to)).toEqual([buyer]);
    const verification = new URL(
      mail[0].text.match(/https:\/\/[^\s]+\/i\/[A-Za-z0-9_-]{43}/)[0],
    );
    expect((await get(verification.pathname)).status).toBe(200);
    const confirm = () =>
      send(verification.pathname + '/confirm', {
        method: 'POST',
        headers: { Origin: origin },
      });
    const confirmed = await Promise.all([confirm(), confirm()]);
    expect(confirmed.map((response) => response.status)).toEqual([303, 303]);
    const thread = confirmed[0].headers.get('Location');
    expect(confirmed[1].headers.get('Location')).toBe(thread);
    expect((await get(thread.replace(workspace, other))).status).toBe(403);
    expect(await (await get(thread)).text()).toContain(input.message);
    const cases = (await inbox.list()).items;
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      id,
      domain: input.domain,
      verification: 'verified',
      kind: 'unlisted-domain',
    });
    const reply = 'Synthetic reviewer reply.';
    await inbox.message(id, {
      direction: 'reply',
      body: reply,
      revision: cases[0].revision,
      idempotencyKey: crypto.randomUUID(),
    });
    await drainSalesWorkspace(env, workspace);
    expect(mail.map((message) => message.to)).toEqual([buyer, owner, buyer]);
    expect(await (await get(thread)).text()).toContain(reply);
    await inbox.freshLink(id);
    await drainSalesWorkspace(env, workspace);
    const renewed = new URL(
      mail.at(-1).text.match(/https:\/\/[^\s]+\/t\/[A-Za-z0-9_-]{43}/)[0],
    ).pathname;
    expect(renewed).not.toBe(thread);
    expect((await get(thread)).status).toBe(403);
    expect(await (await get(renewed)).text()).toContain(reply);
    const backup = await exportSales(sales);
    expect(backup).toMatchObject({
      version: 7,
      leads: [
        {
          id,
          listingId: null,
          payload: {
            snapshot: { kind: 'unlisted-domain', domain: input.domain },
          },
        },
      ],
    });
    expect(salesBackupSchema.safeParse({ ...backup, version: 6 }).success).toBe(
      false,
    );
    const current = await inbox.lead(id);
    await inbox.update(id, current.revision, 'spam', null);
    expect((await get(renewed)).status).toBe(403);
    expect(
      (
        await post(requestPath, {
          ...input,
          idempotencyKey: crypto.randomUUID(),
        })
      ).status,
    ).toBe(503);
    await inbox.remove(id, (await inbox.lead(id)).revision);
    for (const table of [
      'sales_leads',
      'sales_messages',
      'sales_tokens',
      'sales_outbox',
    ])
      expect(
        await unlisted.prepare('SELECT count(*) AS n FROM ' + table).first('n'),
      ).toBe(0);
    await restoreSales(sales, backup);
    expect((await inbox.lead(id)).verification).toBe('expired');
    expect((await inbox.thread(id)).messages[0].body).toBe(reply);
    expect(
      await unlisted
        .prepare('SELECT count(*) AS n FROM sales_tokens')
        .first('n'),
    ).toBe(0);
  } finally {
    await unlisted.batch([
      ...['sales_leads', 'sales_suppression', 'sale_drafts'].map((table) =>
        unlisted.prepare('DELETE FROM ' + table),
      ),
      unlisted.prepare('DELETE FROM sales_events'),
    ]);
    expect(
      await unlisted
        .prepare('SELECT count(*) AS n FROM sales_leads')
        .first('n'),
    ).toBe(0);
    vi.unstubAllGlobals();
  }
}

it.each(['isolated staging', 'production origin'])(
  'accepts one private unlisted-domain case in the %s queue and preserves the verified conversation',
  qualifyUnlisted,
  20000,
);
