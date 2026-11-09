import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { isAuthenticated, sameOrigin, type AuthConfig } from './auth';
import { verifyGatewayRequest } from '../shared/gateway-proof';
import {
  ParkioError,
  parkioCredentialSchema,
  parkioSourceView,
} from '../shared/parkio';
import { parkioStore } from './parkio-runtime';
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
  })
  .strict();
export function createParkioRoutes(
  stateful: MiddlewareHandler<RouteEnv>,
  internal = false,
) {
  const app = new Hono<RouteEnv>();
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    if (c.env.DOMBOT_PARKIO_ENABLED !== 'true') {
      if (
        !internal &&
        c.req.method === 'GET' &&
        c.req.path.endsWith('/connectors/parkio')
      )
        return c.json({ enabled: false, sources: [] });
      return c.notFound();
    }
    if (!(await isAuthenticated(c.get('auth'), c.req.raw, c.env.DB)))
      return c.json({ error: 'not_signed_in' }, 401);
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
  app.use(
    '*',
    bodyLimit({
      maxSize: 65536,
      onError: (c) => c.json({ error: 'request_too_large' }, 413),
    }),
  );
  app.use('*', stateful);
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
    app.post('/activate', async (c) => {
      const p = activate.parse(await c.req.json());
      const s = await new ParkioSync(await parkioStore(c.env)).activate(
        p.sourceId,
        p.credential,
        p.expectedRevision,
        p.operationId,
      );
      return c.json(parkioSourceView(s.source, s.revision));
    });
    app.get('/state/:id', async (c) => {
      const s = await (
        await parkioStore(c.env)
      ).source(id.parse(c.req.param('id')));
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
      sources: (await store.sources()).map((s) =>
        parkioSourceView(s.source, s.revision),
      ),
    });
  });
  app.post('/:id/:action', async (c) => {
    const sourceId = id.parse(c.req.param('id')),
      p = revision.parse(await c.req.json()),
      action = z
        .enum(['refresh', 'pause', 'resume', 'disconnect', 'accept_review'])
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
