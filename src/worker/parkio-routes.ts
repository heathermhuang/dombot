import { readParkio } from './parkio-transport';
import { hasParkio } from './parkio-backup';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import {
  isAuthenticated,
  sameOrigin,
  buildAuthConfig,
  type AuthConfig,
} from './auth';
import { parseRootSecret } from './keys';
import { verifyGatewayRequest } from '../shared/gateway-proof';
import {
  ParkioError,
  parkioCredentialSchema,
  parkioSourceView,
} from '../shared/parkio';
import { parkioStore, parkioAutomaticUpdates } from './parkio-runtime';
import { ParkioSync } from './parkio-sync';
type RouteEnv = { Bindings: Env; Variables: { auth: AuthConfig } };
const id = z.string().uuid();
const revision = z.object({ revision: z.string().uuid() }).strict();
const activate = z
  .object({
    sourceId: id,
    operationId: id,
    expectedRevision: id.nullable(),
    credential: parkioCredentialSchema,
    initialCheckAt: z.number().int().positive().nullable().optional(),
  })
  .strict();
export function createParkioRoutes(internal = false) {
  const app = new Hono<RouteEnv>();
  app.use(
    '*',
    bodyLimit({
      maxSize: 65536,
      onError: (c) => c.json({ error: 'request_too_large' }, 413),
    }),
  );
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header(
      'Content-Security-Policy',
      "default-src 'none';frame-ancestors 'none'",
    );
    c.set(
      'auth',
      await buildAuthConfig(c.env, parseRootSecret(c.env.DOMBOT_SECRET)),
    );
    c.header('X-Robots-Tag', 'noindex, nofollow');
    if (!(await isAuthenticated(c.get('auth'), c.req.raw, c.env.DB)))
      return c.json({ error: 'not_signed_in' }, 401);
    if (c.env.DOMBOT_PARKIO_ENABLED !== 'true') {
      if (
        !internal &&
        c.req.method === 'GET' &&
        /\/connectors\/parkio\/?$/.test(c.req.path)
      )
        return c.json({
          enabled: false,
          sources: (await hasParkio(c.env.DB))
            ? (await (await parkioStore(c.env)).sources()).map((s) =>
                parkioSourceView(s.source, s.revision),
              )
            : [],
        });
      if (
        internal ||
        c.req.method === 'GET' ||
        !/\/(?:disconnect|pause|reject_review)$/.test(c.req.path)
      )
        return c.notFound();
    }
    if (internal) {
      if (c.env.DOMBOT_AUTH !== 'gateway') return c.notFound();
      const proof = await verifyGatewayRequest(
        c.env.DOMBOT_GATEWAY_SECRET ?? '',
        c.env.DOMBOT_WORKSPACE_ID ?? '',
        c.req.raw,
      );
      if (!proof?.owner || proof.mcp)
        return c.json({ error: 'trusted_gateway_required' }, 403);
    } else if (c.req.method !== 'GET' && !sameOrigin(c.req.raw))
      return c.json({ error: 'bad_origin' }, 403);
    return next();
  });

  app.onError((error, c) => {
    const code =
      error instanceof ParkioError
        ? error.code
        : error instanceof z.ZodError
          ? 'invalid_request'
          : 'connector_unavailable';
    return c.json({ error: code }, code === 'invalid_request' ? 400 : 409);
  });
  if (internal) {
    app.post('/qualify', async (c) => {
      const p = z
        .object({
          credential: parkioCredentialSchema,
          baselineDigest: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict()
        .parse(await c.req.json());
      const read = await readParkio(p.credential);
      const payload = read.records
        ? JSON.stringify(
            read.records.map((r) => ({
              domain: r.domain,
              expirationDate: r.expirationDate,
            })),
          )
        : null;
      const bytes =
        payload === null
          ? null
          : new Uint8Array(
              await crypto.subtle.digest(
                'SHA-256',
                new TextEncoder().encode(payload),
              ),
            );
      const digest = bytes
        ? Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
        : null;
      return c.json({
        receipt: {
          passed: !read.error,
          accountIdentityMatch: read.accountIdentityVerified === true,
          count: read.records?.length ?? null,
          baselineMatch: digest === p.baselineDigest,
          cookieRotationObserved:
            JSON.stringify(read.credential?.cookies) !==
            JSON.stringify(p.credential.cookies),
          error: read.error ?? null,
          checkedAt: Date.now(),
        },
        credential: read.credential,
      });
    });
    app.post('/activate', async (c) => {
      const p = activate.parse(await c.req.json());
      const s = await new ParkioSync(await parkioStore(c.env)).activate(
        p.sourceId,
        p.credential,
        p.expectedRevision,
        p.operationId,
        p.initialCheckAt ?? undefined,
      );
      return c.json(parkioSourceView(s.source, s.revision));
    });
    app.get('/state/:id', async (c) => {
      const store = await parkioStore(c.env);
      let s = await store.source(id.parse(c.req.param('id')));
      if (s?.source.run && s.source.run.expiresAt <= Date.now())
        s = await new ParkioSync(store).refresh(s.source.id);
      return c.json(s ? parkioSourceView(s.source, s.revision) : null);
    });

    return app;
  }
  app.get('/', async (c) => {
    const store = await parkioStore(c.env);
    const sync = new ParkioSync(store);
    for (const s of await store.sources())
      if (s.source.run && s.source.run.expiresAt <= Date.now())
        await sync.refresh(s.source.id);
    return c.json({
      enabled: true,
      automaticUpdates: await parkioAutomaticUpdates(c.env),
      sources: (await store.sources()).map((s) =>
        parkioSourceView(s.source, s.revision),
      ),
    });
  });
  app.get('/:id/review', async (c) => {
    const sourceId = id.parse(c.req.param('id'));
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(20000)
      .parse(c.req.query('offset') ?? 0);
    const store = await parkioStore(c.env),
      current = await store.source(sourceId);
    if (!current?.source.pending) throw new ParkioError('review_unavailable');
    const source = current.source;
    const previous = new Map(
      (await store.records(source)).map((r) => [r.domain, r]),
    );
    const changes = (
      await store.records(source, source.pending!.generation)
    ).flatMap((r) => {
      const p = previous.get(r.domain);
      const missing = !!r.missingSince && !p?.missingSince;
      if (
        p &&
        !missing &&
        p.expirationDate === r.expirationDate &&
        p.orderId === r.orderId
      )
        return [];
      return [
        {
          domain: r.domain,
          kind: !p ? 'added' : missing ? 'missing' : 'updated',
          previousExpirationDate: p?.expirationDate ?? null,
          expirationDate: r.expirationDate,
        },
      ];
    });
    return c.json({
      revision: current.revision,
      total: changes.length,
      changes: changes.slice(offset, offset + 100),
      offset,
    });
  });
  app.post('/:id/:action', async (c) => {
    const sourceId = id.parse(c.req.param('id')),
      p = revision.parse(await c.req.json()),
      action = z
        .enum([
          'refresh',
          'pause',
          'resume',
          'disconnect',
          'accept_review',
          'reject_review',
        ])
        .parse(c.req.param('action'));
    const store = await parkioStore(c.env);
    const current = await store.source(sourceId);
    if (!current || current.revision !== p.revision)
      throw new ParkioError('conflict');
    const sync = new ParkioSync(store);
    const s =
      action === 'refresh'
        ? await sync.refresh(sourceId, true)
        : await sync.update(sourceId, p.revision, action);
    return c.json(parkioSourceView(s.source, s.revision));
  });
  return app;
}

const parkioApp = new Hono<RouteEnv>();
parkioApp.route('/connectors/parkio', createParkioRoutes());
parkioApp.route('/internal/parkio', createParkioRoutes(true));
export const parkioFetch = parkioApp.fetch;
