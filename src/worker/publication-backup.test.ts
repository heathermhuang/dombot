import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { aesGcmCipher } from '../core/storage/encrypted';
import { MemoryDocStore } from '../core/storage/doc-store';
import {
  configureStore,
  exportNamespaces,
  flushWrites,
  hydrateStores,
} from '../core/storage/namespace';
import { emptyDraft } from '../shared/publication';
import { emptySale } from '../shared/sales';
import { sourcePriceFingerprint } from '../core/publication/sales';
import { PublicationStore } from './publication-store';
import { SalesStore } from './sales-store';
import { SalesInquiryStore } from './sales-inquiry-store';
import { publicationBackupMethods } from './publication-backup';

let mf: Miniflare,
  db: D1Database,
  publication: PublicationStore,
  sales: SalesStore;
const root = new Uint8Array(32).fill(7);
const incoming = JSON.stringify({
  format: 'dombot-data',
  version: 9,
  namespaces: {},
});
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      cf: false,
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      d1Databases: { DB: 'salesless-backup' },
    }),
  );
  db = (await mf.getD1Database('DB')) as unknown as D1Database;
  for (const f of [
    '0002_publication.sql',
    '0004_sales.sql',
    '0005_sales_inquiries.sql',
  ])
    await db.exec(
      readFileSync('migrations/' + f, 'utf8')
        .replace(/^--.*$/gm, '')
        .replace(/\n/g, ' '),
    );
  publication = new PublicationStore(db, await aesGcmCipher(root));
  sales = await SalesStore.from({
    DB: db,
    DOMBOT_SECRET: btoa(String.fromCharCode(...root)),
  });
});
afterAll(async () => {
  await mf?.dispose();
});
beforeEach(async () => {
  const tables = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*'",
    )
    .all<{ name: string }>();
  // Delete children first, then parents; keep FK enforcement enabled.
  for (const name of [
    'sales_messages',
    'sales_tokens',
    'sales_outbox',
    'sales_leads',
    'published_sales',
    'sales_review_items',
    'sales_job_items',
    ...tables.results.map((t) => t.name),
  ]) {
    if (!/^[a-z_]+$/.test(name)) throw Error('Unexpected fixture table');
    await db.prepare(`DELETE FROM ${name}`).run();
  }
  const memory = new MemoryDocStore();
  await memory.put('settings', 'settings', { autoSyncIntervalMinutes: 0 });
  await memory.put('domain-folders', 'preserved.example', ['existing-folder']);
  configureStore(memory);
  await hydrateStores();
  await publication.save(
    { ...emptyDraft(), title: 'Preserve private collection' },
    null,
  );
});
async function snapshot() {
  const { results } = await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' ORDER BY name",
    )
    .all<{ name: string }>();
  const tables: Record<string, unknown> = {};
  for (const { name } of results) {
    if (!/^[a-z_]+$/.test(name)) throw Error('Unexpected fixture table');
    tables[name] = (
      await db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()
    ).results;
  }
  return { tables, namespaces: exportNamespaces() };
}
async function rejectWithoutWrites() {
  const before = await snapshot();
  await expect(
    publicationBackupMethods(publication, true, sales).importData.handler(
      incoming,
    ),
  ).rejects.toThrow(/inquiry data.*Nothing was imported/i);
  await flushWrites();
  expect(await snapshot()).toEqual(before);
}
describe('bundle import protects existing sales state before any writes', () => {
  it('preserves listings, inquiries, delivery state, publication and core namespaces', async () => {
    const draft = emptySale('guard.example', sourcePriceFingerprint(null));
    await sales.save(draft, null);
    const inbox = new SalesInquiryStore(sales, 'https://example.test');
    // A valid full backup creates a real conversation plus its outbox/token state.
    const review = await sales.prepare(
      [{ id: draft.id, revision: (await sales.get(draft.id)).revision }],
      () => ({
        price: null,
        ownershipFingerprint: 'fixture-owner',
        controlExpiresAt: Date.now() + 3600_000,
        available: true,
        reason: null,
      }),
    );
    await sales.publish(review.id, () => ({
      price: null,
      ownershipFingerprint: 'fixture-owner',
      controlExpiresAt: Date.now() + 3600_000,
      available: true,
      reason: null,
    }));
    const { readPublicSale } = await import('./sales-store');
    const published = (await readPublicSale(db, draft.domain))!;
    await inbox.intake(
      {
        idempotencyKey: crypto.randomUUID(),
        observedRevision: published.revision,
        name: 'Controlled buyer',
        email: 'buyer@example.test',
        offer: null,
        message: 'Preserve this inquiry',
        turnstileToken: 'controlled',
        website: '',
      },
      published,
    );
    await rejectWithoutWrites();
  });
  it('protects a suppression-only account with no listing drafts', async () => {
    await db
      .prepare(
        'INSERT INTO sales_suppression(email_hash,expires_at,sealed) VALUES(?,?,?)',
      )
      .bind(
        'controlled-hash',
        Date.now() + 600_000,
        await sales.seal({ email: 'buyer@example.test' }),
      )
      .run();
    await rejectWithoutWrites();
  });
  it('protects operational-only state which is deliberately absent from exports', async () => {
    await db
      .prepare(
        "INSERT INTO sales_host_bindings(hostname,listing_id,epoch,enabled) VALUES('guard.example','listing',3,0)",
      )
      .run();
    await rejectWithoutWrites();
  });
  it('allows an older sales-less bundle on an account with empty sales tables', async () => {
    await publicationBackupMethods(publication, true, sales).importData.handler(
      incoming,
    );
    await flushWrites();
    expect((await publication.draft()).revision).toBeNull();
  });
  it('allows a full host backup to restore existing sales data', async () => {
    const draft = emptySale('guard.example', sourcePriceFingerprint(null));
    await sales.save(draft, null);
    const methods = publicationBackupMethods(publication, true, sales);
    const backup = await methods.exportData.handler();
    await methods.importData.handler(backup);
    expect((await sales.get(draft.id)).draft.domain).toBe('guard.example');
    expect((await sales.get(draft.id)).availability).toBe('paused');
  });
});
