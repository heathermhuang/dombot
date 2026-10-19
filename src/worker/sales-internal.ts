import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { verifyGatewayRequest } from '../shared/gateway-proof';
import { deliveryStateSchema } from '../shared/sales';
import { SalesStore } from './sales-store';
import { SalesInquiryStore } from './sales-inquiry-store';
import {
  domainControlLeaseSchema,
  salesControlClockToleranceMs,
} from '../shared/sales-domain-control';
import {
  emailRelayGrantSchema,
  relayAdmissionSchema,
  relayMessageSchema,
} from '../shared/sales-relay';

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
      (c.req.path.endsWith('/host-binding') ||
      c.req.path.endsWith('/host-state') ||
      c.req.path.endsWith('/domain-control')
        ? 'sales-hostnames'
        : 'sales-notifications')
    )
      return c.json({ error: 'Internal admission required' }, 403);
    await next();
  });
  app.use('*', bodyLimit({ maxSize: 8192 }));
  app.get('/host-state', async (c) => {
    const id = z.string().uuid().parse(c.req.query('listing'));
    const row = await c.env.DB.prepare(
      "SELECT p.domain,p.revision FROM published_sales p JOIN sale_drafts d ON d.id=p.id WHERE p.id=? AND d.availability='available' AND d.control_expires_at>?",
    )
      .bind(id, Date.now())
      .first<{ domain: string; revision: string }>();
    return c.json({ published: row });
  });
  app.post('/domain-control', async (c) => {
    const v = domainControlLeaseSchema.parse(await c.req.json());
    if (v.valid && c.env.SALES_DNS_CONTROL_ENABLED !== 'true')
      return c.json({ ok: false }, 403);
    const now = Date.now();
    if (
      v.observedAt > now + salesControlClockToleranceMs ||
      (v.valid && v.expiresAt <= now)
    )
      return c.json({ ok: false }, 409);
    const store = await SalesStore.from(c.env),
      saved = await store.get(v.listing);
    if (saved.draft.domain !== v.domain) return c.json({ ok: false }, 409);
    const old = await c.env.DB.prepare(
      'SELECT * FROM sales_control_leases WHERE listing_id=?',
    )
      .bind(v.listing)
      .first<{
        epoch: number;
        review_after: number;
        observed_at: number;
        proof_id: string;
        expires_at: number;
        revoked_at: number | null;
      }>();
    if (
      old &&
      (old.epoch > v.epoch ||
        (old.epoch === v.epoch && old.observed_at >= v.observedAt))
    )
      return c.json(
        {
          ok:
            old.epoch === v.epoch &&
            old.observed_at === v.observedAt &&
            old.proof_id === v.proofId &&
            old.expires_at === v.expiresAt &&
            (old.revoked_at === null) === v.valid,
        },
        200,
      );
    const hash = await store.hash('domain', v.domain);
    await store.atomic([
      ...store.guard(
        'EXISTS(SELECT 1 FROM sale_drafts WHERE id=? AND domain_hash=?)',
        [v.listing, hash],
      ),
      ...store.guard(
        old
          ? 'EXISTS(SELECT 1 FROM sales_control_leases WHERE listing_id=? AND epoch=? AND observed_at=? AND revoked_at IS ?)'
          : 'NOT EXISTS(SELECT 1 FROM sales_control_leases WHERE listing_id=?)',
        old
          ? [v.listing, old.epoch, old.observed_at, old.revoked_at]
          : [v.listing],
      ),
      c.env.DB.prepare(
        'INSERT INTO sales_control_leases(listing_id,domain_hash,proof_id,epoch,review_after,observed_at,expires_at,revoked_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(listing_id) DO UPDATE SET domain_hash=excluded.domain_hash,proof_id=excluded.proof_id,epoch=excluded.epoch,review_after=excluded.review_after,observed_at=excluded.observed_at,expires_at=excluded.expires_at,revoked_at=excluded.revoked_at',
      ).bind(
        v.listing,
        hash,
        v.proofId,
        v.epoch,
        Math.max(v.reviewAfter, old?.review_after ?? 0),
        v.observedAt,
        v.expiresAt,
        v.valid ? null : now,
      ),
      ...(!v.valid || v.reviewAfter > (old?.review_after ?? 0)
        ? [
            c.env.DB.prepare(
              "UPDATE sale_drafts SET availability='ownership-uncertain',control_expires_at=0,operational_revision=? WHERE id=? AND availability='available'",
            ).bind(crypto.randomUUID(), v.listing),
          ]
        : v.valid
          ? [
              c.env.DB.prepare(
                "UPDATE sale_drafts SET control_expires_at=? WHERE id=? AND availability='available'",
              ).bind(v.expiresAt, v.listing),
            ]
          : []),
    ]);
    return c.json({ ok: true });
  });
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
  app.onError((error, c) =>
    c.json(
      { error: 'Sales notification state unavailable' },
      'status' in error && [403, 404, 409, 429].includes(Number(error.status))
        ? (Number(error.status) as 403 | 404 | 409 | 429)
        : 503,
    ),
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
      .object({
        id: z.string().uuid(),
        lease: z.string().uuid(),
        emailRelay: emailRelayGrantSchema.optional(),
      })
      .strict()
      .parse(await c.req.json());
    return c.json({
      ok: await (await inbox(c.env)).claim(v.id, v.lease, v.emailRelay),
    });
  });
  app.post('/relay-check', async (c) => {
    if (c.env.SALES_MAIL_ENABLED !== 'true') return c.json({ ok: false }, 403);
    await (
      await inbox(c.env)
    ).checkRelay(relayAdmissionSchema.parse(await c.req.json()));
    return c.json({ ok: true });
  });
  app.post('/relay-message', async (c) => {
    if (c.env.SALES_MAIL_ENABLED !== 'true') return c.json({ ok: false }, 403);
    await (
      await inbox(c.env)
    ).relayMessage(relayMessageSchema.parse(await c.req.json()));
    return c.json({ ok: true });
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
