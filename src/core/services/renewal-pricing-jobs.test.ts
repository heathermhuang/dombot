import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDomain,
  createRegistrar,
  type RequestOptions,
  type TldPricing,
  RateLimitError,
} from '@aoxborrow/registrar-client';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  exportNamespaces,
  flushWrites,
  hydrateStores,
} from '../storage/namespace';
import { readEntry, writeEntry } from './cache';
import { setRegistrarEnabled } from './registrar-state';
import {
  configureIncrementalRenewalPricing,
  configureRegistrarFactory,
  getCachedPortfolio,
  getDomainDetail,
  getPortfolio,
  getRenewalPricingStatus,
  resetRegistrarClients,
  saveRegistrarCredentials,
  stepRenewalPricing,
} from './registrars';

const domains = ['first.ai', 'second.ai', 'third.ai'].map((domainName) =>
  createDomain({ domainName, registrar: 'dynadot' }),
);
let listedDomains = domains;
const pricing = vi
  .fn<(domain: string, opts?: RequestOptions) => Promise<TldPricing>>()
  .mockResolvedValue({ tld: 'ai', renewal: 70, currency: 'USD' });
let raw: MemoryDocStore;

beforeEach(async () => {
  raw = new MemoryDocStore();
  configureStore(raw);
  await hydrateStores();
  resetRegistrarClients();
  configureIncrementalRenewalPricing(true);
  listedDomains = domains;
  pricing
    .mockReset()
    .mockResolvedValue({ tld: 'ai', renewal: 70, currency: 'USD' });
  configureRegistrarFactory((name, credentials) => {
    const provider = createRegistrar(name, credentials);
    provider.listDomains = async () => listedDomains;
    provider.getDomain = async () => domains[0];
    provider.getPricing = pricing;
    return provider;
  });
  await saveRegistrarCredentials('dynadot', {
    apiKey: 'test-key',
    apiSecret: 'test-secret',
  });
});
afterEach(async () => {
  vi.useRealTimers();
  await flushWrites();
  configureIncrementalRenewalPricing(false);
  configureRegistrarFactory(null);
  resetRegistrarClients();
});

describe('hosted renewal pricing', () => {
  it('quotes every Dynadot holding, including uniform TLDs, after each inventory generation', async () => {
    listedDomains = ['ordinary.com', 'ordinary.net', 'premium.ai'].map(
      (domainName) => createDomain({ domainName, registrar: 'dynadot' }),
    );
    expect((await getPortfolio(true)).renewalPricing?.remaining).toBe(3);
    for (let i = 0; i < 3; i++) await stepRenewalPricing();
    expect(pricing.mock.calls.map(([domain]) => domain)).toEqual(
      listedDomains.map((d) => d.domainName),
    );
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 24 * 60 * 60_000 + 1);
    expect((await getPortfolio(true)).renewalPricing?.remaining).toBe(3);
  });

  it('repairs an older current-generation queue without a new inventory request or lost cooldown', async () => {
    listedDomains = [
      ...domains,
      createDomain({ domainName: 'omitted.com', registrar: 'dynadot' }),
    ];
    await getPortfolio(true);
    const syncedAt = readEntry<{ lastSyncedAt: number }>(
      'portfolio',
      'dynadot',
    )!.data.lastSyncedAt;
    const notBefore = Date.now() + 60_000;
    await flushWrites();
    await raw.put('renewal-pricing-jobs', 'dynadot', {
      syncedAt,
      pending: ['second.ai'],
      quoteStrategy: 'rest-single-search-v1',
      failed: 1,
      failures: { 'first.ai': { code: 'Error', at: Date.now() } },
      notBefore,
      attempts: 2,
    });
    configureStore(raw);
    await hydrateStores();
    resetRegistrarClients();
    expect(getRenewalPricingStatus()).toMatchObject({
      remaining: 3,
      failed: 1,
      nextAt: notBefore,
    });
    await stepRenewalPricing();
    await flushWrites();
    expect(await raw.get('renewal-pricing-jobs', 'dynadot')).toMatchObject({
      syncedAt,
      pending: ['second.ai', 'third.ai', 'omitted.com'],
      failed: 1,
      notBefore,
      attempts: 2,
    });
    expect(pricing).not.toHaveBeenCalled();
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
    'keeps the previous quote when the provider returns invalid renewal %s',
    async (renewal) => {
      writeEntry('detail', 'dynadot:first.ai', {
        renewalQuote: { renewal: 60, currency: 'USD' },
      });
      await getPortfolio(true);
      pricing.mockResolvedValueOnce({ tld: 'ai', renewal, currency: 'USD' });
      expect(await stepRenewalPricing()).toMatchObject({
        remaining: 2,
        failed: 1,
      });
      expect(
        readEntry<{ renewalQuote: { renewal: number } }>(
          'detail',
          'dynadot:first.ai',
        )?.data.renewalQuote.renewal,
      ).toBe(60);
    },
  );

  it('persists a rate-limit cooldown without dropping the pending quote', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await getPortfolio(true);
    pricing.mockRejectedValueOnce(new RateLimitError('Too many requests', 60));
    const paused = await stepRenewalPricing();
    expect(paused).toEqual({
      remaining: 3,
      failed: 0,
      nextAt: Date.now() + 60_000,
    });
    await stepRenewalPricing();
    expect(pricing).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 60_001);
    expect(await stepRenewalPricing()).toEqual({ remaining: 2, failed: 0 });
  });
  it('bounds fast rate-limit retries without draining the quote queue', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    writeEntry('detail', 'dynadot:first.ai', {
      renewalQuote: { renewal: 60, currency: 'USD' },
    });
    await getPortfolio(true);
    pricing.mockRejectedValue(new RateLimitError('Too many requests', 60));
    for (let i = 0; i < 3; i++) {
      await stepRenewalPricing();
      vi.setSystemTime(Date.now() + 60_001);
    }
    expect(pricing).toHaveBeenCalledTimes(3);
    expect(getRenewalPricingStatus()).toMatchObject({
      remaining: 3,
      failed: 0,
    });
    expect(getRenewalPricingStatus().nextAt).toBeGreaterThan(
      Date.now() + 20 * 60_000,
    );
    await stepRenewalPricing();
    expect(pricing).toHaveBeenCalledTimes(3);
    const retryAt = getRenewalPricingStatus().nextAt!;
    pricing.mockResolvedValue({ tld: 'ai', renewal: 70, currency: 'USD' });
    vi.setSystemTime(retryAt + 1);
    expect(await stepRenewalPricing()).toEqual({ remaining: 2, failed: 0 });
    expect(
      readEntry<{ renewalQuote: { renewal: number } }>(
        'detail',
        'dynadot:first.ai',
      )?.data.renewalQuote.renewal,
    ).toBe(70);
  });
  it('retains queued prices while inventory is temporarily unavailable', async () => {
    await getPortfolio(true);
    const entry = readEntry('portfolio', 'dynadot')!;
    writeEntry('portfolio', 'dynadot', {
      ...(entry.data as object),
      lastError: 'HTTP 429',
    });
    await stepRenewalPricing();
    await flushWrites();
    expect(await raw.get('renewal-pricing-jobs', 'dynadot')).toMatchObject({
      pending: domains.map((d) => d.domainName),
    });
    expect(pricing).not.toHaveBeenCalled();
    expect(getRenewalPricingStatus()).toMatchObject({
      remaining: 0,
      blocked: 3,
    });
  });

  it('keeps a large inventory sync independent of hundreds of price requests', async () => {
    listedDomains = Array.from({ length: 600 }, (_, i) =>
      createDomain({ domainName: `name-${i}.ai`, registrar: 'dynadot' }),
    );
    const result = await getPortfolio(true);
    expect(result.domains).toHaveLength(600);
    expect(result.renewalPricing?.remaining).toBe(600);
    expect(pricing).not.toHaveBeenCalled();
  });
  it('returns fresh inventory without waiting for any renewal lookup', async () => {
    const result = await getPortfolio(true);
    expect(result.domains.map((d) => d.domainName)).toEqual(
      domains.map((d) => d.domainName),
    );
    expect(result.errors).toEqual([]);
    expect(result.renewalPricing).toEqual({ remaining: 3, failed: 0 });
    expect(pricing).not.toHaveBeenCalled();
    expect(exportNamespaces()['renewal-pricing-jobs']).toBeUndefined();
  });

  it('processes one quote per account and resumes after a fresh hydrate/client restart', async () => {
    await getPortfolio(true);
    await flushWrites();
    configureStore(raw);
    await hydrateStores();
    resetRegistrarClients();
    const fetchedAt = getCachedPortfolio()?.fetchedAt;
    expect(await stepRenewalPricing()).toEqual({ remaining: 2, failed: 0 });
    expect(pricing).toHaveBeenCalledTimes(1);
    expect(pricing.mock.calls[0][0]).toBe('first.ai');
    expect(pricing.mock.calls[0][1]).toMatchObject({ retries: 0 });
    expect(
      readEntry<{ renewalQuote: { renewal: number } }>(
        'detail',
        'dynadot:first.ai',
      )?.data.renewalQuote.renewal,
    ).toBe(70);
    expect(getCachedPortfolio()?.fetchedAt).toBe(fetchedAt);
    expect(await stepRenewalPricing()).toEqual({ remaining: 1, failed: 0 });
    expect(await stepRenewalPricing()).toEqual({ remaining: 0, failed: 0 });
  });

  it('retains the last price on failure and reports the failed refresh', async () => {
    writeEntry('detail', 'dynadot:first.ai', {
      renewalQuote: { renewal: 60, currency: 'USD' },
    });
    await getPortfolio(true);
    pricing.mockRejectedValueOnce(new Error('Provider unavailable'));
    expect(await stepRenewalPricing()).toEqual({ remaining: 2, failed: 1 });
    expect(
      readEntry<{ renewalQuote: { renewal: number } }>(
        'detail',
        'dynadot:first.ai',
      )?.data.renewalQuote.renewal,
    ).toBe(60);
    expect(getCachedPortfolio()?.errors).toEqual([]);
    await flushWrites();
    expect(await raw.get('renewal-pricing-jobs', 'dynadot')).toMatchObject({
      failures: { 'first.ai': { code: 'Error', at: expect.any(Number) } },
    });
  });

  it('drops work for a disabled account without contacting the provider', async () => {
    await getPortfolio(true);
    setRegistrarEnabled('dynadot', false);
    expect(await stepRenewalPricing()).toEqual({ remaining: 0, failed: 0 });
    expect(pricing).not.toHaveBeenCalled();
  });

  it('reuses recent quotes and preserves their age when domain detail is refreshed', async () => {
    await getPortfolio(true);
    await stepRenewalPricing();
    const before = readEntry<{ renewalQuoteFetchedAt: number }>(
      'detail',
      'dynadot:first.ai',
    )?.data.renewalQuoteFetchedAt;
    await getDomainDetail('dynadot', 'first.ai', true);
    expect(
      readEntry<{ renewalQuoteFetchedAt: number }>('detail', 'dynadot:first.ai')
        ?.data.renewalQuoteFetchedAt,
    ).toBe(before);
    const result = await getPortfolio(true);
    expect(result.renewalPricing?.remaining).toBe(2);
    expect(getRenewalPricingStatus().remaining).toBe(2);
  });

  it('keeps desktop sync behavior synchronous', async () => {
    configureIncrementalRenewalPricing(false);
    const result = await getPortfolio(true);
    expect(result.renewalPricing).toBeUndefined();
    expect(pricing).toHaveBeenCalledTimes(3);
  });
});

it('retries legacy-strategy failures once without losing cooldown, attempt count or the last failure record', async () => {
  await getPortfolio(true);
  const syncedAt = readEntry<{ lastSyncedAt: number }>('portfolio', 'dynadot')!
    .data.lastSyncedAt;
  const notBefore = Date.now() + 60_000;
  const prior = { code: 'quote_unavailable', at: Date.now() };
  await flushWrites();
  await raw.put('renewal-pricing-jobs', 'dynadot', {
    syncedAt,
    pending: ['second.ai'],
    failed: 1,
    failures: { 'first.ai': prior },
    notBefore,
    attempts: 2,
  });
  configureStore(raw);
  await hydrateStores();
  resetRegistrarClients();
  expect(getRenewalPricingStatus()).toMatchObject({
    remaining: 3,
    failed: 0,
    nextAt: notBefore,
  });
  await stepRenewalPricing();
  await flushWrites();
  expect(await raw.get('renewal-pricing-jobs', 'dynadot')).toMatchObject({
    quoteStrategy: 'rest-single-search-v1',
    pending: ['second.ai', 'first.ai', 'third.ai'],
    failed: 1,
    failures: { 'first.ai': prior },
    notBefore,
    attempts: 2,
  });
  expect(pricing).not.toHaveBeenCalled();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(notBefore + 1);
  await stepRenewalPricing();
  await stepRenewalPricing();
  await stepRenewalPricing();
  await flushWrites();
  expect(getRenewalPricingStatus()).toEqual({ remaining: 0, failed: 0 });
  expect(await raw.get('renewal-pricing-jobs', 'dynadot')).toMatchObject({
    failed: 0,
    failures: {},
  });
  pricing.mockClear();
  await stepRenewalPricing();
  expect(pricing).not.toHaveBeenCalled();
});
