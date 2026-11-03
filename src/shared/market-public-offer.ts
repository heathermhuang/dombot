import type { MarketListing, MarketSyncState } from './markets';
import type { SaleDestination, SaleMoney } from './hosted-sales';
import { saleMoneySchema } from './hosted-sales';
import { canonicalDomain } from './publication';
import { validateSalesDestination } from './sales-provider';

/** Application claim leases, separately specified per source. These are not
 * provider guarantees or generic account-sync timestamps. */
export const MARKET_PUBLIC_VALIDITY = {
  afternic: 6 * 3600000,
  atom: 3600000,
  sedo: 6 * 3600000,
} as const;
export interface MarketOfferSelection {
  kind: 'market';
  market: MarketListing['market'];
  accountId: string;
  listingName: string;
  fingerprint: string;
  observedAt: number;
  validUntil: number;
}
export interface MarketPublicOffer {
  source: MarketOfferSelection;
  price: SaleMoney | null;
  buyNow: boolean;
  provider: SaleDestination['provider'];
  url: string;
  eligible: boolean;
  reason: string | null;
}
/** Public identity routes only. No privileged checkout, tracking, private link
 * or provider payload is used. Identity resolution is not live checkout verification. */
export function marketPublicDestination(
  listing: Pick<MarketListing, 'market' | 'name'>,
) {
  const name = canonicalDomain(listing.name);
  const provider = (
    { afternic: 'Afternic', atom: 'Atom', sedo: 'Sedo' } as const
  )[listing.market];
  const url =
    listing.market === 'sedo'
      ? `https://sedo.com/search/details/?domain=${name}`
      : listing.market === 'atom'
        ? `https://www.atom.com/name/${name}`
        : `https://www.afternic.com/domain/${name}`;
  return { provider, url: validateSalesDestination(provider, url, name) };
}
/** Public commercial dependency hash only. Private floors/notes/costs and raw
 * adapter payloads cannot affect, or escape through, the approved projection. */
export async function marketOfferFingerprint(
  listing: MarketListing,
): Promise<string> {
  const fields = [
    listing.market,
    listing.accountId,
    canonicalDomain(listing.name),
    listing.status,
    listing.forSale,
    listing.price,
    listing.currency,
    listing.buyNow,
    listing.minOffer,
    listing.discount,
    // Availability alone supplies no numeric financing quote.
    listing.leaseToOwn?.enabled ?? false,
    listing.leaseToOwn?.maxPayments ?? null,
  ];
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(fields)),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
export async function publicMarketOffer(
  listing: MarketListing,
  sync: MarketSyncState | null,
  now = Date.now(),
): Promise<MarketPublicOffer> {
  const observedAt = listing.publicObservedAt ?? 0;
  const validUntil = observedAt + MARKET_PUBLIC_VALIDITY[listing.market];
  let reason: string | null =
    !observedAt || observedAt > now || validUntil <= now
      ? 'Refresh this marketplace listing before publishing a price.'
      : sync?.lastError || sync?.incomplete
        ? 'The latest market observation failed or was incomplete.'
        : listing.status !== 'active' || !listing.forSale
          ? 'This marketplace listing is not active and public.'
          : null;
  let price: SaleMoney | null = null;
  let effective = listing.price;
  // A discount is usable only with an explicit effective price and future expiry.
  if (listing.discount) {
    const until = Date.parse(listing.discount.until ?? '');
    if (!Number.isFinite(until) || until <= now)
      reason = 'Review the expired or incomplete discount before publishing.';
    else effective = listing.discount.amount;
  }
  if (effective !== null) {
    const parsed = saleMoneySchema.safeParse({
      amount: effective,
      currency: listing.currency,
    });
    if (parsed.success) price = parsed.data;
    else reason = 'The observed price is not exact money in this currency.';
  }
  return {
    source: {
      kind: 'market',
      market: listing.market,
      accountId: listing.accountId,
      listingName: canonicalDomain(listing.name),
      fingerprint: await marketOfferFingerprint(listing),
      observedAt,
      validUntil: listing.discount?.until
        ? Math.min(validUntil, Date.parse(listing.discount.until) || 0)
        : validUntil,
    },
    price,
    buyNow: listing.buyNow,
    ...marketPublicDestination(listing),
    eligible: reason === null,
    reason,
  };
}
