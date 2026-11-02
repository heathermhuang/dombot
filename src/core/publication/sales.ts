import type { MarketPublicOffer } from '../../shared/market-public-offer';
import type { ListPrice } from '../../shared/ipc';
import {
  publishedSaleSchema,
  saleMinorUnits,
  saleDraftSchema,
  type PublishedSale,
  type SaleDraft,
  type SaleDestination,
} from '../../shared/hosted-sales';
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
  marketOffer?: MarketPublicOffer | null,
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
  if (
    d.priceSource?.kind === 'market' &&
    (!marketOffer?.eligible ||
      marketOffer.source.fingerprint !== d.priceSource.fingerprint ||
      marketOffer.source.accountId !== d.priceSource.accountId ||
      marketOffer.source.market !== d.priceSource.market ||
      marketOffer.source.listingName !== d.domain ||
      marketOffer.source.validUntil <= now ||
      !destination ||
      destination.provider !== marketOffer.provider ||
      destination.url !== marketOffer.url)
  )
    throw new SalesError(
      'MARKET_CHANGED',
      marketOffer?.reason ??
        'The selected marketplace terms or destination changed. Review the current offer.',
      409,
    );
  if (
    d.priceSource?.kind === 'market' &&
    d.mode === 'buy-now' &&
    !marketOffer?.buyNow
  )
    throw new SalesError(
      'MARKET_NOT_FIXED',
      'This market price is asking only. Use the provider offer path.',
      409,
    );
  const publicPrice =
    d.priceSource?.kind === 'market'
      ? (marketOffer?.price ?? null)
      : d.priceSource?.kind === 'override'
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
      saleMinorUnits(d.minimumOffer) > saleMinorUnits(publicPrice))
  )
    throw new SalesError(
      'MINIMUM_INVALID',
      'Minimum offer must use the asking currency and be at or below the asking price.',
    );
  return publishedSaleSchema.parse({
    version: 2,
    id: d.id,
    domain: d.domain,
    displayName: d.displayName,
    mode: d.mode,
    description: d.description,
    categories: d.categories,
    ...(d.priceSource?.kind === 'market'
      ? {
          providerIntent:
            marketOffer?.buyNow && publicPrice
              ? ('buy' as const)
              : publicPrice
                ? ('offer' as const)
                : ('view' as const),
        }
      : {}),
    ...(d.priceSource?.kind === 'market'
      ? { sourceValidUntil: marketOffer!.source.validUntil }
      : {}),
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
