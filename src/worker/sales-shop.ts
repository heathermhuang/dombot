import { z } from 'zod';
import { shopDraftSchema, publishedSaleSchema } from '../shared/sales';
import { SalesError } from '../shared/sales-review';

const amount = z
  .union([z.literal(''), z.string().regex(/^[0-9]{1,12}$/)])
  .default('');
export const shopQuerySchema = z
  .object({
    q: z.string().max(253).default(''),
    mode: z.enum(['', 'inquiry', 'offer', 'buy-now', 'external']).default(''),
    tld: z
      .string()
      .max(63)
      .regex(/^[a-z0-9-]*$/)
      .default(''),
    category: z.string().max(40).default(''),
    currency: z
      .string()
      .regex(/^(?:[A-Z]{3})?$/)
      .default(''),
    min: amount,
    max: amount,
    cursor: z.string().max(253).default(''),
  })
  .strict();
export async function publicShop(
  db: D1Database,
  handle: string,
  query: Record<string, string>,
) {
  const r = await db
    .prepare("SELECT published FROM sales_shop WHERE id='main'")
    .first<{ published: string | null }>();
  if (!r?.published) throw new SalesError('MISSING', 'Shop not found.', 404);
  const shop = shopDraftSchema.parse(JSON.parse(r.published)),
    f = shopQuerySchema.parse(query);
  if (shop.handle !== handle)
    throw new SalesError('MISSING', 'Shop not found.', 404);
  if ((f.min || f.max) && !f.currency)
    throw new SalesError(
      'CURRENCY_REQUIRED',
      'Choose a currency for the price range.',
    );
  const like = '%' + f.q.toLowerCase().replace(/[\\%_]/g, '\\$&') + '%';
  const rows = await db
    .prepare(
      `SELECT p.payload,p.domain FROM published_sales p JOIN sale_drafts d ON d.id=p.id
    WHERE d.availability='available' AND d.control_expires_at>? AND p.domain>? AND p.id IN (SELECT value FROM json_each(?))
    AND lower(p.domain) LIKE ? ESCAPE '\\' AND (?='' OR json_extract(p.payload,'$.mode')=?)
    AND (?='' OR p.domain LIKE ?) AND (?='' OR EXISTS(SELECT 1 FROM json_each(p.payload,'$.categories') WHERE value=?))
    AND (?='' OR json_extract(p.payload,'$.publicPrice.currency')=?)
    AND (?='' OR CAST(json_extract(p.payload,'$.publicPrice.amount') AS INTEGER)>=CAST(? AS INTEGER))
    AND (?='' OR CAST(json_extract(p.payload,'$.publicPrice.amount') AS INTEGER)<=CAST(? AS INTEGER))
    ORDER BY p.domain LIMIT 101`,
    )
    .bind(
      Date.now(),
      f.cursor,
      JSON.stringify(shop.listingIds),
      like,
      f.mode,
      f.mode,
      f.tld,
      `%.${f.tld}`,
      f.category,
      f.category,
      f.currency,
      f.currency,
      f.min,
      f.min,
      f.max,
      f.max,
    )
    .all<{ payload: string; domain: string }>();
  return {
    shop,
    filters: f,
    items: rows.results
      .slice(0, 100)
      .map((r) => publishedSaleSchema.parse(JSON.parse(r.payload))),
    cursor: rows.results.length > 100 ? rows.results[99].domain : null,
  };
}
const cell = (s: unknown) => '"' + String(s ?? '').replaceAll('"', '""') + '"';
/** Public allowlist only; this format is ours, not a claimed marketplace upload schema. */
export function publicSalesCsv(
  items: z.infer<typeof publishedSaleSchema>[],
): string {
  const rows = [
    [
      'domain',
      'sale_mode',
      'asking_amount',
      'currency',
      'minimum_offer_amount',
      'minimum_offer_currency',
      'provider',
      'destination',
    ],
    ...items.map((s) => [
      s.domain,
      s.mode,
      s.publicPrice?.amount ?? '',
      s.publicPrice?.currency ?? '',
      s.publicMinimumOffer?.amount ?? '',
      s.publicMinimumOffer?.currency ?? '',
      s.destination?.provider ?? '',
      s.destination?.url ?? '',
    ]),
  ];
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
