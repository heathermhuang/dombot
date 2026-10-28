import { afterEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { emptyDraft, privateListing } from '../shared/publication';
import type { Domain, RegistrarMeta } from '../shared/ipc';
import { createPublicationRoutes } from './publication-routes';
import { PublicationReadCache } from './publication-inputs';

const fixture = vi.hoisted(() => ({ draft: {}, published: null }));
vi.mock('./auth', () => ({
  isAuthenticated: async (_auth: unknown, request: Request) =>
    request.headers.get('Authorization') === 'owner',
  sameOrigin: () => true,
}));
vi.mock('./publication-store', async (original) => ({
  ...(await original<typeof import('./publication-store')>()),
  PublicationStore: class {
    async draft() {
      return { draft: fixture.draft, revision: null };
    }
    async published() {
      return fixture.published;
    }
  },
}));
afterEach(() => vi.restoreAllMocks());

it.each(['/publishing', '/publishing/site'])(
  'reads %s while provider work holds the stateful queue, but never bypasses it for writes',
  async (path) => {
    fixture.draft = emptyDraft();
    let entered!: () => void;
    let release!: () => void;
    const queued = new Promise<null>((resolve) => {
      entered = () => resolve(null);
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const stateful = vi.fn(async (_c, next) => {
      entered();
      await held;
      await next();
    });
    const now = Date.now();
    const input = {
      domains: [
        {
          domainName: 'example.com',
          registrar: 'dynadot',
          accountId: 'dynadot',
        },
      ] as Domain[],
      accounts: [
        {
          name: 'dynadot',
          displayName: 'Dynadot',
          accountId: 'dynadot',
          configured: true,
          saved: true,
          enabled: true,
          sync: { lastSyncedAt: now, lastError: null, domainCount: 1 },
        },
      ] as RegistrarMeta[],
    };
    const app = new Hono();
    app.route(
      '/publishing',
      createPublicationRoutes(stateful, () => input),
    );
    const env = {
      DOMBOT_SECRET: btoa('synthetic-test-root-key-32-bytes!!'),
    } as Env;
    const read = app.request(
      path,
      { headers: { Authorization: 'owner' } },
      env,
    );
    try {
      const response = await Promise.race([read, queued]);
      expect(
        response,
        'a read must not enter the held provider queue',
      ).not.toBeNull();
      expect(response!.status).toBe(200);
      expect(response!.headers.get('Cache-Control')).toBe('no-store');
      expect(await response!.json()).toMatchObject({
        review: [
          expect.objectContaining({
            domain: 'example.com',
            ownership: 'owned',
          }),
        ],
      });
      expect(stateful).not.toHaveBeenCalled();
      const denied = await app.request(path, {}, env);
      expect(denied.status).toBe(401);
      const write = app.request(
        path,
        { method: 'PUT', headers: { Authorization: 'owner' } },
        env,
      );
      expect(await Promise.race([write, queued])).toBeNull();
    } finally {
      release();
      await read;
    }
  },
);

it('rechecks the age of cached ownership rather than freezing a healthy verdict', async () => {
  fixture.draft = {
    ...emptyDraft(),
    listings: [privateListing('example.com')],
  };
  const app = new Hono();
  app.route(
    '/publishing',
    createPublicationRoutes(
      async (_c, next) => next(),
      () => ({
        domains: [
          { domainName: 'example.com', registrar: 'dynadot' },
        ] as Domain[],
        accounts: [
          {
            name: 'dynadot',
            configured: true,
            enabled: true,
            sync: { lastSyncedAt: Date.now() - 86_400_001, lastError: null },
          },
        ] as RegistrarMeta[],
      }),
    ),
  );
  const response = await app.request(
    '/publishing',
    { headers: { Authorization: 'owner' } },
    { DOMBOT_SECRET: btoa('synthetic-test-root-key-32-bytes!!') } as Env,
  );
  expect(await response.json()).toMatchObject({
    review: [expect.objectContaining({ ownership: 'stale' })],
  });
});

it('detaches completed inventory from subsequent mutations and clears it on reset', () => {
  const cache = new PublicationReadCache();
  const input = { domains: [] as Domain[], accounts: [] as RegistrarMeta[] };
  expect(cache.read()).toBeNull();
  cache.capture(input);
  input.domains.push({ domainName: 'in-flight.example' } as Domain);
  expect(cache.read()?.domains).toEqual([]);
  const first = cache.read();
  cache.capture(input);
  expect(cache.read()?.domains).toHaveLength(1);
  expect(first?.domains).toEqual([]);
  cache.clear();
  expect(cache.read()).toBeNull();
});
