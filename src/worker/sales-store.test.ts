import { MemoryDocStore } from '../core/storage/doc-store';
import { configureStore, hydrateStores } from '../core/storage/namespace';
import { readFileSync } from 'node:fs';
import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import {
  SalesStore,
  readPublicSale,
  type SaleObservation,
} from './sales-store';
import { SalesInquiryStore } from './sales-inquiry-store';
import {
  emptySale,
  publishedSaleSchema,
  type SaleInquiry,
} from '../shared/sales';
import { sourcePriceFingerprint } from '../core/publication/sales';
import { exportSales, restoreSales, salesBackupSchema } from './sales-backup';
import { SalesJobs } from './sales-jobs';
import { createPublicSalesRoutes } from './public-sales';
import { Hono } from 'hono';
import { renderSalesLander } from '../shared/render-sales-lander';
import { signGatewayRequest } from '../shared/gateway-proof';
import { parseBundle } from '../core/storage/bundle';
import { createSalesInternalRoutes } from './sales-internal';
import { createSalesRoutes } from './sales-routes';
import { buildAuthConfig, type AuthConfig } from './auth';
import { publicShop, publicSalesCsv } from './sales-shop';

let mf: Miniflare, db: D1Database, store: SalesStore, inbox: SalesInquiryStore;
const root = new Uint8Array(32).fill(9);
const price = {
  amount: '14800',
  currency: 'USD',
  updatedAt: 100,
  floor: 'SECRET_FLOOR',
};
const observation = (): SaleObservation => ({
  price,
  ownershipFingerprint: 'owned-by-fixture',
  controlExpiresAt: Date.now() + 3600_000,
  available: true,
  reason: null,
});
const input = (): SaleInquiry => ({
  idempotencyKey: crypto.randomUUID(),
  observedRevision: crypto.randomUUID(),
  name: 'Sample Buyer',
  email: 'buyer@example.com',
  offer: null,
  message: 'Sample inquiry',
  turnstileToken: 'test-only',
  website: '',
});
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'sales-test',
          modules: true,
          script: 'export default {fetch(){return new Response("ok")}}',
          compatibilityDate: '2026-10-08',
          d1Databases: ['DB'],
        },
      ],
    }),
  );
  db = await mf.getD1Database('DB');
  for (const file of ['0004_sales.sql', '0005_sales_inquiries.sql'])
    await db.exec(
      readFileSync(`migrations/${file}`, 'utf8')
        .replace(/^--.*$/gm, '')
        .replace(/\n/g, ' '),
    );
  store = await SalesStore.from({
    DB: db,
    DOMBOT_SECRET: btoa(String.fromCharCode(...root)),
  });
  inbox = new SalesInquiryStore(store, 'https://host.example/w/fixture');
}, 30_000);
afterAll(async () => mf?.dispose());
beforeEach(async () => {
  await db.batch(
    [
      'sales_events',
      'sales_leads',
      'sales_reviews',
      'sales_shop_reviews',
      'sales_jobs',
      'sales_host_bindings',
      'sales_suppression',
      'sales_shop',
      'sale_drafts',
      'sale_destinations',
      'sales_abuse',
    ].map((t) => db.prepare(`DELETE FROM ${t}`)),
  );
});
async function live(name = 'fixture.example') {
  const draft = emptySale(name, sourcePriceFingerprint(price));
  const revision = await store.save(draft, null);
  const review = await store.prepare([{ id: draft.id, revision }], observation);
  await store.publish(review.id, observation);
  return (await readPublicSale(db, name))!;
}
describe('sales transaction and privacy boundary', () => {
  it('keeps drafts encrypted and publishes only explicit allowlisted snapshots', async () => {
    const snapshot = await live();
    expect(JSON.stringify(snapshot)).not.toContain('SECRET_FLOOR');
    expect(
      publishedSaleSchema.safeParse({ ...snapshot, floor: 'private' }).success,
    ).toBe(false);
    const raw = await db.prepare('SELECT * FROM sale_drafts').first();
    expect(JSON.stringify(raw)).not.toContain('fixture.example');
    expect(JSON.stringify(raw)).not.toContain('owned-by-fixture');
  });
  it('rejects stale reviews and leaves every item unchanged after a zero-row CAS', async () => {
    const a = emptySale('one.example', sourcePriceFingerprint(price)),
      b = emptySale('two.example', sourcePriceFingerprint(price));
    const ar = await store.save(a, null),
      br = await store.save(b, null);
    const review = await store.prepare(
      [
        { id: a.id, revision: ar },
        { id: b.id, revision: br },
      ],
      observation,
    );
    await store.save({ ...b, description: 'Changed elsewhere' }, br);
    await expect(store.publish(review.id, observation)).rejects.toThrow();
    expect(
      (await db
        .prepare('SELECT count(*) AS n FROM published_sales')
        .first<{ n: number }>())!.n,
    ).toBe(0);
    await expect(
      store.atomic([
        db
          .prepare("UPDATE sale_drafts SET availability='sold' WHERE id=?")
          .bind(a.id),
        ...store.guard(
          'EXISTS(SELECT 1 FROM sale_drafts WHERE id=? AND revision=?)',
          [b.id, br],
        ),
      ]),
    ).rejects.toThrow();
    expect((await store.get(a.id)).availability).toBe('paused');
  });
  it('rejects changed source prices and replays a committed receipt without republishing', async () => {
    const draft = emptySale('fixture.example', sourcePriceFingerprint(price)),
      revision = await store.save(draft, null);
    const review = await store.prepare(
      [{ id: draft.id, revision }],
      observation,
    );
    await expect(
      store.publish(review.id, () => ({
        ...observation(),
        price: { ...price, amount: '20000' },
      })),
    ).rejects.toThrow();
    const receipt = await store.publish(review.id, observation);
    expect(await store.publish(review.id, observation)).toEqual(receipt);
  });
  it('pause and expired control suppress public reads immediately', async () => {
    const p = await live(),
      saved = await store.get(p.id);
    await store.availability(p.id, saved.operationalRevision, 'paused');
    expect(await readPublicSale(db, p.domain)).toBeNull();
    await db
      .prepare(
        "UPDATE sale_drafts SET availability='available',control_expires_at=0",
      )
      .run();
    expect(await readPublicSale(db, p.domain)).toBeNull();
  });
});
describe('durable inquiry and outbox', () => {
  it('deduplicates requests, binds their content and seals buyer PII', async () => {
    const p = await live(),
      v = { ...input(), observedRevision: p.revision };
    const a = await inbox.intake(v, p),
      b = await inbox.intake(v, p);
    expect(a).toEqual(b);
    await expect(
      inbox.intake({ ...v, message: 'different' }, p),
    ).rejects.toThrow();
    expect(
      JSON.stringify(await db.prepare('SELECT * FROM sales_leads').all()),
    ).not.toContain('buyer@example.com');
    expect(
      (await db
        .prepare('SELECT count(*) AS n FROM sales_outbox')
        .first<{ n: number }>())!.n,
    ).toBe(1);
  });
  it('GET-style token inspection cannot verify; confirmation enqueues one seller notification', async () => {
    const p = await live(),
      r = await inbox.intake({ ...input(), observedRevision: p.revision }, p);
    const [mail] = await inbox.lease();
    const raw = mail.mail.url.split('/').at(-1)!;
    expect((await inbox.token(raw, 'verify'))!.consumed_at).toBeNull();
    expect((await inbox.lead(r.id)).verification).toBe('pending');
    await inbox.confirm(raw);
    await inbox.confirm(raw);
    expect((await inbox.lead(r.id)).verification).toBe('verified');
    expect(
      (await inbox.lease()).filter((v) => v.kind === 'seller-alert'),
    ).toHaveLength(1);
  });
  it('two drainers cannot share a lease, expired sends become unknown, stale ACK fails', async () => {
    const p = await live();
    await inbox.intake({ ...input(), observedRevision: p.revision }, p);
    const [a, b] = await Promise.all([inbox.lease(), inbox.lease()]);
    expect(a.length + b.length).toBe(1);
    const item = [...a, ...b][0];
    await db.prepare('UPDATE sales_outbox SET lease_expires_at=0').run();
    expect(await inbox.lease()).toHaveLength(0);
    await expect(
      inbox.ack(item.id, item.lease, 'accepted', 'receipt'),
    ).rejects.toThrow();
    expect(
      (await db
        .prepare('SELECT state FROM sales_outbox')
        .first<{ state: string }>())!.state,
    ).toBe('unknown');
  });
  it('claims each send once and rejects cached leases after spam, deletion or expiry', async () => {
    const p = await live();
    const first = await inbox.intake(
      { ...input(), observedRevision: p.revision },
      p,
    );
    const [mail] = await inbox.lease();
    const lead = await inbox.lead(first.id);
    await inbox.update(first.id, lead.revision, 'spam', null);
    expect(await inbox.claim(mail.id, mail.lease)).toBe(false);
    const reopened = await inbox.lead(first.id);
    await inbox.update(first.id, reopened.revision, 'new', null);
    await inbox.freshLink(first.id);
    const [fresh] = await inbox.lease();
    expect(await inbox.claim(fresh.id, fresh.lease)).toBe(true);
    expect(await inbox.claim(fresh.id, fresh.lease)).toBe(false);
    await inbox.freshLink(first.id);
    const [expired] = await inbox.lease();
    await db
      .prepare('UPDATE sales_outbox SET lease_expires_at=0 WHERE id=?')
      .bind(expired.id)
      .run();
    expect(await inbox.claim(expired.id, expired.lease)).toBe(false);
    await inbox.freshLink(first.id);
    const [removed] = await inbox.lease();
    await inbox.remove(first.id, (await inbox.lead(first.id)).revision);
    expect(await inbox.claim(removed.id, removed.lease)).toBe(false);
  });
  it('fresh-link recovery cancels only unsent obsolete links and preserves unknown delivery evidence', async () => {
    const p = await live(),
      r = await inbox.intake({ ...input(), observedRevision: p.revision }, p),
      [old] = await inbox.lease();
    await inbox.ack(old.id, old.lease, 'retryable', null);
    await inbox.freshLink(r.id);
    expect(
      (await db
        .prepare('SELECT state FROM sales_outbox WHERE id=?')
        .bind(old.id)
        .first<{ state: string }>())!.state,
    ).toBe('suppressed');
    expect(await inbox.claim(old.id, old.lease)).toBe(false);
    const [fresh] = await inbox.lease();
    await inbox.ack(fresh.id, fresh.lease, 'unknown', null);
    await inbox.freshLink(r.id);
    expect(
      (await db
        .prepare('SELECT state FROM sales_outbox WHERE id=?')
        .bind(fresh.id)
        .first<{ state: string }>())!.state,
    ).toBe('unknown');
    expect(await inbox.lease()).toHaveLength(1);
  });
  it('private notes never reach the buyer and reply tokens are purpose-bound', async () => {
    const p = await live(),
      r = await inbox.intake({ ...input(), observedRevision: p.revision }, p);
    const [mail] = await inbox.lease(),
      raw = mail.mail.url.split('/').at(-1)!;
    await inbox.confirm(raw);
    const lead = await inbox.lead(r.id);
    await inbox.message(r.id, {
      direction: 'private-note',
      body: 'PRIVATE_NOTE_SENTINEL',
      revision: lead.revision,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(JSON.stringify(await inbox.thread(r.id, true))).not.toContain(
      'PRIVATE_NOTE_SENTINEL',
    );
    expect(JSON.stringify(await inbox.thread(r.id))).toContain(
      'PRIVATE_NOTE_SENTINEL',
    );
    expect(await inbox.token(raw, 'thread')).toBeNull();
  });
});

describe('backup, jobs and public HTTP', () => {
  it('rotates keys, restores private data silently, and removes all capabilities and delivery intents', async () => {
    const p = await live(),
      r = await inbox.intake({ ...input(), observedRevision: p.revision }, p);
    const backup = await exportSales(store);
    const other = await SalesStore.from({
      DB: db,
      DOMBOT_SECRET: btoa(String.fromCharCode(...new Uint8Array(32).fill(17))),
    });
    await restoreSales(other, backup);
    expect(await readPublicSale(db, p.domain)).toBeNull();
    expect((await other.get(p.id)).availability).toBe('paused');
    const restored = new SalesInquiryStore(other, 'https://host.example');
    expect((await restored.lead(r.id)).payload.email).toBe('buyer@example.com');
    expect(await restored.lease()).toHaveLength(0);
    expect(
      (await db
        .prepare('SELECT count(*) AS n FROM sales_tokens')
        .first<{ n: number }>())!.n,
    ).toBe(0);
    expect(
      salesBackupSchema.safeParse({
        ...backup,
        leads: [{ ...backup.leads[0], payload: { email: 'bad' } }],
      }).success,
    ).toBe(false);
    expect(() =>
      parseBundle(
        JSON.stringify({
          format: 'dombot-data',
          version: 9,
          namespaces: {},
          sales: backup,
        }),
      ),
    ).toThrow(/hosted sales/);
    // Return the normal root for the next test; previous rows are removed in beforeEach.
  });
  it('resumes only pending bulk items and retains a stale-item receipt', async () => {
    const a = emptySale('a.example', sourcePriceFingerprint(price)),
      b = emptySale('b.example', sourcePriceFingerprint(price));
    const ar = await store.save(a, null),
      br = await store.save(b, null),
      jobs = new SalesJobs(store);
    const job = await jobs.create(
      [
        { id: a.id, revision: ar },
        { id: b.id, revision: br },
      ],
      { kind: 'shop', include: true },
      crypto.randomUUID(),
    );
    await store.save({ ...b, description: 'changed' }, br);
    const first = await jobs.step(job.id, observation),
      saved = await store.get(a.id);
    expect(first.counts).toEqual(
      expect.arrayContaining([
        { state: 'complete', count: 1 },
        { state: 'needs-review', count: 1 },
      ]),
    );
    await jobs.step(job.id, observation);
    expect((await store.get(a.id)).revision).toBe(saved.revision);
    expect(saved.draft.includeInShop).toBe(true);
  });
  it('serves landers without the root key and blocks mismatched signed hostname epochs', async () => {
    const p = await live(),
      app = new Hono<{ Bindings: Env }>();
    app.route('/', createPublicSalesRoutes());
    const publicResponse = await app.request(
      `https://host.example/d/${p.domain}`,
      {},
      { DB: db, DOMBOT_AUTH: 'password' } as Env,
    );
    expect(publicResponse.status).toBe(200);
    const html = await publicResponse.text();
    expect(html).not.toContain('SECRET_FLOOR');
    const form = renderSalesLander(p, '', 'test-sitekey', {
      privacyUrl: 'https://accounts.example/privacy',
      inquiryPath: '/inquiries',
    });
    expect(form).toContain('href="https://accounts.example/privacy"');
    expect(form).toContain('action="/inquiries"');
    expect(html).toContain('domains.domains');
    const key = 'test-edge-secret-for-sales'.repeat(3),
      workspace = crypto.randomUUID();
    const request = new Request(`https://fixture.example/d/${p.domain}`);
    request.headers.set(
      'x-dombot-gateway-proof',
      await signGatewayRequest(key, workspace, null, request, {
        purpose: 'sales-public',
        host: 'fixture.example',
        listing: p.id,
        epoch: 1,
      }),
    );
    await db
      .prepare(
        'INSERT INTO sales_host_bindings(hostname,listing_id,epoch,enabled) VALUES(?,?,2,1)',
      )
      .bind('fixture.example', p.id)
      .run();
    expect(
      (
        await app.request(request, undefined, {
          DB: db,
          DOMBOT_AUTH: 'gateway',
          DOMBOT_SALES_EDGE_SECRET: key,
          DOMBOT_WORKSPACE_ID: workspace,
        } as Env)
      ).status,
    ).toBe(404);
  });
  it('returns current public terms and preserves buyer fields when a publication changes', async () => {
    const p = await live(),
      app = createPublicSalesRoutes();
    const response = await app.request(
      `https://fixture.example/d/${p.domain}/inquiries`,
      {
        method: 'POST',
        headers: {
          Origin: 'https://fixture.example',
          'Content-Type': 'application/x-www-form-urlencoded',
          'cf-connecting-ip': '192.0.2.1',
        },
        body: new URLSearchParams({
          observedRevision: crypto.randomUUID(),
          idempotencyKey: crypto.randomUUID(),
          name: 'Preserved Buyer',
          email: 'buyer@example.com',
          message: 'Preserved message',
          website: '',
          'cf-turnstile-response': '',
        }),
      },
      {
        DB: db,
        DOMBOT_SECRET: btoa(String.fromCharCode(...root)),
        SALES_INQUIRIES_ENABLED: 'true',
        SALES_PRIVACY_REVIEWED: 'true',
        SALES_TURNSTILE_SECRET: 'fixture-only',
        SALES_TURNSTILE_SITEKEY: 'fixture-sitekey',
        DOMBOT_SALES_ORIGIN: 'https://fixture.example',
      } as Env,
    );
    expect(response.status).toBe(409);
    const html = await response.text();
    expect(html).toContain('Preserved Buyer');
    expect(html).toContain('Preserved message');
    expect(html).toContain(p.revision);
    expect(html).toContain('terms changed');
    expect(
      (await db
        .prepare('SELECT count(*) AS n FROM sales_leads')
        .first<{ n: number }>())!.n,
    ).toBe(0);
  });
  it('escapes buyer-facing content, never embeds notes, and retains public schema strictness', async () => {
    const p = await live();
    const html = renderSalesLander(
      { ...p, description: '<script>private-sentinel</script>' },
      '',
      null,
    );
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>private-sentinel');
    expect(html).not.toContain('SECRET_FLOOR');
  });
});

describe('sales recovery and isolation regressions', () => {
  async function verifiedLead() {
    const p = await live(),
      receipt = await inbox.intake(
        { ...input(), observedRevision: p.revision },
        p,
      );
    const [mail] = await inbox.lease();
    await inbox.confirm(mail.mail.url.split('/').at(-1)!);
    return { p, id: receipt.id };
  }
  it('requires fresh buyer confirmation after restoring a verified conversation', async () => {
    const { id } = await verifiedLead(),
      backup = await exportSales(store);
    await restoreSales(store, backup);
    const lead = await inbox.lead(id);
    expect(lead.verification).toBe('expired');
    await expect(
      inbox.message(id, {
        direction: 'reply',
        body: 'Must not send',
        revision: lead.revision,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toThrow(/verified/);
    await inbox.freshLink(id);
    expect((await inbox.lease())[0].kind).toBe('verification');
  });
  it('rekeys a blocked-recipient lookup even after its inquiry was deleted', async () => {
    const p = await live(),
      r = await inbox.intake({ ...input(), observedRevision: p.revision }, p),
      lead = await inbox.lead(r.id);
    await inbox.update(r.id, lead.revision, 'spam', null);
    await inbox.remove(r.id, (await inbox.lead(r.id)).revision);
    const before = (await db
      .prepare('SELECT email_hash,sealed FROM sales_suppression')
      .first<{ email_hash: string; sealed: string }>())!;
    expect(JSON.stringify(before)).not.toContain('buyer@example.com');
    const backup = await exportSales(store),
      other = await SalesStore.from({
        DB: db,
        DOMBOT_SECRET: btoa(String.fromCharCode(...new Uint8Array(32).fill(4))),
      });
    await restoreSales(other, backup);
    expect(
      await new SalesInquiryStore(other, 'https://fixture.example').suppressed(
        'buyer@example.com',
      ),
    ).toBe(true);
    expect(
      (await db
        .prepare('SELECT email_hash FROM sales_suppression')
        .first<{ email_hash: string }>())!.email_hash,
    ).not.toBe(before.email_hash);
  });
  it('retention erases messages, grants, outbox and outcome evidence together', async () => {
    const p = await live(),
      r = await inbox.intake({ ...input(), observedRevision: p.revision }, p),
      lead = await inbox.lead(r.id);
    await inbox.update(r.id, lead.revision, 'new', null, {
      state: 'handed-off',
      source: 'seller-entered',
      evidence: 'PRIVATE_EVIDENCE',
      price: null,
      provider: 'Manual',
    });
    await db
      .prepare('UPDATE sales_leads SET created_at=? WHERE id=?')
      .bind(Date.now() - 8 * 86400000, r.id)
      .run();
    await inbox.cleanup();
    for (const table of [
      'sales_leads',
      'sales_messages',
      'sales_tokens',
      'sales_outbox',
    ])
      expect(
        (await db
          .prepare(`SELECT count(*) AS n FROM ${table}`)
          .first<{ n: number }>())!.n,
      ).toBe(0);
    expect(
      (await db
        .prepare('SELECT count(*) AS n FROM sales_events WHERE lead_id=?')
        .bind(r.id)
        .first<{ n: number }>())!.n,
    ).toBe(0);
  });
  it('message pages are chronological, opaque, and cannot expose notes through an owner cursor', async () => {
    const { id } = await verifiedLead();
    const writes = [];
    for (let sequence = 1; sequence <= 107; sequence++)
      writes.push(
        db
          .prepare(
            'INSERT INTO sales_messages(id,lead_id,request_hash,payload_hash,direction,created_at,sealed,sequence) VALUES(?,?,?,?,?,?,?,?)',
          )
          .bind(
            crypto.randomUUID(),
            id,
            `fixture-${sequence}`,
            'fixture',
            sequence === 50 || sequence === 100 ? 'private-note' : 'buyer',
            Date.now(),
            await store.seal({
              body:
                sequence === 50 || sequence === 100
                  ? 'PRIVATE_NOTE_SENTINEL'
                  : `Message ${sequence}`,
              recipient: null,
            }),
            sequence,
          ),
      );
    await db.batch(writes);
    const buyer = await inbox.thread(id, true);
    expect(buyer.messages[0].body).toBe('Message 6');
    expect(buyer.messages.at(-1)!.body).toBe('Message 107');
    expect(JSON.stringify(buyer)).not.toContain('PRIVATE_NOTE_SENTINEL');
    expect(buyer.messages[0]).not.toHaveProperty('sequence');
    const older = await inbox.thread(id, true, buyer.cursor!);
    expect(older.messages.map((m) => m.body)).toEqual([
      'Message 1',
      'Message 2',
      'Message 3',
      'Message 4',
      'Message 5',
    ]);
    const owner = await inbox.thread(id);
    await expect(inbox.thread(id, true, owner.cursor!)).rejects.toThrow(
      /cursor/,
    );
  });
  it('due-work discovery includes expired orphan leases', async () => {
    const p = await live();
    await inbox.intake({ ...input(), observedRevision: p.revision }, p);
    await inbox.lease();
    await db.prepare('UPDATE sales_outbox SET lease_expires_at=1').run();
    const key = 'internal-fixture-key'.repeat(3),
      workspace = crypto.randomUUID(),
      app = new Hono<{ Bindings: Env }>();
    app.route('/sales-internal', createSalesInternalRoutes());
    const request = new Request('https://fixture.example/sales-internal/due');
    request.headers.set(
      'x-dombot-gateway-proof',
      await signGatewayRequest(key, workspace, null, request, {
        purpose: 'sales-notifications',
      }),
    );
    const response = await app.request(request, undefined, {
      DB: db,
      DOMBOT_GATEWAY_SECRET: key,
      DOMBOT_WORKSPACE_ID: workspace,
    } as Env);
    expect(response.status).toBe(200);
    expect((await response.json()).dueAt).toBe(1);
  });
  it('private sales reads require explicit owner admission before hydration', async () => {
    const key = 'owner-fixture-key'.repeat(3),
      workspace = crypto.randomUUID(),
      env = {
        DB: db,
        DOMBOT_AUTH: 'gateway',
        DOMBOT_GATEWAY_SECRET: key,
        DOMBOT_WORKSPACE_ID: workspace,
        DOMBOT_SALES_V1: 'true',
      } as Env;
    const auth = await buildAuthConfig(env, root),
      app = new Hono<{ Bindings: Env; Variables: { auth: AuthConfig } }>();
    let hydrations = 0;
    app.use('*', async (c, next) => {
      c.set('auth', auth);
      await next();
    });
    app.route(
      '/sales',
      createSalesRoutes(async (_c, next) => {
        hydrations++;
        await next();
      }),
    );
    const legacy = new Request('https://fixture.example/sales/capabilities');
    legacy.headers.set(
      'x-dombot-gateway-proof',
      await signGatewayRequest(key, workspace, 'seller', legacy),
    );
    expect((await app.request(legacy, undefined, env)).status).toBe(403);
    expect(hydrations).toBe(0);
    const owner = new Request('https://fixture.example/sales/capabilities');
    owner.headers.set(
      'x-dombot-gateway-proof',
      await signGatewayRequest(key, workspace, 'seller', owner, {
        purpose: 'sales-owner',
        recipientVerified: false,
      }),
    );
    expect((await app.request(owner, undefined, env)).status).toBe(200);
    expect(hydrations).toBe(1);
  });
  it('shop filters and CSV recheck availability and exclude unpublished names', async () => {
    const a = await live('one.example'),
      b = await live('two.example'),
      privateDraft = emptySale(
        'private.example',
        sourcePriceFingerprint(price),
      );
    await store.save(privateDraft, null);
    const shop = {
      version: 1 as const,
      handle: 'sample',
      title: 'Sample shop',
      intro: 'Sample data',
      listingIds: [a.id, b.id, privateDraft.id],
    };
    await store.saveShop(shop, null);
    await db
      .prepare("UPDATE sales_shop SET published=? WHERE id='main'")
      .bind(JSON.stringify(shop))
      .run();
    await store.availability(
      b.id,
      (await store.get(b.id)).operationalRevision,
      'sold',
    );
    const result = await publicShop(db, 'sample', {
      currency: 'USD',
      min: '14000',
      max: '15000',
    });
    expect(result.items.map((s) => s.domain)).toEqual(['one.example']);
    const csv = publicSalesCsv(result.items);
    expect(csv).not.toContain('private.example');
    expect(csv).not.toContain('two.example');
    expect(csv).not.toContain('SECRET_FLOOR');
    expect((await publicShop(db, 'sample', { q: '%' })).items).toHaveLength(0);
  });
  it('deleting a domain erases dependent sales data without removing another listing', async () => {
    const { p, id } = await verifiedLead(),
      other = await live('other.example'),
      saved = await store.get(p.id);
    const review = await store.prepare(
        [{ id: p.id, revision: saved.revision }],
        observation,
      ),
      jobs = new SalesJobs(store),
      job = await jobs.create(
        [{ id: p.id, revision: saved.revision }],
        { kind: 'shop', include: true },
        crypto.randomUUID(),
      );
    await store.removeNames(['FIXTURE.EXAMPLE']);
    expect(await readPublicSale(db, p.domain)).toBeNull();
    expect(await readPublicSale(db, other.domain)).not.toBeNull();
    await expect(inbox.lead(id)).rejects.toThrow(/not found/);
    await expect(store.review(review.id)).rejects.toThrow(/not found/);
    await expect(jobs.get(job.id)).rejects.toThrow(/not found/);
  });
});

describe('global listing filters and reviewed publication jobs', () => {
  it('searches private names through authorized hashed candidates and filters stale price sources', async () => {
    const draft = {
      ...emptySale('unlisted.example', sourcePriceFingerprint(price)),
      mode: 'offer' as const,
    };
    await store.save(draft, null);
    expect(
      (
        await store.list('', 100, {
          q: 'unlisted',
          domains: ['unlisted.example'],
          mode: 'offer',
        })
      ).items.map((i) => i.draft.id),
    ).toEqual([draft.id]);
    expect(
      (await store.list('', 100, { q: 'other', domains: [] })).items,
    ).toHaveLength(0);
    const stale = await store.stalePriceIds({
      'unlisted.example': { ...price, amount: '20000' },
    });
    expect(stale).toEqual([draft.id]);
    expect(
      (await store.list('', 100, { state: 'Needs attention', staleIds: stale }))
        .items,
    ).toHaveLength(1);
    expect(
      JSON.stringify(await db.prepare('SELECT * FROM sale_drafts').all()),
    ).not.toContain('unlisted.example');
  });
  it('requires exact approval and advances only its own shop revision across publication batches', async () => {
    const foundation = await live('foundation.example'),
      shop = {
        version: 1 as const,
        handle: 'sample',
        title: 'Sample shop',
        intro: '',
        listingIds: [foundation.id],
      };
    await store.saveShop(shop, null);
    await db
      .prepare("UPDATE sales_shop SET published=? WHERE id='main'")
      .bind(JSON.stringify(shop))
      .run();
    const refs = [],
      reviews = [];
    for (const domain of ['first.example', 'second.example']) {
      const d = {
        ...emptySale(domain, sourcePriceFingerprint(price)),
        includeInShop: true,
      };
      const revision = await store.save(d, null);
      refs.push({ id: d.id, revision });
      reviews.push(
        (await store.prepare([{ id: d.id, revision }], observation)).id,
      );
    }
    const jobs = new SalesJobs(store),
      job = await jobs.create(
        refs,
        { kind: 'publish', reviewIds: reviews },
        crypto.randomUUID(),
      );
    await expect(jobs.step(job.id, observation)).rejects.toThrow(/approve/);
    const manifest = await jobs.review(job.id);
    await expect(jobs.approve(job.id, 'wrong')).rejects.toThrow(/manifest/);
    await jobs.approve(job.id, manifest.digest);
    const result = await jobs.step(job.id, observation);
    expect(result.counts).toEqual([{ state: 'complete', count: 2 }]);
    expect((await store.shop()).published!.listingIds).toEqual(
      expect.arrayContaining([foundation.id, ...refs.map((r) => r.id)]),
    );
    const revisions = (
      await db.prepare('SELECT revision FROM published_sales ORDER BY id').all()
    ).results;
    await jobs.step(job.id, observation);
    expect(
      (
        await db
          .prepare('SELECT revision FROM published_sales ORDER BY id')
          .all()
      ).results,
    ).toEqual(revisions);
  });
});

describe('bounded bulk restore', () => {
  it('restores 500 drafts and 500 messages without one D1 query per row', async () => {
    const p = await live(),
      receipt = await inbox.intake(
        { ...input(), observedRevision: p.revision },
        p,
      ),
      backup = await exportSales(store);
    for (let i = 1; i < 500; i++)
      backup.drafts.push(
        emptySale(`sample${i}.example`, sourcePriceFingerprint(price)),
      );
    backup.messages = Array.from({ length: 500 }, (_, i) => ({
      id: crypto.randomUUID(),
      leadId: receipt.id,
      direction: 'buyer' as const,
      sequence: i + 1,
      createdAt: Date.now(),
      payload: { body: 'Sample recovery message', recipient: null },
    }));
    let prepared = 0;
    const tracked = new Proxy(db, {
      get(target, property) {
        if (property === 'prepare')
          return (sql: string) => {
            prepared++;
            return target.prepare(sql);
          };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const rotated = await SalesStore.from({
      DB: tracked,
      DOMBOT_SECRET: btoa(String.fromCharCode(...new Uint8Array(32).fill(22))),
    });
    await restoreSales(rotated, backup);
    expect(prepared).toBeLessThan(50);
    expect(
      (await db
        .prepare('SELECT count(*) AS n FROM sale_drafts')
        .first<{ n: number }>())!.n,
    ).toBe(500);
    expect(
      (await db
        .prepare('SELECT count(*) AS n FROM sales_messages')
        .first<{ n: number }>())!.n,
    ).toBe(500);
    expect(await readPublicSale(db, p.domain)).toBeNull();
  }, 15000);
});

describe('body-bound publication admission', () => {
  it('retains a verified seller-recipient claim after parsing the signed JSON body', async () => {
    const memory = new MemoryDocStore(),
      account = crypto.randomUUID(),
      now = Date.now();
    await memory.put('registrar-accounts', account, {
      id: account,
      registrar: 'dynadot',
      label: 'Sample',
    });
    await memory.put('registrar-credentials', account, {
      apiKey: 'sample-only',
      apiSecret: 'sample-only',
    });
    await memory.put('registrar-domains', account, {
      fetchedAt: now,
      data: {
        lastSyncedAt: now,
        lastError: null,
        domains: [
          {
            domainName: 'fixture.example',
            registrar: 'dynadot',
            accountId: account,
          },
        ],
      },
    });
    await memory.put('domain-list-prices', 'fixture.example', price);
    configureStore(memory);
    await hydrateStores();
    const draft = emptySale('fixture.example', sourcePriceFingerprint(price)),
      revision = await store.save(draft, null),
      key = 'body-proof-fixture'.repeat(3),
      workspace = crypto.randomUUID(),
      env = {
        DB: db,
        DOMBOT_AUTH: 'gateway',
        DOMBOT_SECRET: btoa(String.fromCharCode(...root)),
        DOMBOT_GATEWAY_SECRET: key,
        DOMBOT_WORKSPACE_ID: workspace,
        DOMBOT_SALES_V1: 'true',
      } as Env;
    const auth = await buildAuthConfig(env, root),
      app = new Hono<{ Bindings: Env; Variables: { auth: AuthConfig } }>();
    app.use('*', async (c, next) => {
      c.set('auth', auth);
      await next();
    });
    app.route(
      '/sales',
      createSalesRoutes(async (_c, next) => {
        await next();
      }),
    );
    const request = new Request('https://fixture.example/sales/reviews', {
      method: 'POST',
      headers: {
        Origin: 'https://fixture.example',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ items: [{ id: draft.id, revision }] }),
    });
    request.headers.set(
      'x-dombot-gateway-proof',
      await signGatewayRequest(key, workspace, 'seller', request, {
        purpose: 'sales-owner',
        recipientVerified: true,
      }),
    );
    const result = await app.request(request, undefined, env);
    expect(result.status, await result.clone().text()).toBe(200);
  });
});

describe('imported Sales inventory', () => {
  it('offers imported long and IDN names for private drafts without granting publication control', async () => {
    const memory = new MemoryDocStore(),
      names = [
        'imported.example',
        `${'a'.repeat(63)}.example`,
        'xn--fsqu00a.example',
      ];
    for (const name of names)
      await memory.put('imported-domains', name, {
        addedAt: Date.now(),
        updatedAt: Date.now(),
      });
    configureStore(memory);
    await hydrateStores();
    const key = 'imported-sales-fixture'.repeat(3),
      workspace = crypto.randomUUID(),
      env = {
        DB: db,
        DOMBOT_AUTH: 'gateway',
        DOMBOT_SECRET: btoa(String.fromCharCode(...root)),
        DOMBOT_GATEWAY_SECRET: key,
        DOMBOT_WORKSPACE_ID: workspace,
        DOMBOT_SALES_V1: 'true',
      } as Env;
    const auth = await buildAuthConfig(env, root),
      app = new Hono<{ Bindings: Env; Variables: { auth: AuthConfig } }>();
    app.use('*', async (c, next) => {
      c.set('auth', auth);
      await next();
    });
    app.route(
      '/sales',
      createSalesRoutes(async (_c, next) => {
        await next();
      }),
    );
    async function request(path: string, body?: unknown) {
      const r = new Request('https://fixture.example/sales/' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Origin: 'https://fixture.example',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      r.headers.set(
        'x-dombot-gateway-proof',
        await signGatewayRequest(key, workspace, 'seller', r, {
          purpose: 'sales-owner',
          recipientVerified: true,
        }),
      );
      return app.request(r, undefined, env);
    }
    const inventory = await request('inventory'),
      items = (await inventory.json()).items;
    expect(items.map((v: { domain: string }) => v.domain)).toEqual(
      expect.arrayContaining(names),
    );
    expect(items.every((v: { available: boolean }) => !v.available)).toBe(true);
    const created = await request('listings', { domains: names });
    expect(created.status, await created.clone().text()).toBe(200);
    const drafts = (await created.json()).items;
    expect(drafts).toHaveLength(3);
    const found = await request('listings?q=imported');
    expect((await found.json()).items).toHaveLength(1);
    const reviews = await request('reviews', {
      items: drafts.map((v: { draft: { id: string }; revision: string }) => ({
        id: v.draft.id,
        revision: v.revision,
      })),
    });
    expect(reviews.status).toBe(409);
    expect(
      (await db
        .prepare('SELECT count(*) AS n FROM published_sales')
        .first<{ n: number }>())!.n,
    ).toBe(0);
  });
});
