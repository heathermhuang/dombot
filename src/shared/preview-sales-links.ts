import { z } from 'zod';
import { saleDomainSchema, saleModeSchema, saleMoneySchema } from './sales';
export const previewSalesReferences = z
  .array(
    z
      .object({
        presentationId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
        domain: saleDomainSchema,
        listingId: z.string().uuid(),
        publishedRevision: z.string().uuid(),
      })
      .strict(),
  )
  .max(20000)
  .refine(
    (refs) => new Set(refs.map((r) => r.presentationId)).size === refs.length,
    'Each presentation must appear once.',
  );
export const previewSalesTermSchema = z
  .object({
    presentationId: z.string(),
    domain: saleDomainSchema,
    listingId: z.string().uuid(),
    publishedRevision: z.string().uuid(),
    mode: saleModeSchema,
    price: saleMoneySchema.nullable(),
    minimumOffer: saleMoneySchema.nullable(),
    url: z.string().url(),
  })
  .strict();
export const previewSalesTermsSchema = z
  .array(previewSalesTermSchema)
  .max(20000);
export type PreviewSalesTerm = z.infer<typeof previewSalesTermSchema>;

import type { PublishedOwnerSite } from './owner-site';
import type { PublishedSale } from './sales';
import type { ResolvedSiteLink } from './render-owner-site';
/** Reconcile asynchronous reads with the current reference, never a prior preview. */
export function resolvedPreviewLinks(
  site: PublishedOwnerSite,
  terms: PreviewSalesTerm[],
  stagedSales: PublishedSale[] = [],
): Map<string, ResolvedSiteLink> {
  const result = new Map<string, ResolvedSiteLink>();
  if (site.version !== 3) return result;
  const domains = new Map(
      site.domainPresentations.map((d) => [d.id, d.domain]),
    ),
    current = new Map(terms.map((t) => [t.presentationId, t])),
    staged = new Map(stagedSales.map((s) => [s.id, s]));
  for (const link of site.salesLinks) {
    const domain = domains.get(link.presentationId),
      term = current.get(link.presentationId),
      pending = staged.get(link.listingId);
    if (
      term &&
      term.domain === domain &&
      term.listingId === link.listingId &&
      term.publishedRevision === link.publishedRevision
    )
      result.set(link.presentationId, {
        url: term.url,
        mode: term.mode,
        price: term.price,
      });
    if (
      pending &&
      pending.domain === domain &&
      pending.revision === link.publishedRevision
    )
      result.set(link.presentationId, {
        url: '#',
        mode: pending.mode,
        price: pending.publicPrice,
      });
  }
  return result;
}
