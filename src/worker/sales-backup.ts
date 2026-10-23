import { z } from 'zod';
import {
  saleDraftSchema,
  destinationSchema,
  shopDraftSchema,
  conversationStatusSchema,
} from '../shared/sales';
import { SalesStore } from './sales-store';
import { leadPayloadSchema, bodySchema } from './sales-inquiry-store';
import {
  saleOutcomeSchema,
  salesPublicationEventSchema,
} from '../shared/sales-events';

// Opaque operational grants, host bindings, reviews and delivery intents never travel.
const privateRow = z
  .object({ id: z.string().uuid(), payload: z.unknown() })
  .strict();
export const salesBackupSchema = z
  .object({
    version: z.literal(1),
    drafts: z.array(saleDraftSchema).max(20_000),
    destinations: z.array(destinationSchema).max(100),
    shop: shopDraftSchema.nullable(),
    suppressions: z
      .array(
        z
          .object({
            email: z.string().email().max(254),
            expiresAt: z.number().int().positive(),
          })
          .strict(),
      )
      .max(100_000)
      .default([]),
    leads: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            listingId: z.string().uuid(),
            verification: z.enum(['pending', 'verified', 'blocked', 'expired']),
            status: conversationStatusSchema,
            createdAt: z.number().int().nonnegative(),
            updatedAt: z.number().int().nonnegative(),
            followUpAt: z.number().nullable(),
            payload: leadPayloadSchema,
          })
          .strict(),
      )
      .max(100_000),
    messages: z
      .array(
        privateRow.extend({
          leadId: z.string().uuid(),
          direction: z.enum(['reply', 'buyer', 'private-note']),
          createdAt: z.number().int().nonnegative(),
          payload: bodySchema,
          sequence: z.number().int().positive(),
        }),
      )
      .max(100_000),
    events: z
      .array(
        privateRow.extend({
          listingId: z.string().uuid().nullable(),
          leadId: z.string().uuid().nullable(),
          kind: z.enum(['outcome', 'publication']),
          createdAt: z.number().int().nonnegative(),
          payload: z.union([saleOutcomeSchema, salesPublicationEventSchema]),
        }),
      )
      .max(100_000),
  })
  .strict()
  .superRefine((v, ctx) => {
    const drafts = new Set(v.drafts.map((d) => d.id)),
      leads = new Set(v.leads.map((d) => d.id));
    if (
      drafts.size !== v.drafts.length ||
      leads.size !== v.leads.length ||
      v.leads.some((l) => !drafts.has(l.listingId)) ||
      v.messages.some((m) => !leads.has(m.leadId))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Invalid sales backup relationships.',
      });
    if (
      v.events.some((e) =>
        e.kind === 'publication'
          ? !salesPublicationEventSchema.safeParse(e.payload).success
          : !saleOutcomeSchema.safeParse(e.payload).success,
      )
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Sales event kind does not match its payload.',
      });
    const draftsById = new Map(v.drafts.map((d) => [d.id, d])),
      leadsById = new Map(v.leads.map((l) => [l.id, l]));
    if (
      new Set(v.drafts.map((d) => d.domain)).size !== v.drafts.length ||
      new Set(v.destinations.map((d) => d.id)).size !== v.destinations.length ||
      new Set(v.messages.map((m) => m.id)).size !== v.messages.length ||
      new Set(v.messages.map((m) => `${m.leadId}:${m.sequence}`)).size !==
        v.messages.length ||
      new Set(v.events.map((e) => e.id)).size !== v.events.length ||
      v.leads.some(
        (l) =>
          l.payload.snapshot.id !== l.listingId ||
          l.payload.snapshot.domain !== draftsById.get(l.listingId)?.domain,
      ) ||
      v.messages.some((m) =>
        m.direction === 'reply'
          ? m.payload.recipient !== leadsById.get(m.leadId)?.payload.email
          : m.payload.recipient !== null,
      )
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Sales backup contains conflicting identities or recipient relationships.',
      });
  });
export async function hasSales(db: D1Database): Promise<boolean> {
  return !!(await db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='sale_drafts'",
    )
    .first());
}

/** Include private, published and operational state, even when there are no drafts. */
export async function hasSalesData(db: D1Database): Promise<boolean> {
  // These identifiers are fixed schema names, never caller-controlled input.
  const tables = [
    'sale_drafts',
    'sale_destinations',
    'published_sales',
    'sales_reviews',
    'sales_review_items',
    'sales_shop',
    'sales_shop_reviews',
    'sales_jobs',
    'sales_job_items',
    'sales_events',
    'sales_host_bindings',
    'sales_leads',
    'sales_messages',
    'sales_tokens',
    'sales_outbox',
    'sales_abuse',
    'sales_suppression',
  ];
  const row = await db
    .prepare(
      `SELECT ${tables.map((table) => `EXISTS(SELECT 1 FROM ${table})`).join(' OR ')} AS present`,
    )
    .first<{ present: number }>();
  return row?.present !== 0;
}
export async function exportSales(
  store: SalesStore,
): Promise<z.infer<typeof salesBackupSchema>> {
  const read = async (table: string) =>
    (
      await store.db
        .prepare(`SELECT * FROM ${table} LIMIT 100001`)
        .all<Record<string, unknown>>()
    ).results;
  const drafts = await read('sale_drafts'),
    destinations = await read('sale_destinations'),
    leads = await read('sales_leads'),
    messages = await read('sales_messages'),
    events = await read('sales_events');
  const open = async (r: Record<string, unknown>) =>
    JSON.parse(await store.cipher.open(String(r.sealed)));
  return salesBackupSchema.parse({
    version: 1,
    suppressions: await Promise.all(
      (await read('sales_suppression')).map(async (r) => ({
        email: z.object({ email: z.string().email() }).parse(await open(r))
          .email,
        expiresAt: r.expires_at,
      })),
    ),
    drafts: await Promise.all(
      drafts.map(async (r) => saleDraftSchema.parse(await open(r))),
    ),
    destinations: await Promise.all(
      destinations.map(async (r) => destinationSchema.parse(await open(r))),
    ),
    shop: (await store.shop()).revision ? (await store.shop()).draft : null,
    leads: await Promise.all(
      leads.map(async (r) => ({
        id: r.id,
        listingId: r.listing_id,
        verification: r.verification,
        status: r.status,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        followUpAt: r.follow_up_at,
        payload: await open(r),
      })),
    ),
    messages: await Promise.all(
      messages.map(async (r) => ({
        id: r.id,
        leadId: r.lead_id,
        direction: r.direction,
        sequence: r.sequence,
        createdAt: r.created_at,
        payload: await open(r),
      })),
    ),
    events: await Promise.all(
      events.map(async (r) => ({
        id: r.id,
        listingId: r.listing_id,
        leadId: r.lead_id,
        kind: r.kind,
        createdAt: r.created_at,
        payload: await open(r),
      })),
    ),
  });
}
/** Pack sealed rows into bounded JSON inserts so backups do not issue one D1 query per row. */
function rowInserts(
  db: D1Database,
  table: string,
  columns: string[],
  rows: (string | number | null)[][],
): D1PreparedStatement[] {
  const result: D1PreparedStatement[] = [],
    encoder = new TextEncoder();
  let parts: string[] = [],
    bytes = 2;
  const flush = () => {
    if (!parts.length) return;
    result.push(
      db
        .prepare(
          `INSERT INTO ${table} (${columns.join(',')}) SELECT ${columns.map((_, i) => `json_extract(value,'$[${i}]')`).join(',')} FROM json_each(?)`,
        )
        .bind('[' + parts.join(',') + ']'),
    );
    parts = [];
    bytes = 2;
  };
  for (const row of rows) {
    const part = JSON.stringify(row),
      size = encoder.encode(part).byteLength;
    if (size > 750000) throw new Error('A sales backup row is too large.');
    if (bytes + size + 1 > 750000) flush();
    parts.push(part);
    bytes += size + 1;
  }
  flush();
  return result;
}
export async function restoreSales(
  store: SalesStore,
  raw: unknown,
): Promise<void> {
  const v = salesBackupSchema.parse(raw),
    writes: D1PreparedStatement[] = [];
  const drafts: (string | number | null)[][] = [];
  for (const d of v.drafts)
    drafts.push([
      d.id,
      await store.hash('domain', d.domain),
      crypto.randomUUID(),
      crypto.randomUUID(),
      'paused',
      await store.seal(d),
      Date.now(),
      ...(await store.indexFields(d)),
    ]);
  writes.push(
    ...rowInserts(
      store.db,
      'sale_drafts',
      [
        'id',
        'domain_hash',
        'revision',
        'operational_revision',
        'availability',
        'sealed',
        'updated_at',
        'mode',
        'uses_portfolio',
        'source_price_hash',
      ],
      drafts,
    ),
  );
  const destinations: (string | number | null)[][] = [];
  for (const d of v.destinations) {
    const revision = crypto.randomUUID();
    destinations.push([
      d.id,
      revision,
      await store.seal({
        ...d,
        revision,
        check: d.check === 'verified' ? 'manual' : d.check,
        checkedAt: null,
      }),
    ]);
  }
  writes.push(
    ...rowInserts(
      store.db,
      'sale_destinations',
      ['id', 'revision', 'sealed'],
      destinations,
    ),
  );
  if (v.shop)
    writes.push(
      store.db
        .prepare(
          "INSERT INTO sales_shop(id,revision,sealed) VALUES('main',?,?)",
        )
        .bind(crypto.randomUUID(), await store.seal(v.shop)),
    );
  const leads: (string | number | null)[][] = [];
  for (const l of v.leads)
    leads.push([
      l.id,
      l.listingId,
      await store.hash('request', `restored:${l.id}`),
      await store.hash('payload', JSON.stringify(l.payload)),
      await store.hash('email', l.payload.email),
      crypto.randomUUID(),
      l.verification === 'verified' ? 'expired' : l.verification,
      l.status,
      Math.min(l.createdAt, Date.now()),
      Math.min(l.updatedAt, Date.now()),
      l.followUpAt,
      await store.seal(l.payload),
    ]);
  writes.push(
    ...rowInserts(
      store.db,
      'sales_leads',
      [
        'id',
        'listing_id',
        'request_hash',
        'payload_hash',
        'email_hash',
        'revision',
        'verification',
        'status',
        'created_at',
        'updated_at',
        'follow_up_at',
        'sealed',
      ],
      leads,
    ),
  );
  const messages: (string | number | null)[][] = [];
  for (const m of v.messages)
    messages.push([
      m.id,
      m.leadId,
      await store.hash('message-request', `restored:${m.id}`),
      await store.hash('message-payload', JSON.stringify(m.payload)),
      m.direction,
      m.createdAt,
      await store.seal(m.payload),
      m.sequence,
    ]);
  writes.push(
    ...rowInserts(
      store.db,
      'sales_messages',
      [
        'id',
        'lead_id',
        'request_hash',
        'payload_hash',
        'direction',
        'created_at',
        'sealed',
        'sequence',
      ],
      messages,
    ),
  );
  const events: (string | number | null)[][] = [];
  for (const e of v.events)
    events.push([
      e.id,
      e.listingId,
      e.leadId,
      e.kind,
      e.createdAt,
      await store.seal(e.payload),
      Date.now(),
      'restored',
    ]);
  writes.push(
    ...rowInserts(
      store.db,
      'sales_events',
      [
        'id',
        'listing_id',
        'lead_id',
        'kind',
        'created_at',
        'sealed',
        'reconciled_at',
        'provenance',
      ],
      events,
    ),
  );
  const suppression: (string | number | null)[][] = [];
  for (const entry of v.suppressions)
    if (entry.expiresAt > Date.now())
      suppression.push([
        await store.hash('suppression-email', entry.email),
        entry.expiresAt,
        await store.seal({ email: entry.email }),
      ]);
  writes.push(
    ...rowInserts(
      store.db,
      'sales_suppression',
      ['email_hash', 'expires_at', 'sealed'],
      suppression,
    ),
  );
  // Every payload and row is validated and resealed before the one atomic replacement.
  await store.db.batch([
    ...[
      'sales_events',
      'sales_leads',
      'sales_reviews',
      'sales_shop_reviews',
      'sales_jobs',
      'sales_shop',
      'sales_host_bindings',
      'sale_drafts',
      'sale_destinations',
      'sales_abuse',
      'sales_suppression',
    ].map((table) => store.db.prepare(`DELETE FROM ${table}`)),
    ...writes,
  ]);
}
