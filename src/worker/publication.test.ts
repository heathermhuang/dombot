import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { Hono } from 'hono';
import { aesGcmCipher } from '../core/storage/encrypted';
import { MemoryDocStore } from '../core/storage/doc-store';
import { configureStore, hydrateStores } from '../core/storage/namespace';
import { emptyDraft, privateListing } from '../shared/publication';
import { PublicationStore, PublicationConflict } from './publication-store';
import { buildAuthConfig, createSession, type AuthConfig } from './auth';
import { deriveEncryptionKey } from './keys';
import { createPublicationRoutes } from './publication-routes';
import { publicationBackupMethods } from './publication-backup';
import {
  createPublicPortfolioRoutes,
  renderPortfolio,
} from './public-portfolio';

let mf: Miniflare;
let db: D1Database;
let store: PublicationStore;
let auth: AuthConfig;
let cookie: string;
let privateReads = 0;
const root = new Uint8Array(32).fill(7);
const origin = 'http://localhost';
const env = {
  DOMBOT_SECRET: btoa(String.fromCharCode(...root)),
  DOMBOT_PASSWORD: 'test-password',
};
const draft = {
  ...emptyDraft(),
  title: 'Test collection',
  contactEmail: 'owner@example.com',
  listings: [
    {
      ...privateListing('visible.com'),
      visibility: 'inquiry' as const,
      askingPrice: 200,
    },
    privateListing('private.com'),
  ],
};
let app: Hono<{ Bindings: Env; Variables: { auth: AuthConfig } }>;
const call = (
  path: string,
  method = 'GET',
  body?: unknown,
  authenticated = true,
  requestOrigin = origin,
) =>
  app.request(
    `${origin}${path}`,
    {
      method,
      headers: {
        ...(authenticated ? { Cookie: cookie } : {}),
        Origin: requestOrigin,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    { ...env, DB: db } as Env,
  );

beforeAll(async () => {
  mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'publication-test',
          modules: true,
          script: 'export default { fetch() { return new Response("ok"); } }',
          compatibilityDate: '2026-09-06',
          d1Databases: ['DB'],
        },
      ],
    }),
  );
  db = await mf.getD1Database('DB');
  await db.exec(
    readFileSync(
      new URL('../../migrations/0002_publication.sql', import.meta.url),
      'utf8',
    )
      .replace(/^--.*$/gm, '')
      .replace(/\n/g, ' '),
  );
  const cipher = await aesGcmCipher(await deriveEncryptionKey(root));
  store = new PublicationStore(db, cipher);
  auth = await buildAuthConfig(env, root);
  cookie = `dombot_session=${await createSession(auth.sessionKey!)}`;
  app = new Hono();
  app.route('/', createPublicPortfolioRoutes());
  app.use('*', async (c, next) => {
    c.set('auth', auth);
    await next();
  });
  app.route(
    '/publishing',
    createPublicationRoutes(async (_c, next) => {
      privateReads++;
      await hydrateStores();
      await next();
    }),
  );
}, 30_000);
afterAll(async () => {
  await mf?.dispose();
});
beforeEach(async () => {
  await db.batch([
    db.prepare('DELETE FROM portfolio_drafts'),
    db.prepare('DELETE FROM published_portfolios'),
  ]);
  privateReads = 0;
  const memory = new MemoryDocStore();
  await memory.put('credentials', 'dynadot', {
    apiKey: 'NEVER_PUBLIC_CREDENTIAL',
    apiSecret: 'NEVER_PUBLIC_SECRET',
  });
  await memory.put('cache-portfolio', 'dynadot', {
    fetchedAt: Date.now(),
    data: {
      lastSyncedAt: Date.now(),
      lastError: null,
      domains: ['visible.com', 'private.com'].map((domainName) => ({
        domainName,
        registrar: 'dynadot',
        notes: 'NEVER_PUBLIC_NOTES',
        renewal: 15,
      })),
    },
  });
  configureStore(memory);
  await hydrateStores();
});

describe('publication database and HTTP boundary', () => {
  it('requires authentication for read, preview, save, publish and unpublish before private hydration', async () => {
    for (const [path, method] of [
      ['/publishing', 'GET'],
      ['/publishing/preview', 'GET'],
      ['/publishing', 'PUT'],
      ['/publishing/publish', 'POST'],
      ['/publishing/unpublish', 'POST'],
    ]) {
      expect((await call(path, method, undefined, false)).status).toBe(401);
    }
    expect(privateReads).toBe(0);
  });
  it('rejects cross-origin mutations and unknown private fields', async () => {
    expect(
      (
        await call(
          '/publishing',
          'PUT',
          { draft, revision: null },
          true,
          'https://evil.example',
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call('/publishing', 'PUT', {
          draft: { ...draft, apiKey: 'bad' },
          revision: null,
        })
      ).status,
    ).toBe(400);
    expect((await store.draft()).revision).toBeNull();
  });
  it('keeps drafts encrypted and private until explicit publication, then serves only the projection', async () => {
    expect((await call('/p/portfolio', 'GET', undefined, false)).status).toBe(
      404,
    );
    const save = await call('/publishing', 'PUT', { draft, revision: null });
    expect(save.status).toBe(200);
    const { revision } = await save.json();
    const raw = await db
      .prepare('SELECT sealed FROM portfolio_drafts')
      .first<{ sealed: string }>();
    expect(raw!.sealed).not.toContain('private.com');
    expect((await call('/p/portfolio', 'GET', undefined, false)).status).toBe(
      404,
    );
    const preview = await call('/publishing/preview');
    expect(preview.status).toBe(200);
    expect(await preview.text()).toContain('Private preview');
    expect(
      (await call('/publishing/publish', 'POST', { revision })).status,
    ).toBe(200);
    privateReads = 0;
    const published = await call('/p/portfolio', 'GET', undefined, false);
    const html = await published.text();
    expect(html).toContain('visible.com');
    for (const forbidden of [
      'private.com',
      'NEVER_PUBLIC',
      'apiKey',
      'dynadot',
      'lastSyncedAt',
    ])
      expect(html).not.toContain(forbidden);
    expect(privateReads).toBe(0);
    expect(published.headers.get('Cache-Control')).toBe('no-store');
    expect(published.headers.get('Content-Security-Policy')).toContain(
      "default-src 'none'",
    );
  });
  it('rejects stale saves and publishes across separate store instances', async () => {
    const revision = await store.save(draft, null);
    const next = await store.save({ ...draft, title: 'Newer draft' }, revision);
    await expect(store.save(draft, revision)).rejects.toBeInstanceOf(
      PublicationConflict,
    );
    expect(
      (await call('/publishing/publish', 'POST', { revision })).status,
    ).toBe(409);
    expect((await store.draft()).revision).toBe(next);
    expect(await store.published()).toBeNull();
    await expect(
      store.publish(
        { ...draft, listings: [], publishedAt: Date.now() },
        revision,
      ),
    ).rejects.toBeInstanceOf(PublicationConflict);
  });
  it('editing does not update the public page; changing a handle removes the old route', async () => {
    let revision = await store.save(draft, null);
    await call('/publishing/publish', 'POST', { revision });
    revision = await store.save(
      { ...draft, handle: 'new-handle', title: 'New title' },
      revision,
    );
    expect(
      await (await call('/p/portfolio', 'GET', undefined, false)).text(),
    ).toContain('Test collection');
    await call('/publishing/publish', 'POST', { revision });
    expect((await call('/p/portfolio', 'GET', undefined, false)).status).toBe(
      404,
    );
    expect((await call('/p/new-handle', 'GET', undefined, false)).status).toBe(
      200,
    );
  });
  it('unpublishes immediately, keeps the draft, and invalidates outstanding previews', async () => {
    const revision = await store.save(draft, null);
    await call('/publishing/publish', 'POST', { revision });
    expect(
      (await call('/publishing/unpublish', 'POST', { revision })).status,
    ).toBe(200);
    expect((await call('/p/portfolio', 'GET', undefined, false)).status).toBe(
      404,
    );
    expect((await store.draft()).draft).toEqual(draft);
    expect(
      (await call('/publishing/publish', 'POST', { revision })).status,
    ).toBe(409);
  });
  it('a stale unpublish cannot remove a newer publication', async () => {
    const revision = await store.save(draft, null);
    const next = await store.save({ ...draft, title: 'Newer' }, revision);
    await call('/publishing/publish', 'POST', { revision: next });
    expect(
      (await call('/publishing/unpublish', 'POST', { revision })).status,
    ).toBe(409);
    expect((await call('/p/portfolio', 'GET', undefined, false)).status).toBe(
      200,
    );
  });
  it('escapes content and filters public listings without exposing draft inventory', () => {
    const html = renderPortfolio(
      {
        ...draft,
        title: '<script>alert(1)</script>',
        listings: [
          {
            ...draft.listings[0],
            visibility: 'inquiry',
            description: '<img src=x onerror=alert(1)>',
          },
        ],
        publishedAt: Date.now(),
      },
      new URL('https://test/p/portfolio?q=%22%3E%3Cscript%3E'),
    );
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('No domains match');
  });

  it('round-trips the draft through backup after key rotation without republishing', async () => {
    const revision = await store.save(draft, null);
    expect(
      (await call('/publishing/publish', 'POST', { revision })).status,
    ).toBe(200);
    const backup = await publicationBackupMethods(store).exportData.handler();
    const rotatedStore = new PublicationStore(
      db,
      await aesGcmCipher(new Uint8Array(32).fill(9)),
    );
    await expect(rotatedStore.draft()).rejects.toThrow();
    await publicationBackupMethods(rotatedStore).importData.handler(backup);
    expect((await rotatedStore.draft()).draft).toEqual(draft);
    expect(await rotatedStore.published()).toBeNull();
  });

  it('rejects an invalid backup before changing publication state', async () => {
    const revision = await store.save(draft, null);
    expect(
      (await call('/publishing/publish', 'POST', { revision })).status,
    ).toBe(200);
    const methods = publicationBackupMethods(store);
    const backup = JSON.parse(await methods.exportData.handler());
    backup.publicationDraft = { ...draft, unexpected: 'private field' };
    await expect(
      methods.importData.handler(JSON.stringify(backup)),
    ).rejects.toThrow(/Nothing was imported/);
    expect((await store.published())?.revision).toBe(revision);
  });

  it('fails closed if a stored public projection contains private fields', async () => {
    await db
      .prepare(
        "INSERT INTO published_portfolios (id, handle, revision, payload) VALUES ('main', 'portfolio', 'test', ?1)",
      )
      .bind(
        JSON.stringify({
          ...draft,
          listings: [draft.listings[0]],
          publishedAt: Date.now(),
          credentials: 'NEVER_PUBLIC',
        }),
      )
      .run();
    const response = await call('/p/portfolio', 'GET', undefined, false);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('NEVER_PUBLIC');
    expect(privateReads).toBe(0);
  });

  it('preserves membership in multiple public collections when filtering', () => {
    const snapshot = {
      ...draft,
      publishedAt: Date.now(),
      listings: [
        {
          ...draft.listings[0],
          visibility: 'inquiry' as const,
          collection: 'Short names; Web3',
        },
      ],
    };
    const html = renderPortfolio(
      snapshot,
      new URL('http://localhost/p/portfolio?collection=Web3'),
    );
    expect(html).toContain('<option value="Short names">');
    expect(html).toContain('<option value="Web3" selected>');
    expect(html).toContain('visible.com');
    expect(
      renderPortfolio(
        snapshot,
        new URL('http://localhost/p/portfolio?collection=Other'),
      ),
    ).toContain('No domains match');
  });
});
