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
