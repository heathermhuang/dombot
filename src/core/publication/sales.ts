import type { ListPrice } from '../../shared/ipc';
import {
  publishedSaleSchema,
  saleDraftSchema,
  type PublishedSale,
  type SaleDraft,
  type SaleDestination,
} from '../../shared/sales';
import { SalesError } from '../../shared/sales-review';
import { validateSalesDestination } from '../../shared/sales-provider';

/** Fingerprint only the public source price, never carry a private floor into a review. */
export function sourcePriceFingerprint(price?: ListPrice | null): string {
  return JSON.stringify([
    price?.amount ?? null,
    price?.currency ?? null,
    price?.updatedAt ?? null,
  ]);
}
export function salesProjection(
  input: SaleDraft,
  price: ListPrice | null,
  destination: SaleDestination | null,
  revision: string,
  now = Date.now(),
): PublishedSale {
  const d = saleDraftSchema.parse(input);
  if (destination)
    validateSalesDestination(destination.provider, destination.url, d.domain);
  if (
    d.priceSource?.kind === 'portfolio' &&
    d.priceSource.fingerprint !== sourcePriceFingerprint(price)
  )
    throw new SalesError(
      'PRICE_CHANGED',
      'The portfolio price changed. Review the latest price before publishing.',
      409,
    );
  const publicPrice =
    d.priceSource?.kind === 'override'
      ? d.priceSource.price
      : d.priceSource?.kind === 'portfolio' && price?.amount
        ? { amount: price.amount, currency: price.currency }
        : null;
  if (d.destinationId && (!destination || destination.id !== d.destinationId))
    throw new SalesError('DESTINATION_MISSING', 'Choose a saved destination.');
  if (
    ['buy-now', 'external'].includes(d.mode) &&
    (!destination || !['manual', 'verified'].includes(destination.check))
  )
    throw new SalesError(
      'CHECKOUT_MISSING',
      'Add a valid checkout link before publishing this sale mode.',
    );
  if (d.mode === 'buy-now' && !publicPrice)
    throw new SalesError('PRICE_MISSING', 'Buy Now needs a positive price.');
  if (
    d.minimumOffer &&
    publicPrice &&
    (d.minimumOffer.currency !== publicPrice.currency ||
      BigInt(d.minimumOffer.amount) > BigInt(publicPrice.amount))
  )
    throw new SalesError(
      'MINIMUM_INVALID',
      'Minimum offer must use the asking currency and be at or below the asking price.',
    );
  return publishedSaleSchema.parse({
    version: 1,
    id: d.id,
    domain: d.domain,
    displayName: d.displayName,
    mode: d.mode,
    description: d.description,
    categories: d.categories,
    publicPrice,
    publicMinimumOffer: d.minimumOffer,
    destination: destination
      ? {
          provider: destination.provider,
          url: destination.url,
          check: destination.check,
          checkedAt: destination.checkedAt,
        }
      : null,
    allowQuestions: d.allowQuestions,
    sellerDisplayName: d.sellerDisplayName,
    revision,
    publishedAt: now,
  });
}
