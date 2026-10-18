import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { verifyGatewayRequest } from '../shared/gateway-proof';
import { deliveryStateSchema } from '../shared/sales';
import { SalesStore } from './sales-store';
import { SalesInquiryStore } from './sales-inquiry-store';

/** Not on the gateway's anonymous or owner route allowlist. */
export function createSalesInternalRoutes() {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    const proof = await verifyGatewayRequest(
      c.env.DOMBOT_GATEWAY_SECRET ?? '',
      c.env.DOMBOT_WORKSPACE_ID ?? '',
      c.req.raw,
    );
    if (
      proof?.sales?.purpose !==
      (c.req.path.endsWith('/host-binding')
        ? 'sales-hostnames'
        : 'sales-notifications')
    )
      return c.json({ error: 'Internal admission required' }, 403);
    await next();
  });
  app.use('*', bodyLimit({ maxSize: 8192 }));
  app.post('/host-binding', async (c) => {
    const v = z
      .object({
        hostname: z.string().max(253),
        listing: z.string().uuid(),
        epoch: z.number().int().positive(),
        enabled: z.boolean(),
      })
      .strict()
      .parse(await c.req.json());
    const r = await c.env.DB.prepare(
      'INSERT INTO sales_host_bindings(hostname,listing_id,epoch,enabled) VALUES(?,?,?,?) ON CONFLICT(hostname) DO UPDATE SET listing_id=excluded.listing_id,epoch=excluded.epoch,enabled=excluded.enabled WHERE sales_host_bindings.epoch<=excluded.epoch RETURNING hostname',
    )
      .bind(v.hostname, v.listing, v.epoch, v.enabled ? 1 : 0)
      .first();
    return c.json({ ok: !!r }, r ? 200 : 409);
  });
  app.onError((_error, c) =>
    c.json({ error: 'Sales notification state unavailable' }, 503),
  );
  app.get('/due', async (c) => {
    const r = await c.env.DB.prepare(
      "SELECT min(CASE WHEN state='leased' THEN lease_expires_at ELSE due_at END) AS due_at FROM sales_outbox WHERE state IN ('queued','retryable','leased')",
    ).first<{ due_at: number | null }>();
    return c.json({ dueAt: r?.due_at ?? null });
  });
  const inbox = async (env: Env) =>
    new SalesInquiryStore(
      await SalesStore.from(env),
      env.DOMBOT_SALES_ORIGIN ?? 'https://unconfigured.invalid',
    );
  app.post('/lease', async (c) => {
    if (c.env.SALES_MAIL_ENABLED !== 'true') return c.json({ items: [] });
    return c.json({ items: await (await inbox(c.env)).lease() });
  });
  app.post('/claim', async (c) => {
    if (c.env.SALES_MAIL_ENABLED !== 'true') return c.json({ ok: false });
    const v = z
      .object({ id: z.string().uuid(), lease: z.string().uuid() })
      .strict()
      .parse(await c.req.json());
    return c.json({ ok: await (await inbox(c.env)).claim(v.id, v.lease) });
  });
  app.post('/ack', async (c) => {
    const v = z
      .object({
        id: z.string().uuid(),
        lease: z.string().uuid(),
        state: deliveryStateSchema,
        receipt: z.string().max(200).nullable(),
        retryAfter: z.number().int().min(60_000).max(86400_000).optional(),
      })
      .strict()
      .parse(await c.req.json());
    await (
      await inbox(c.env)
    ).ack(v.id, v.lease, v.state, v.receipt, v.retryAfter);
    return c.json({ ok: true });
  });
  app.post('/cleanup', async (c) => {
    await (await inbox(c.env)).cleanup();
    return c.json({ ok: true });
  });
  return app;
}
