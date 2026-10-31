export interface PublishedReadStatement {
  bind(...values: (string | number | null)[]): PublishedReadStatement;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
}
export interface PublishedReadDatabase {
  prepare(sql: string): PublishedReadStatement;
}
import { publishedSaleSchema, type PublishedSale } from './sales';
import {
  publishedOwnerSiteV3Schema,
  type PublishedOwnerSiteV3,
} from './owner-site';
import { publicDomainUrl, canonicalPublicUrl } from './public-publishing-links';
import type { ResolvedSiteLink } from './render-owner-site';
/** One allowlisted published/eligibility query, independent of rendered row count. */
export async function publicLinkedSales(
  db: PublishedReadDatabase,
  site: PublishedOwnerSiteV3,
  origin: string | undefined,
): Promise<Map<string, ResolvedSiteLink>> {
  const ids = [...new Set(site.salesLinks.map((l) => l.listingId))];
  const rows = ids.length
    ? (
        await db
          .prepare(
            'SELECT p.payload,d.availability,d.control_expires_at FROM published_sales p JOIN sale_drafts d ON d.id=p.id WHERE p.id IN (SELECT value FROM json_each(?))',
          )
          .bind(JSON.stringify(ids))
          .all<{
            payload: string;
            availability: string;
            control_expires_at: number;
          }>()
      ).results
    : [];
  const byId = new Map<string, { sale: PublishedSale; actionable: boolean }>();
  for (const r of rows) {
    const parsed = publishedSaleSchema.safeParse(JSON.parse(r.payload));
    if (parsed.success)
      byId.set(parsed.data.id, {
        sale: parsed.data,
        actionable:
          r.availability === 'available' && r.control_expires_at > Date.now(),
      });
  }
  const result = new Map<string, ResolvedSiteLink>();
  const presentations = new Map(
    site.domainPresentations.map((d) => [d.id, d.domain]),
  );
  for (const link of site.salesLinks) {
    const row = byId.get(link.listingId),
      domain = presentations.get(link.presentationId);
    if (
      row?.actionable &&
      row.sale.domain === domain &&
      row.sale.revision === link.publishedRevision &&
      row.sale.mode === link.mode &&
      JSON.stringify(row.sale.publicPrice) ===
        JSON.stringify(link.publicPrice) &&
      JSON.stringify(row.sale.publicMinimumOffer) ===
        JSON.stringify(link.publicMinimumOffer)
    ) {
      try {
        result.set(link.presentationId, {
          url: publicDomainUrl(origin, domain!),
          mode: link.mode,
          price: link.publicPrice,
        });
      } catch {
        /* No routing fallback. */
      }
    }
  }
  return result;
}
export async function publishedBacklinks(
  db: PublishedReadDatabase,
  sale: PublishedSale,
  origin: string | undefined,
): Promise<{ label: string; url: string }[]> {
  const r = await db
    .prepare("SELECT payload FROM published_portfolios WHERE id='main'")
    .first<{ payload: string }>();
  if (!r) return [];
  const parsed = publishedOwnerSiteV3Schema.safeParse(JSON.parse(r.payload));
  if (!parsed.success) return [];
  const site = parsed.data,
    link = site.salesLinks.find(
      (l) => l.listingId === sale.id && l.publishedRevision === sale.revision,
    );
  if (
    !link ||
    !site.domainPresentations.some(
      (d) => d.id === link.presentationId && d.domain === sale.domain,
    )
  )
    return [];
  try {
    return [
      {
        label: site.profile.name,
        url: canonicalPublicUrl(origin, `/p/${site.handle}`),
      },
      ...site.collections
        .filter((c) => c.domainIds.includes(link.presentationId))
        .map((c) => ({
          label: c.title,
          url: canonicalPublicUrl(origin, `/p/${site.handle}/c/${c.slug}`),
        })),
    ];
  } catch {
    return [];
  }
}
