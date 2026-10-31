import { publishedSaleSchema, type PublishedSale } from '../shared/sales';
import {
  publishedOwnerSiteV3Schema,
  selectedSite,
  type OwnerSiteDraft,
  type PublishedOwnerSite,
} from '../shared/owner-site';
export {
  publicLinkedSales,
  publishedBacklinks,
} from '../shared/published-sales-links';

export async function bindSiteLinks(
  db: D1Database,
  draft: OwnerSiteDraft,
  now = Date.now(),
  committing: PublishedSale[] = [],
  reuse?: { baseline: PublishedOwnerSite; approvedDomains: string[] },
): Promise<PublishedOwnerSite> {
  const selected = selectedSite(draft);
  if (selected.version === 2) return { ...selected, publishedAt: now };
  const ids = selected.salesLinks.map((l) => l.listingId);
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
  const sales = new Map(
    rows
      .filter(
        (r) => r.availability === 'available' && r.control_expires_at > now,
      )
      .map((r) => {
        const s = publishedSaleSchema.parse(JSON.parse(r.payload));
        return [s.id, s] as const;
      }),
  );
  for (const sale of committing) sales.set(sale.id, sale);
  const presentations = new Map(
    selected.domainPresentations.map((d) => [d.id, d]),
  );
  const preserved = new Map(
    reuse?.baseline.version === 3
      ? reuse.baseline.salesLinks.map((l) => [l.presentationId, l])
      : [],
  );
  const priorPresentations = new Map(
    reuse?.baseline.domainPresentations.map((d) => [d.id, d]),
  );
  const salesLinks = selected.salesLinks.map((link) => {
    const presentation = presentations.get(link.presentationId)!;
    const old = preserved.get(link.presentationId);
    if (
      reuse &&
      !reuse.approvedDomains.includes(presentation.domain) &&
      old &&
      old.listingId === link.listingId &&
      old.publishedRevision === link.expectedPublishedRevision &&
      JSON.stringify(priorPresentations.get(link.presentationId)) ===
        JSON.stringify(presentation)
    )
      return old;
    const sale = sales.get(link.listingId),
      d = selected.domainPresentations.find(
        (d) => d.id === link.presentationId,
      );
    if (
      !sale ||
      sale.domain !== d?.domain ||
      sale.revision !== link.expectedPublishedRevision
    )
      throw new Error(
        'The linked domain page changed or is unavailable. Review and bind its public revision again.',
      );
    return {
      presentationId: link.presentationId,
      listingId: link.listingId,
      publishedRevision: sale.revision,
      mode: sale.mode,
      publicPrice: sale.publicPrice,
      publicMinimumOffer: sale.publicMinimumOffer,
    };
  });
  return publishedOwnerSiteV3Schema.parse({
    ...selected,
    salesLinks,
    publishedAt: now,
  });
}
