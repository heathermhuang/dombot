import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { verifyGatewayRequest } from '../shared/gateway-proof';
import {
  hostingPlanSchema,
  landerSelectionSchema,
} from '../shared/lander-connection';
import { SalesStore } from './sales-store';
import { LanderJobs } from './lander-jobs';
import { createVerifiedSaleObserver } from './sales-observation';
import { salesInventoryNames } from './sales-routes';
import { SalesError } from '../shared/sales-review';
import type { AuthConfig } from './auth';

// Mounted under sales-internal after the stateful coordinator is available.
// The public gateway never forwards this namespace from a user request.
export function createLanderRoutes(
  stateful: MiddlewareHandler<{
    Bindings: Env;
    Variables: { auth: AuthConfig };
  }>,
) {
  const app = new Hono<{
    Bindings: Env;
    Variables: { auth: AuthConfig; recipient: boolean };
  }>();
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    const proof = await verifyGatewayRequest(
      c.env.DOMBOT_GATEWAY_SECRET ?? '',
      c.env.DOMBOT_WORKSPACE_ID ?? '',
      c.req.raw,
    );
    if (proof?.sales?.purpose !== 'sales-connections')
      return c.json({ error: 'Connection controller admission required' }, 403);
    c.set('recipient', proof.sales.recipientVerified);
    await next();
  });
  app.use('*', bodyLimit({ maxSize: 750000 }));
  app.use('*', stateful);
  const controller = async (env: Env) =>
    new LanderJobs(await SalesStore.from(env), createVerifiedSaleObserver(env));
  app.get('/work', async (c) =>
    c.json({ work: await (await controller(c.env)).work() }),
  );
  app.get('/due', async (c) =>
    c.json({ due: await (await controller(c.env)).due() }),
  );
  app.post('/step', async (c) => {
    const v = z
      .object({
        job: z.string().uuid(),
        ordinal: z.number().int().nonnegative(),
        generation: z.string().uuid(),
        hosts: z.array(hostingPlanSchema).length(2).optional(),
        hostingState: z.string().max(300).optional(),
      })
      .strict()
      .parse(await c.req.json());
    await (await controller(c.env)).step(v, v.hosts, v.hostingState);
    const item = await c.env.DB.prepare(
      'SELECT state FROM lander_items WHERE job_id=? AND ordinal=? AND generation=?',
    )
      .bind(v.job, v.ordinal, v.generation)
      .first<{ state: string }>();
    return c.json({ ok: true, state: item?.state ?? null });
  });
  app.post('/jobs', async (c) => {
    if (c.env.DOMBOT_SALES_V1 !== 'true')
      return c.json({ error: 'Sales editing is disabled.' }, 403);
    if (!c.get('recipient'))
      return c.json(
        { error: 'Confirm the account email before preparing inquiry pages.' },
        409,
      );
    const v = z
      .object({ id: z.string().uuid(), selection: landerSelectionSchema })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await (
        await controller(c.env)
      ).create(v.selection, v.id, () => salesInventoryNames(c.env)),
    );
  });
  app.get('/jobs', async (c) =>
    c.json({
      items: (
        await c.env.DB.prepare(
          'SELECT id,state,total,updated_at FROM lander_jobs ORDER BY created_at DESC LIMIT 20',
        ).all()
      ).results,
    }),
  );
  app.get('/jobs/:id', async (c) =>
    c.json(
      await (
        await controller(c.env)
      ).get(
        z.string().uuid().parse(c.req.param('id')),
        z.coerce
          .number()
          .int()
          .min(-1)
          .parse(c.req.query('cursor') ?? -1),
      ),
    ),
  );
  app.post('/jobs/:id/:action', async (c) => {
    const id = z.string().uuid().parse(c.req.param('id')),
      action = c.req.param('action'),
      jobs = await controller(c.env);
    if (action === 'cancel') return c.json(await jobs.cancel(id));
    if (action === 'restore') return c.json(await jobs.restore(id));
    if (action === 'approve') {
      if (c.env.DOMBOT_SALES_V1 !== 'true' || !c.get('recipient'))
        return c.json(
          { error: 'Current publication and recipient admission required.' },
          403,
        );
      const v = z
        .object({ digest: z.string().length(64) })
        .strict()
        .parse(await c.req.json());
      return c.json(await jobs.approve(id, v.digest));
    }
    return c.json({ error: 'Not found' }, 404);
  });
  app.onError((e, c) =>
    e instanceof SalesError
      ? c.json({ error: e.message, code: e.code }, e.status)
      : c.json(
          {
            error:
              e instanceof z.ZodError
                ? 'Check the connection request fields.'
                : 'Connection state unavailable.',
          },
          503,
        ),
  );
  return app;
}
