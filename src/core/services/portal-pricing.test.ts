import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryDocStore } from '../storage/doc-store';
vi.mock('./base-pricing', () => ({ getBaseRenewal: () => 17 }));
let pricing: typeof import('./pricing');
let storage: typeof import('../storage/namespace');
let store: MemoryDocStore;
let observedAt: number;
beforeEach(async () => {
  vi.resetModules();
  pricing = await import('./pricing');
  storage = await import('../storage/namespace');
  store = new MemoryDocStore();
  storage.configureStore(store);
  await storage.hydrateStores();
  observedAt = Date.now() - 1000;
});
const seed = async (quote: unknown, account = 'account-a') => {
  await storage.flushWrites();
  await store.put('registrar-portal-quotes', `${account}:premium.work`, quote);
  storage.configureStore(store);
  await storage.hydrateStores();
};
describe('verified registrar portal snapshots', () => {
  it('uses a dated account-scoped portal quote above estimates, with truthful provenance', async () => {
    await seed({ renewal: 45.5, currency: 'USD', observedAt });
    expect(
      pricing.resolvePricing('godaddy', 'premium.work', undefined, 'account-a'),
    ).toMatchObject({ renewal: 45.5, source: 'portal', observedAt });
    expect(
      pricing.resolvePricing('godaddy', 'premium.work', undefined, 'account-b'),
    ).toMatchObject({ renewal: 17, source: 'base' });
  });
  it('lets API quotes supersede a portal snapshot without creating a manual override', async () => {
    await seed({ renewal: 45.5, currency: 'USD', observedAt });
    expect(
      pricing.resolvePricing(
        'godaddy',
        'premium.work',
        { renewal: 43, currency: 'USD' },
        'account-a',
      ),
    ).toMatchObject({ renewal: 43, source: 'api' });
    expect(pricing.getManualPrices()).toEqual({});
  });
  it('preserves a real manual override and excludes portal snapshots from exports', async () => {
    await seed({ renewal: 45.5, currency: 'USD', observedAt });
    pricing.setManualPrice('premium.work', { amount: '48', currency: 'USD' });
    expect(
      pricing.resolvePricing('godaddy', 'premium.work', undefined, 'account-a'),
    ).toMatchObject({ renewal: 48, source: 'manual' });
    expect(storage.exportNamespaces()).not.toHaveProperty(
      'registrar-portal-quotes',
    );
  });
  it.each([
    { renewal: -1, currency: 'USD', observedAt: 1 },
    { renewal: Number.POSITIVE_INFINITY, currency: 'USD', observedAt: 1 },
    { renewal: 40, currency: 'not-currency', observedAt: 1 },
    { renewal: 40, currency: 'USD', observedAt: -1 },
    { renewal: 40, currency: 'USD', observedAt: 99_999_999_999_999 },
  ])('ignores an invalid portal snapshot %#', async (quote) => {
    await seed(quote);
    expect(
      pricing.resolvePricing('godaddy', 'premium.work', undefined, 'account-a'),
    ).toMatchObject({ renewal: 17, source: 'base' });
  });
});

it('clears only the reset account snapshots while preserving user overrides', async () => {
  await seed({ renewal: 45.5, currency: 'USD', observedAt }, 'account-a');
  await seed({ renewal: 46, currency: 'USD', observedAt }, 'account-b');
  pricing.setManualPrice('unrelated.io', { amount: '80', currency: 'USD' });
  pricing.clearPortalQuotesForAccount('account-a');
  expect(
    pricing.resolvePricing('godaddy', 'premium.work', undefined, 'account-a')
      .source,
  ).toBe('base');
  expect(
    pricing.resolvePricing('godaddy', 'premium.work', undefined, 'account-b')
      .source,
  ).toBe('portal');
  expect(pricing.getManualPrices()).toHaveProperty('unrelated.io');
});
