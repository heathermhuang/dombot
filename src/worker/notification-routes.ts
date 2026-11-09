import {
  RenewalDecisionConflict,
  notificationPreferenceDraft,
} from '../core/services/renewal-decisions';
import { Hono, type MiddlewareHandler } from 'hono';
import type { AuthConfig } from './auth';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { verifyGatewayRequest } from '../shared/gateway-proof';
import { notificationPreferencesSchema } from '../shared/notification-policy';
import {
  NotificationStore,
  notificationSchemaReady,
} from './notification-store';
import {
  currentRenewalCandidates,
  decisionRecords,
  decideRenewal,
} from '../core/services/renewal-notifications';

export function createNotificationRoutes(
  stateful: MiddlewareHandler<{
    Bindings: Env;
    Variables: { auth: AuthConfig };
  }>,
) {
  const app = new Hono<{ Bindings: Env; Variables: { auth: AuthConfig } }>();
  app.use('*', bodyLimit({ maxSize: 16384 }));
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (Reflect.get(c.env, 'DOMBOT_NOTIFICATION_V1') !== 'true')
      return c.json({ error: 'Notifications are not enabled.' }, 404);
    const proof = await verifyGatewayRequest(
      c.env.DOMBOT_GATEWAY_SECRET ?? '',
      c.env.DOMBOT_WORKSPACE_ID ?? '',
      c.req.raw,
    );
    const internal = c.req.path.includes('/internal/');
    if (
      !proof ||
      proof.mcp ||
      (internal
        ? proof.owner !== null ||
          proof.sales?.purpose !== 'portfolio-notifications'
        : !proof.owner || !!proof.sales)
    )
      return c.json({ error: 'Notification admission required.' }, 403);
    if (
      !internal &&
      c.req.method !== 'GET' &&
      c.req.header('origin') !== new URL(c.req.url).origin
    )
      return c.json({ error: 'Bad origin' }, 403);
    if (!(await notificationSchemaReady(c.env.DB)))
      return c.json({ error: 'Notification storage is not ready.' }, 503);
    await next();
  });
  app.use('*', stateful);
  app.get('/preference-draft', (c) =>
    c.json({ preferences: notificationPreferenceDraft() }),
  );
  app.get('/decisions', async (c) => {
    const timeZone = c.req.query('timeZone') ?? 'UTC';
    notificationPreferencesSchema.shape.timeZone.parse(timeZone);
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(1000000)
      .parse(c.req.query('offset') ?? 0);
    const items = currentRenewalCandidates(timeZone),
      saved = decisionRecords();
    return c.json({
      count: items.length,
      items: items.slice(offset, offset + 20).map((i) => ({
        key: i.key,
        cycle: `${i.row.domain}|${i.row.date}`,
        ...i.row,
        stage: i.stage,
        decision:
          saved[`${i.row.domain}|${i.row.date}`] ?? saved[i.key] ?? null,
      })),
    });
  });
  app.post('/decisions', async (c) => {
    const body = z
      .object({
        key: z.string().max(600),
        value: z.enum(['expire', 'handled']).nullable(),
        revision: z.string().uuid().nullable(),
        timeZone: notificationPreferencesSchema.shape.timeZone,
      })
      .strict()
      .parse(await c.req.json());
    const items = currentRenewalCandidates(body.timeZone);
    if (
      !items.some(
        (i) =>
          body.key === i.key || body.key === `${i.row.domain}|${i.row.date}`,
      )
    )
      return c.json(
        { error: 'This renewal is no longer in the current review window.' },
        409,
      );
    try {
      await decideRenewal(body.key, body.value, body.revision);
    } catch (error) {
      if (error instanceof RenewalDecisionConflict)
        return c.json({ error: error.message }, 409);
      throw error;
    }
    return c.json({ ok: true });
  });
  app.post('/internal/prepare', async (c) => {
    const body = z
      .object({
        preferences: notificationPreferencesSchema,
        lastWeeklyAt: z.number().nullable(),
      })
      .strict()
      .parse(await c.req.json());
    const store = await NotificationStore.from(c.env);
    return c.json({
      id: await store.prepare(body.preferences, body.lastWeeklyAt),
    });
  });
  app.post('/internal/lease', async (c) =>
    c.json({ item: await (await NotificationStore.from(c.env)).lease() }),
  );
  app.post('/internal/claim', async (c) => {
    const body = z
      .object({
        id: z.string().uuid(),
        lease: z.string().uuid(),
        preferences: notificationPreferencesSchema,
      })
      .strict()
      .parse(await c.req.json());
    return c.json({
      ok: await (
        await NotificationStore.from(c.env)
      ).claim(body.id, body.lease, body.preferences),
    });
  });
  app.post('/internal/ack', async (c) => {
    const body = z
      .object({
        id: z.string().uuid(),
        lease: z.string().uuid(),
        state: z.enum([
          'accepted',
          'retryable',
          'unknown',
          'failed',
          'suppressed',
        ]),
        receipt: z.string().max(400).nullable(),
      })
      .strict()
      .parse(await c.req.json());
    return c.json({
      ok: await (
        await NotificationStore.from(c.env)
      ).ack(body.id, body.lease, body.state, body.receipt),
    });
  });
  app.get('/health', async (c) =>
    c.json({
      deliveries: await (await NotificationStore.from(c.env)).health(),
    }),
  );
  return app;
}
