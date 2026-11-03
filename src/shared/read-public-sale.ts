import { publishedSaleSchema, type PublishedSale } from './hosted-sales';
import type { PublishedReadDatabase } from './published-sales-links';

/** Published projection and eligibility metadata only; never initialize private storage. */
export async function readPublicSale(
  db: PublishedReadDatabase,
  domain: string,
  now = Date.now(),
): Promise<PublishedSale | null> {
  const r = await db
    .prepare(
      "SELECT p.payload,d.availability FROM published_sales p JOIN sale_drafts d ON d.id=p.id WHERE p.domain=? AND d.availability IN ('available','source-stale') AND d.control_expires_at>?",
    )
    .bind(domain, now)
    .first<{ payload: string; availability: string }>();
  if (!r) return null;
  const sale = publishedSaleSchema.parse(JSON.parse(r.payload));
  if (
    r.availability === 'source-stale' ||
    (sale.sourceValidUntil != null && sale.sourceValidUntil <= now)
  ) {
    if (!sale.destination && !sale.allowQuestions && sale.mode !== 'inquiry')
      return null;
    return {
      ...sale,
      publicPrice: null,
      publicMinimumOffer: null,
      mode: sale.destination ? 'external' : 'inquiry',
      providerIntent: sale.destination ? 'view' : undefined,
    };
  }
  return sale;
}
