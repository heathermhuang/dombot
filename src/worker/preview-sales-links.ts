import {
  previewSalesReferences,
  type PreviewSalesTerm,
} from '../shared/preview-sales-links';
import {
  publicSalesLinkTermsSchema,
  publicSalesLinkTermsQuery,
} from '../shared/public-sales-link-terms';
import { publicDomainUrl } from '../shared/public-publishing-links';
/** Owner preview reads published projections/eligibility only. It never grants commit authority. */
export async function previewSalesLinks(
  db: D1Database,
  raw: unknown,
  origin: string | undefined,
): Promise<PreviewSalesTerm[]> {
  const refs = previewSalesReferences.parse(raw),
    ids = [...new Set(refs.map((r) => r.listingId))];
  if (!ids.length) return [];
  const rows = (
    await db.prepare(publicSalesLinkTermsQuery).bind(JSON.stringify(ids)).all<{
      payload: string;
      availability: string;
      control_expires_at: number;
    }>()
  ).results;
  const available = new Map(
    rows
      .filter(
        (r) =>
          r.availability === 'available' && r.control_expires_at > Date.now(),
      )
      .flatMap((r) => {
        try {
          const sale = publicSalesLinkTermsSchema.parse(JSON.parse(r.payload));
          return [[sale.id, sale] as const];
        } catch {
          return [];
        }
      }),
  );
  return refs.flatMap((ref) => {
    const sale = available.get(ref.listingId);
    if (
      !sale ||
      sale.domain !== ref.domain ||
      sale.revision !== ref.publishedRevision
    )
      return [];
    return [
      {
        presentationId: ref.presentationId,
        domain: sale.domain,
        listingId: sale.id,
        publishedRevision: sale.revision,
        mode: sale.mode,
        price: sale.publicPrice,
        minimumOffer: sale.publicMinimumOffer,
        url: publicDomainUrl(origin, sale.domain),
      },
    ];
  });
}
