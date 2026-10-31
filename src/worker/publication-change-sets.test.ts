import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { aesGcmCipher } from '../core/storage/encrypted';
import { deriveEncryptionKey } from './keys';
import { PublicationStore } from './publication-store';
import { SalesStore, type SaleObservation } from './sales-store';
import { PublicationChangeSets } from './publication-change-sets';
import {
  emptyOwnerSite,
  selectedSite,
  convertOwnerSiteV3,
  anyDraftSchema,
} from '../shared/owner-site';
import { emptyDraft, privateListing } from '../shared/publication';
import { emptySale } from '../shared/sales';
import { sourcePriceFingerprint } from '../core/publication/sales';
import { publicLinkedSales } from './publication-links';
import { renderOwnerSite } from '../shared/render-owner-site';
let mf: Miniflare,
  db: D1Database,
  publication: PublicationStore,
  sales: SalesStore,
  sets: PublicationChangeSets;
const root = new Uint8Array(32).fill(5);
const input = { domains: [], accounts: [] };
const observation = (): SaleObservation => ({
  price: null,
  ownershipFingerprint: 'fixture',
  controlExpiresAt: Date.now() + 3600000,
  available: true,
  reason: null,
});
const auth = 'synthetic-qualified-authority';
beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'publishing-tests',
          modules: true,
          script: 'export default {fetch(){return new Response("ok")}}',
          compatibilityDate: '2026-10-08',
          d1Databases: ['DB'],
        },
      ],
    }),
  );
  db = await mf.getD1Database('DB');
  for (const file of [
    '0001_docs.sql',
    '0002_publication.sql',
    '0004_sales.sql',
    '0005_sales_inquiries.sql',
    '0006_sales_control_leases.sql',
    '0008_publication_change_sets.sql',
  ])
    await db.exec(
      readFileSync(`migrations/${file}`, 'utf8')
        .replace(/^--.*$/gm, '')
        .replace(/\n/g, ' '),
    );
  publication = new PublicationStore(
    db,
    await aesGcmCipher(await deriveEncryptionKey(root)),
  );
  sales = await SalesStore.from({
    DB: db,
    DOMBOT_SECRET: btoa(String.fromCharCode(...root)),
  });
  sets = new PublicationChangeSets(
    publication,
    sales,
    'fixture',
    'https://public.example/w/fixture',
  );
}, 30000);
afterAll(async () => mf?.dispose());
beforeEach(async () => {
  await import('../core/services/registrars');
  const { configureStore, hydrateStores } =
    await import('../core/storage/namespace');
  const { MemoryDocStore } = await import('../core/storage/doc-store');
  configureStore(new MemoryDocStore());
  await hydrateStores();
  await db.batch(
    [
      'publication_change_sets',
      'published_portfolios',
      'portfolio_drafts',
      'sales_reviews',
      'sales_shop',
      'sales_events',
      'sale_drafts',
      'docs',
      'publication_authority',
    ].map((t) => db.prepare(`DELETE FROM ${t}`)),
  );
});
async function site() {
  const draft = emptyOwnerSite();
  draft.domainPresentations = [
    {
      id: 'old',
      domain: 'old.example',
      ownership: 'historical',
      availability: 'not-for-sale',
      description: 'Public description',
      askingPrice: null,
      currency: 'USD',
    },
    {
      id: 'new',
      domain: 'new.example',
      ownership: 'historical',
      availability: 'not-for-sale',
      description: 'Approved new description',
      askingPrice: null,
      currency: 'USD',
    },
  ];
  draft.catalogue = { enabled: true, domainIds: ['old'] };
  let revision = await publication.save(draft, null);
  await publication.publish(
    { ...selectedSite(draft), publishedAt: 1000 },
    revision,
  );
  draft.profile.intro = 'UNREVIEWED PRIVATE EDIT';
  draft.catalogue.domainIds.push('new');
  revision = await publication.save(draft, revision);
  return { draft, revision };
}
const publish = (revision: string, extra = {}) => ({
  requestKey: crypto.randomUUID(),
  draftRevision: revision,
  operation: {
    kind: 'publish',
    domains: ['new.example'],
    collectionIds: [],
    catalogue: true,
    sales: [],
    shopListingIds: [],
    ...extra,
  },
});
it('publishes only scoped fields, preserves unrelated drafts, and returns the same receipt after response loss', async () => {
  const { revision } = await site();
  const req = publish(revision);
  const m = await sets.prepare(req, input, observation, auth);
  expect(JSON.stringify(m.after)).not.toContain('UNREVIEWED');
  const receipt = await sets.commit(
    m.id,
    req.requestKey,
    input,
    observation,
    auth,
  );
  expect(
    await sets.commit(m.id, req.requestKey, input, observation, auth),
  ).toEqual(receipt);
  expect((await publication.draft()).draft).toMatchObject({
    profile: { intro: 'UNREVIEWED PRIVATE EDIT' },
  });
  expect((await publication.published())!.snapshot).toMatchObject({
    profile: { intro: '' },
    domainPresentations: expect.arrayContaining([
      expect.objectContaining({ domain: 'new.example' }),
    ]),
  });
  expect(receipt.publicRevision).not.toBe(revision);
});
it('fences standalone source-price writes and stale tabs using persisted generation', async () => {
  const { revision } = await site();
  const req = publish(revision);
  const m = await sets.prepare(req, input, observation, auth);
  const before = await publication.published();
  await db
    .prepare('INSERT INTO docs(ns,key,value,updated_at) VALUES(?,?,?,?)')
    .bind('domain-list-prices', 'new.example', '{}', Date.now())
    .run();
  await expect(
    sets.commit(m.id, req.requestKey, input, observation, auth),
  ).rejects.toThrow(/dependency/);
  expect(await publication.published()).toEqual(before);
  expect(await sets.receipt(m.id, req.requestKey)).toBeNull();
});
it('rolls back all public writes and receipt on a SQL fault after earlier mutations', async () => {
  const { revision } = await site();
  const req = publish(revision);
  const m = await sets.prepare(req, input, observation, auth);
  const before = await publication.published();
  await db.exec(
    "CREATE TRIGGER inject_publishing_fault BEFORE UPDATE ON publication_change_sets WHEN NEW.receipt IS NOT NULL BEGIN SELECT RAISE(ABORT,'injected transaction fault'); END;",
  );
  try {
    await expect(
      sets.commit(m.id, req.requestKey, input, observation, auth),
    ).rejects.toThrow(/injected/);
    expect(await publication.published()).toEqual(before);
    expect(await sets.receipt(m.id, req.requestKey)).toBeNull();
  } finally {
    await db.exec('DROP TRIGGER inject_publishing_fault;');
  }
});
it('withdraws the final legacy name without erasing its saved draft or descriptions', async () => {
  const draft = {
    ...emptyDraft(),
    listings: [
      {
        ...privateListing('last.example'),
        visibility: 'historical' as const,
        description: 'Keep privately',
      },
    ],
  };
  const revision = await publication.save(draft, null);
  await publication.publish(
    {
      ...draft,
      listings: [{ ...draft.listings[0], visibility: 'historical' }],
      publishedAt: 1000,
    },
    revision,
  );
  const req = {
    requestKey: crypto.randomUUID(),
    draftRevision: revision,
    operation: { kind: 'withdraw', domains: ['last.example'] },
  };
  const m = await sets.prepare(req, input, observation, auth);
  await sets.commit(m.id, req.requestKey, input, observation, auth);
  expect(await publication.published()).toBeNull();
  expect((await publication.draft()).draft).toMatchObject({
    listings: [
      {
        domain: 'last.example',
        visibility: 'private',
        description: 'Keep privately',
      },
    ],
  });
});
it('keeps v3 strict, preserves legacy fractional prices, and suppresses changed linked terms without mailto', async () => {
  const v2 = emptyOwnerSite();
  v2.domainPresentations = [
    {
      id: 'domain',
      domain: 'linked.example',
      ownership: 'current',
      availability: 'inquiries',
      description: '',
      askingPrice: 12.34,
      currency: 'USD',
    },
  ];
  v2.catalogue = { enabled: true, domainIds: ['domain'] };
  v2.profile.contactEmail = 'public@example.com';
  const v3 = convertOwnerSiteV3(v2);
  expect(v3.domainPresentations[0].askingPrice).toBe(12.34);
  expect(anyDraftSchema.safeParse({ ...v2, salesLinks: [] }).success).toBe(
    false,
  );
  const d = emptySale('linked.example', sourcePriceFingerprint(null)),
    revision = await sales.save(d, null),
    review = await sales.prepare([{ id: d.id, revision }], observation);
  await sales.publish(review.id, observation);
  const sale = (await sales.get(d.id)).published!;
  v3.profile.contactEmail = '';
  v3.domainPresentations[0].askingPrice = null;
  v3.salesLinks = [
    {
      presentationId: 'domain',
      listingId: d.id,
      expectedPublishedRevision: sale.revision,
    },
  ];
  const { bindSiteLinks } = await import('./publication-links');
  const site = await bindSiteLinks(db, v3);
  if (site.version !== 3) throw new Error('Expected v3');
  expect(
    (await publicLinkedSales(db, site, 'https://public.example/w/fixture')).get(
      'domain',
    )?.url,
  ).toBe('https://public.example/w/fixture/d/linked.example');
  await sales.availability(
    d.id,
    (await sales.get(d.id)).operationalRevision,
    'paused',
  );
  const html = renderOwnerSite(
    site,
    new URL('https://custom.example/p/portfolio?view=catalogue'),
    false,
    await publicLinkedSales(db, site, 'https://public.example/w/fixture'),
  );
  expect(html).toContain('Inquiries currently unavailable');
  expect(html).not.toContain('mailto:');
  expect(html).not.toContain('12.34');
});

it('fails a zero-row guard inside the batch after a concurrent standalone unpublish', async () => {
  const { revision } = await site(),
    request = publish(revision),
    m = await sets.prepare(request, input, observation, auth);
  const atomic = sales.atomic.bind(sales);
  sales.atomic = async (statements) => {
    await publication.unpublish(revision);
    await atomic(statements);
  };
  try {
    await expect(
      sets.commit(m.id, request.requestKey, input, observation, auth),
    ).rejects.toThrow(/changed/i);
    expect(await publication.published()).toBeNull();
    expect(await sets.receipt(m.id, request.requestKey)).toBeNull();
  } finally {
    sales.atomic = atomic;
  }
});
it('uses different public revisions for two scoped publications from the same saved draft', async () => {
  const { revision } = await site();
  const request1 = publish(revision),
    m1 = await sets.prepare(request1, input, observation, auth),
    r1 = await sets.commit(
      m1.id,
      request1.requestKey,
      input,
      observation,
      auth,
    );
  const request2 = publish(revision),
    m2 = await sets.prepare(request2, input, observation, auth),
    r2 = await sets.commit(
      m2.id,
      request2.requestKey,
      input,
      observation,
      auth,
    );
  expect(r1.publicRevision).not.toBe(r2.publicRevision);
  expect((await publication.draft()).revision).toBe(revision);
});
it('rejects another tenant, a reused operation key with altered scope, and an expired stored review', async () => {
  const { revision } = await site(),
    request = publish(revision),
    m = await sets.prepare(request, input, observation, auth);
  const other = new PublicationChangeSets(
    publication,
    sales,
    'different-tenant',
    'https://public.example',
  );
  await expect(other.get(m.id)).rejects.toThrow(/changed/);
  await expect(
    sets.prepare(
      {
        ...request,
        operation: { ...request.operation, domains: ['old.example'] },
      },
      input,
      observation,
      auth,
    ),
  ).rejects.toThrow(/operation key/);
  await db
    .prepare('UPDATE publication_change_sets SET expires_at=0 WHERE id=?')
    .bind(m.id)
    .run();
  const before = await publication.published();
  await expect(
    sets.commit(m.id, request.requestKey, input, observation, auth),
  ).rejects.toThrow(/changed/);
  expect(await publication.published()).toEqual(before);
});
it('retains an excluded empty collection and profile-only output after last-domain v3 withdrawal', async () => {
  const v3 = convertOwnerSiteV3(emptyOwnerSite());
  v3.domainPresentations = [
    {
      id: 'last',
      domain: 'last.example',
      ownership: 'historical',
      availability: 'not-for-sale',
      description: 'Retained private description',
      askingPrice: null,
      currency: 'USD',
    },
  ];
  v3.collections = [
    {
      id: 'collection',
      slug: 'collection',
      title: 'Selected',
      intro: 'Public context',
      domainIds: ['last'],
    },
  ];
  v3.homepage.collectionIds = ['collection'];
  v3.catalogue = { enabled: true, domainIds: ['last'] };
  const revision = await publication.save(v3, null);
  const { bindSiteLinks } = await import('./publication-links');
  await publication.publish(await bindSiteLinks(db, v3), revision);
  const request = {
    requestKey: crypto.randomUUID(),
    draftRevision: revision,
    operation: { kind: 'withdraw', domains: ['last.example'] },
  };
  const m = await sets.prepare(request, input, observation, auth);
  await sets.commit(m.id, request.requestKey, input, observation, auth);
  expect((await publication.published())!.snapshot).toMatchObject({
    version: 3,
    collections: [],
    domainPresentations: [],
    homepage: { collectionIds: [] },
    catalogue: { enabled: false, domainIds: [] },
  });
  expect((await publication.draft()).draft).toMatchObject({
    collections: [{ id: 'collection', domainIds: [] }],
    domainPresentations: [{ description: 'Retained private description' }],
  });
});
it('does not reuse an old ownership observation for a new membership, but preserves unchanged stale public fragments', async () => {
  const draft = emptyOwnerSite();
  draft.domainPresentations = [
    {
      id: 'stale',
      domain: 'stale.example',
      ownership: 'current',
      availability: 'not-for-sale',
      description: 'Already public',
      askingPrice: null,
      currency: 'USD',
    },
    {
      id: 'history',
      domain: 'history.example',
      ownership: 'historical',
      availability: 'not-for-sale',
      description: 'New assertion',
      askingPrice: null,
      currency: 'USD',
    },
  ];
  draft.catalogue = { enabled: true, domainIds: ['stale'] };
  const revision = await publication.save(draft, null);
  await publication.publish(
    { ...selectedSite(draft), publishedAt: 1000 },
    revision,
  );
  const valid = publish(revision, { domains: ['history.example'] });
  const m = await sets.prepare(valid, input, observation, auth);
  await sets.commit(m.id, valid.requestKey, input, observation, auth);
  const request = publish(revision, { domains: ['stale.example'] });
  await expect(sets.prepare(request, input, observation, auth)).rejects.toThrow(
    /refresh registrar/,
  );
});
it('commits Sales and a profile in one batch and rolls them both back when receipt persistence fails', async () => {
  const { revision } = await site(),
    sale = emptySale('new.example', sourcePriceFingerprint(null)),
    saleRevision = await sales.save(sale, null);
  const request = publish(revision, {
      sales: [{ id: sale.id, revision: saleRevision }],
    }),
    m = await sets.prepare(request, input, observation, auth),
    before = await publication.published();
  await db.exec(
    "CREATE TRIGGER inject_combined_fault BEFORE UPDATE ON publication_change_sets WHEN NEW.receipt IS NOT NULL BEGIN SELECT RAISE(ABORT,'combined fault'); END;",
  );
  try {
    await expect(
      sets.commit(m.id, request.requestKey, input, observation, auth),
    ).rejects.toThrow(/combined fault/);
    expect((await sales.get(sale.id)).published).toBeNull();
    expect(await publication.published()).toEqual(before);
    expect(await sets.receipt(m.id, request.requestKey)).toBeNull();
  } finally {
    await db.exec('DROP TRIGGER inject_combined_fault;');
  }
  await sets.commit(m.id, request.requestKey, input, observation, auth);
  expect((await sales.get(sale.id)).published).not.toBeNull();
});
it('rejects changed operational state through an existing standalone Sales writer', async () => {
  const { revision } = await site(),
    sale = emptySale('new.example', sourcePriceFingerprint(null)),
    saleRevision = await sales.save(sale, null);
  const request = publish(revision, {
      sales: [{ id: sale.id, revision: saleRevision }],
    }),
    m = await sets.prepare(request, input, observation, auth);
  await sales.availability(
    sale.id,
    (await sales.get(sale.id)).operationalRevision,
    'sold',
  );
  await expect(
    sets.commit(m.id, request.requestKey, input, observation, auth),
  ).rejects.toThrow(/dependency/);
  expect((await sales.get(sale.id)).published).toBeNull();
});
it('rejects v3 backup link identity mismatches before changing any current publication', async () => {
  const { publicationBackupMethods } = await import('./publication-backup');
  const { configureStore, hydrateStores } =
    await import('../core/storage/namespace');
  const { MemoryDocStore } = await import('../core/storage/doc-store');
  configureStore(new MemoryDocStore());
  await hydrateStores();
  await site();
  const before = await publication.published();
  const backup = JSON.parse(
    await publicationBackupMethods(
      publication,
      true,
      sales,
    ).exportData.handler(),
  );
  const v3 = convertOwnerSiteV3(emptyOwnerSite());
  v3.domainPresentations = [
    {
      id: 'linked',
      domain: 'linked.example',
      ownership: 'current',
      availability: 'inquiries',
      description: '',
      askingPrice: null,
      currency: 'USD',
    },
  ];
  v3.catalogue = { enabled: true, domainIds: ['linked'] };
  v3.salesLinks = [
    {
      presentationId: 'linked',
      listingId: crypto.randomUUID(),
      expectedPublishedRevision: crypto.randomUUID(),
    },
  ];
  backup.publicationDraft = v3;
  await expect(
    publicationBackupMethods(publication, true, sales).importData.handler(
      JSON.stringify(backup),
    ),
  ).rejects.toThrow(/identities/);
  expect(await publication.published()).toEqual(before);
});
it('pages 1,000 and 20,000 inventory names with a fixed read count and no publication changes', async () => {
  const { publishingPresence } = await import('./publishing-presence');
  const { configureStore, hydrateStores } =
    await import('../core/storage/namespace');
  const { MemoryDocStore } = await import('../core/storage/doc-store');
  configureStore(new MemoryDocStore());
  await hydrateStores();
  const timings = [];
  for (const count of [1000, 20000]) {
    const draft = emptyOwnerSite();
    draft.domainPresentations = Array.from({ length: count }, (_, i) => ({
      id: `domain-${i}`,
      domain: `name${String(i).padStart(5, '0')}.example`,
      ownership: 'historical' as const,
      availability: 'not-for-sale' as const,
      description: '',
      askingPrice: null,
      currency: 'USD',
    }));
    const current = await publication.draft();
    await publication.save(draft, current.revision);
    const start = performance.now(),
      page = await publishingPresence(
        publication,
        sales,
        input,
        {},
        '/w/fixture',
      );
    timings.push({
      count,
      ms: performance.now() - start,
      bytes: new TextEncoder().encode(JSON.stringify(page)).byteLength,
    });
    expect(page.items).toHaveLength(100);
    expect(page.cursor).toBe('name00099.example');
    expect(await publication.published()).toBeNull();
    const next = await publishingPresence(
      publication,
      sales,
      input,
      { cursor: page.cursor! },
      '/w/fixture',
    );
    expect(next.items[0].domain).toBe('name00100.example');
  }
  console.info('Presence fixture measurements', JSON.stringify(timings));
});

async function registrarInput(domain: string) {
  const { getCachedPortfolio, getRegistrarMetadata } =
    await import('../core/services/registrars');
  const { configureStore, hydrateStores } =
    await import('../core/storage/namespace');
  const { MemoryDocStore } = await import('../core/storage/doc-store');
  const memory = new MemoryDocStore();
  await memory.put('registrar-credentials', 'dynadot', {
    apiKey: 'synthetic-only',
    apiSecret: 'synthetic-only',
  });
  await memory.put('registrar-domains', 'dynadot', {
    fetchedAt: Date.now(),
    data: {
      lastSyncedAt: Date.now(),
      lastError: null,
      domains: [{ domainName: domain, registrar: 'dynadot' }],
    },
  });
  configureStore(memory);
  await hydrateStores();
  return {
    domains: getCachedPortfolio()!.domains,
    accounts: getRegistrarMetadata(),
  };
}
it('publishes v3 and Sales together without a public owner email and suppresses a later standalone price revision', async () => {
  const controlled = await registrarInput('linked.example');
  const draft = convertOwnerSiteV3(emptyOwnerSite());
  const sale = emptySale('linked.example', sourcePriceFingerprint(null)),
    saleRevision = await sales.save(sale, null);
  draft.domainPresentations = [
    {
      id: 'linked',
      domain: 'linked.example',
      ownership: 'current',
      availability: 'inquiries',
      description: 'Reviewed description',
      askingPrice: null,
      currency: 'USD',
    },
  ];
  draft.catalogue = { enabled: true, domainIds: ['linked'] };
  draft.salesLinks = [
    {
      presentationId: 'linked',
      listingId: sale.id,
      expectedPublishedRevision: saleRevision,
    },
  ];
  const revision = await publication.save(draft, null),
    request = publish(revision, {
      domains: ['linked.example'],
      sales: [{ id: sale.id, revision: saleRevision }],
    }),
    m = await sets.prepare(request, controlled, observation, auth);
  const receipt = await sets.commit(
      m.id,
      request.requestKey,
      controlled,
      observation,
      auth,
    ),
    site = (await publication.published())!.snapshot;
  if (!('version' in site) || site.version !== 3)
    throw new Error('Expected v3');
  expect(site.profile.contactEmail).toBe('');
  expect(site.salesLinks[0].publishedRevision).toBe(
    (await sales.get(sale.id)).published!.revision,
  );
  expect(receipt.urls).toContain(
    'https://public.example/w/fixture/d/linked.example',
  );
  const saved = await sales.get(sale.id);
  await sales.save(
    {
      ...saved.draft,
      priceSource: {
        kind: 'override',
        price: { amount: '12345', currency: 'USD' },
        reason: 'Explicit test override',
      },
    },
    saved.revision,
  );
  const latest = await sales.get(sale.id),
    standalone = await sales.prepare(
      [{ id: sale.id, revision: latest.revision }],
      observation,
    );
  expect(standalone.items[0].profileImpacts).toContain(site.profile.name);
  await sales.publish(standalone.id, observation);
  expect(
    await publicLinkedSales(db, site, 'https://public.example/w/fixture'),
  ).toEqual(new Map());
  expect((await publication.published())!.snapshot).toEqual(site);
});
it('does not grant new publication authority to imported records or duplicate registrar accounts', async () => {
  const controlled = await registrarInput('new.example');
  const draft = emptyOwnerSite();
  draft.domainPresentations = [
    {
      id: 'new',
      domain: 'new.example',
      ownership: 'current',
      availability: 'not-for-sale',
      description: '',
      askingPrice: null,
      currency: 'USD',
    },
  ];
  draft.catalogue = { enabled: true, domainIds: ['new'] };
  const revision = await publication.save(draft, null),
    request = publish(revision);
  await expect(
    sets.prepare(
      request,
      {
        ...controlled,
        domains: controlled.domains.map((d) => ({
          ...d,
          source: 'imported' as const,
        })),
      },
      observation,
      auth,
    ),
  ).rejects.toThrow(/refresh registrar/);
  await expect(
    sets.prepare(
      { ...request, requestKey: crypto.randomUUID() },
      {
        ...controlled,
        domains: [
          ...controlled.domains,
          { ...controlled.domains[0], accountId: crypto.randomUUID() },
        ],
      },
      observation,
      auth,
    ),
  ).rejects.toThrow(/refresh registrar/);
});
it('retains authenticated same-origin withdrawal when both new write flags are off', async () => {
  const { Hono } = await import('hono');
  const { createPublicationRoutes } = await import('./publication-routes');
  const { buildAuthConfig } = await import('./auth');
  const { revision } = await site();
  const env = {
    DB: db,
    DOMBOT_AUTH: 'external',
    DOMBOT_SECRET: btoa(String.fromCharCode(...root)),
    DOMBOT_SALES_ORIGIN: 'https://public.example/w/fixture',
    DOMBOT_OWNER_SITE_V3: '',
    DOMBOT_COMPOSITE_PUBLISH: '',
  } as Env;
  const authConfig = await buildAuthConfig(env, root);
  const app = new Hono<{
    Bindings: Env;
    Variables: { auth: import('./auth').AuthConfig };
  }>();
  app.use('*', async (c, next) => {
    c.set('auth', authConfig);
    await next();
  });
  app.route(
    '/publishing',
    createPublicationRoutes(
      async (_c, next) => {
        await next();
      },
      () => input,
    ),
  );
  const call = (
    path: string,
    body: unknown,
    origin = 'https://worker.example',
  ) =>
    app.request(
      'https://worker.example/publishing' + path,
      {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      env,
    );
  const request = {
    requestKey: crypto.randomUUID(),
    draftRevision: revision,
    operation: { kind: 'withdraw', domains: ['old.example', 'new.example'] },
  };
  expect(
    (await call('/change-sets/review', request, 'https://foreign.example'))
      .status,
  ).toBe(403);
  const reviewed = await call('/change-sets/review', request);
  expect(reviewed.status).toBe(200);
  const m = await reviewed.json();
  expect(
    (
      await call(`/change-sets/${m.id}/commit`, {
        requestKey: request.requestKey,
      })
    ).status,
  ).toBe(200);
  expect((await publication.published())!.snapshot).toMatchObject({
    domainPresentations: [],
  });
  expect(
    (
      await call(
        '/change-sets/review',
        publish((await publication.draft()).revision!),
      )
    ).status,
  ).toBe(403);
});

it('keeps signed gateway publication admission through JSON body consumption', async () => {
  const { Hono } = await import('hono'),
    { createPublicationRoutes } = await import('./publication-routes'),
    { buildAuthConfig } = await import('./auth'),
    { signGatewayRequest } = await import('../shared/gateway-proof');
  const { revision } = await site();
  const env = {
    DB: db,
    DOMBOT_AUTH: 'gateway',
    DOMBOT_SECRET: btoa(String.fromCharCode(...root)),
    DOMBOT_GATEWAY_SECRET: 'synthetic-gateway-key-at-least-32-bytes',
    DOMBOT_WORKSPACE_ID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    DOMBOT_SALES_ORIGIN: 'https://public.example/w/fixture',
    DOMBOT_OWNER_SITE_V2: 'true',
    DOMBOT_COMPOSITE_PUBLISH: 'true',
  } as Env;
  const authConfig = await buildAuthConfig(env, root);
  const app = new Hono<{
    Bindings: Env;
    Variables: { auth: import('./auth').AuthConfig };
  }>();
  app.use('*', async (c, next) => {
    c.set('auth', authConfig);
    await next();
  });
  app.route(
    '/publishing',
    createPublicationRoutes(
      async (_c, next) => {
        await next();
      },
      () => input,
    ),
  );
  const request = new Request(
    'https://worker.example/publishing/change-sets/review',
    {
      method: 'POST',
      headers: {
        Origin: 'https://worker.example',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requestKey: crypto.randomUUID(),
        draftRevision: revision,
        operation: { kind: 'withdraw', domains: ['new.example'] },
      }),
    },
  );
  request.headers.set(
    'x-dombot-gateway-proof',
    await signGatewayRequest(
      env.DOMBOT_GATEWAY_SECRET!,
      env.DOMBOT_WORKSPACE_ID!,
      'synthetic-owner',
      request,
      { purpose: 'sales-owner', recipientVerified: true },
    ),
  );
  const result = await app.fetch(request, env);
  expect(result.status, await result.clone().text()).toBe(200);
});

it('qualifies the 100-name composite ceiling and rejects 101 before public mutation', async () => {
  const refs = [];
  for (let i = 0; i < 100; i++) {
    const draft = emptySale(
      `maximum-${i}.example`,
      sourcePriceFingerprint(null),
    );
    draft.description = 'q'.repeat(400);
    draft.sellerDisplayName = 'q'.repeat(100);
    draft.categories = Array.from(
      { length: 10 },
      (_, n) => `${n}` + 'q'.repeat(39),
    );
    refs.push({ id: draft.id, revision: await sales.save(draft, null) });
  }
  const request = {
    requestKey: crypto.randomUUID(),
    draftRevision: null,
    operation: {
      kind: 'publish',
      domains: [],
      collectionIds: [],
      catalogue: false,
      sales: refs,
      shopListingIds: [],
    },
  };
  const started = performance.now(),
    m = await sets.prepare(request, input, observation, auth),
    receipt = await sets.commit(
      m.id,
      request.requestKey,
      input,
      observation,
      auth,
    );
  expect(
    (await db
      .prepare('SELECT count(*) AS count FROM published_sales')
      .first<{ count: number }>())!.count,
  ).toBe(100);
  expect(receipt.urls).toHaveLength(100);
  await expect(
    sets.prepare(
      {
        ...request,
        requestKey: crypto.randomUUID(),
        operation: { ...request.operation, sales: [...refs, refs[0]] },
      },
      input,
      observation,
      auth,
    ),
  ).rejects.toThrow();
  const { writeFileSync } = await import('node:fs');
  writeFileSync(
    join(tmpdir(), 'dombot-publishing-budget-measurement.json'),
    JSON.stringify({
      names: 100,
      maxDescription: 400,
      maxCategories: 10,
      maxSellerIdentity: 100,
      wallMs: performance.now() - started,
      manifestBytes: new TextEncoder().encode(JSON.stringify(m)).byteLength,
      publicRows: 100,
    }),
  );
}, 30000);
