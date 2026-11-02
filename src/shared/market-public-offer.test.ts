import { describe, expect, it } from 'vitest';
import {
  publicMarketOffer,
  marketOfferFingerprint,
  marketPublicDestination,
} from './market-public-offer';
import type { MarketListing, MarketSyncState } from './markets';
import { validateSalesDestination } from './sales-provider';
const now = 1800000000000;
const listing: MarketListing = {
  market: 'sedo',
  accountId: 'private-account',
  name: 'working.io',
  displayName: null,
  status: 'active',
  statusRaw: 'active',
  forSale: true,
  price: '1479.09',
  buyNow: true,
  minOffer: null,
  floor: 'SECRET',
  discount: null,
  currency: 'USD',
  leaseToOwn: { enabled: true, maxPayments: 12 },
  tier: null,
  listedAt: null,
  updatedAt: '2099-01-01',
  publicObservedAt: now - 1000,
  extra: {
    market: 'sedo',
    categories: [],
    language: null,
    parkingEarnings: null,
    keywords: [],
  },
};
const sync: MarketSyncState = {
  at: now,
  lastError: null,
  listings: 1,
  sales: 0,
  incomplete: false,
  notes: [],
};
describe('selected marketplace public offers', () => {
  it('uses exact effective terms and a private dependency fingerprint', async () => {
    const offer = await publicMarketOffer(listing, sync, now);
    expect(offer.eligible).toBe(true);
    expect(offer.price?.amount).toBe('1479.09');
    expect(offer.url).toBe(
      'https://sedo.com/search/details/?domain=working.io',
    );
    expect(
      await marketOfferFingerprint({
        ...listing,
        floor: 'CHANGED',
        extra: {
          market: 'sedo',
          categories: [],
          language: null,
          parkingEarnings: null,
          keywords: ['PRIVATE'],
        },
      }),
    ).toBe(offer.source.fingerprint);
    expect(
      await marketOfferFingerprint({ ...listing, price: '1479.10' }),
    ).not.toBe(offer.source.fingerprint);
    expect(JSON.stringify(offer)).not.toContain('SECRET');
    expect(JSON.stringify(offer)).not.toContain('monthly');
  });
  it('requires a successful complete listing observation, not provider updatedAt or account time', async () => {
    for (const [l, s] of [
      [{ ...listing, publicObservedAt: undefined }, sync],
      [listing, { ...sync, lastError: 'failed' }],
      [listing, { ...sync, incomplete: true }],
      [{ ...listing, status: 'on_hold' }, sync],
      [{ ...listing, publicObservedAt: now - 86400000 }, sync],
      [{ ...listing, discount: { amount: '1000.01', until: null } }, sync],
    ] as [MarketListing, MarketSyncState][])
      expect((await publicMarketOffer(l, s, now)).eligible).toBe(false);
    expect(
      (
        await publicMarketOffer(
          {
            ...listing,
            discount: {
              amount: '1000.01',
              until: new Date(now + 1000).toISOString(),
            },
          },
          sync,
          now,
        )
      ).price?.amount,
    ).toBe('1000.01');
  });
  it('resolves only canonical public identity destinations and rejects access-bearing or mismatched URLs', () => {
    for (const market of ['afternic', 'atom', 'sedo'] as const)
      expect(
        marketPublicDestination({ market, name: 'Working.IO.' }).url,
      ).toContain('working.io');
    for (const url of [
      'https://sedo.com/search/details/?domain=evil.io',
      'https://sedo.com/search/details/?domain=working.io&token=secret',
      'https://sedo.com/pay/working.io',
      'https://sedo.com/search/details/?domain=working.io#secret',
      'https://sedo.com.evil.io/working.io',
    ])
      expect(() =>
        validateSalesDestination('Sedo', url, 'working.io'),
      ).toThrow();
  });
});
