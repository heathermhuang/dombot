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
      "SELECT p.payload FROM published_sales p JOIN sale_drafts d ON d.id=p.id WHERE p.domain=? AND d.availability='available' AND d.control_expires_at>?",
    )
    .bind(domain, now)
    .first<{ payload: string }>();
  return r ? publishedSaleSchema.parse(JSON.parse(r.payload)) : null;
}
