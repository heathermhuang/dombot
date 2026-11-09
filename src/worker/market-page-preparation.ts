import { marketListings } from '../core/services/markets/sync';
import {
  getMarketSyncState,
  activeMarketAccounts,
} from '../core/services/markets/accounts';
import {
  publicMarketOffer,
  supportsPublicMarket,
  type MarketPublicOffer,
} from '../shared/market-public-offer';
import { emptySale } from '../shared/hosted-sales';
import { sourcePriceFingerprint } from '../core/publication/sales';
import { getListPrices } from '../core/services/list-prices';
import { SalesError, conflict } from '../shared/sales-review';
import type { SalesStore, SavedSale } from './sales-store';

export async function marketOffersFor(
  domain: string,
): Promise<MarketPublicOffer[]> {
  const accounts = activeMarketAccounts();
  const active = new Set(accounts.map((a) => a.id));
  return Promise.all(
    marketListings()
      .filter(
        (l) =>
          l.name === domain &&
          active.has(l.accountId) &&
          supportsPublicMarket(l.market),
      )
      .map(async (l) => ({
        ...(await publicMarketOffer(l, getMarketSyncState(l.accountId))),
        accountLabel: accounts.find((a) => a.id === l.accountId)?.label,
      })),
  );
}
/** An explicitly requested private save. It never publishes or changes a market.
 * Keep source account identity and fingerprint only inside encrypted draft/review. */
export async function prepareMarketPage(
  store: SalesStore,
  saved: SavedSale,
  accountId: string,
  expected: string,
) {
  if (saved.revision !== expected) throw conflict();
  const offer = (await marketOffersFor(saved.draft.domain)).find(
    (o) => o.source.accountId === accountId,
  );
  if (!offer)
    throw new SalesError(
      'MARKET_MISSING',
      'Sync the selected marketplace listing before preparing its page.',
      409,
    );
  const existing = (await store.destinations()).find(
    (d) => d.provider === offer.provider && d.url === offer.url,
  );
  const destination = existing ?? {
    id: crypto.randomUUID(),
    revision: crypto.randomUUID(),
    provider: offer.provider,
    url: offer.url,
    check: 'manual' as const,
    checkedAt: null,
  };
  if (!existing) await store.saveDestination(destination, null);
  const draft = {
    ...saved.draft,
    version: 2 as const,
    priceSource: offer.source,
    destinationId: destination.id,
    mode:
      offer.buyNow && offer.price
        ? ('buy-now' as const)
        : ('external' as const),
    minimumOffer: null,
  };
  const revision = await store.save(draft, expected);
  return {
    draft,
    revision,
    offer,
    notice:
      offer.reason ??
      'Private marketplace proposal saved. Domain control and publication review are still required.',
  };
}
export async function preparePrivatePage(
  store: SalesStore,
  domain: string,
  accountId?: string,
) {
  const hash = await store.hash('domain', domain);
  const row = await store.db
    .prepare('SELECT id FROM sale_drafts WHERE domain_hash=?')
    .bind(hash)
    .first<{ id: string }>();
  if (row) return { item: await store.get(row.id), existing: true }; // bulk never overwrites an existing draft
  const draft = emptySale(
    domain,
    sourcePriceFingerprint(getListPrices()[domain]),
  );
  const revision = await store.save(draft, null);
  if (accountId)
    await prepareMarketPage(
      store,
      await store.get(draft.id),
      accountId,
      revision,
    );
  return { item: await store.get(draft.id), existing: false };
}
