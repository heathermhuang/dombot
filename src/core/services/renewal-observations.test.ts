import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRegistrar } from '@aoxborrow/registrar-client';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../storage/namespace';
import { clearEntry, writeEntry } from './cache';
import { setTldRate } from './pricing';
import { createAccount } from './accounts';
import {
  configureRegistrarFactory,
  getPortfolioPricing,
  getRegistrarRenewalQuote,
  getRenewalPriceLive,
  resetRegistrarClients,
} from './registrars';
import { getAdminInventory } from './admin-inventory';
import { adminInventoryQuerySchema } from '../../shared/admin-inventory';
import { queryPortfolio } from '../mcp/portfolio-query';
import type { Domain } from '../../shared/ipc';

const now = Date.parse('2026-11-04T08:00:00Z');
let store: MemoryDocStore;
beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  store = new MemoryDocStore();
  configureStore(store);
  await hydrateStores();
  resetRegistrarClients();
});
afterEach(() => {
  configureRegistrarFactory(null);
  resetRegistrarClients();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const domain = (accountId: string): Domain => ({
  domainName: 'owned.io',
  registrar: 'gandi',
  accountId,
  accountLabel: 'Test',
  source: 'registrar',
  status: 'active',
  createdDate: null,
  expirationDate: new Date('2029-01-01'),
  renewalDate: null,
  autoRenew: false,
  locked: true,
  privacy: true,
  nameservers: [],
  syncedAt: new Date(now),
  deleted: false,
});
async function seed() {
  const account = await createAccount('gandi', 'Test', { apiKey: 'synthetic' });
  const row = domain(account.id);
  writeEntry('portfolio', account.id, {
    domains: [row],
    lastSyncedAt: now,
    lastError: null,
  });
  writeEntry('detail', `${account.id}:owned.io`, {
    renewalQuote: { renewal: 42, currency: 'USD' },
    renewalQuoteFetchedAt: now - 2 * 86400000,
  });
  await flushWrites();
  return { account, row };
}

it('agrees on stale quotes across owner, admin and MCP with fresh inventory, without any write or network call', async () => {
  const { account, row } = await seed();
  const key = `${account.id}:owned.io`;
  const before = await store.loadAll();
  const network = vi.fn(() => {
    throw Error('Unexpected network');
  });
  vi.stubGlobal('fetch', network);
  const prices = getPortfolioPricing();
  expect(prices[key]).toMatchObject({
    renewal: 42,
    source: 'api',
    observedAt: now - 2 * 86400000,
    inventoryAt: now,
    priceAge: 'stale',
  });
  const admin = getAdminInventory(adminInventoryQuerySchema.parse({}));
  expect(admin.rows[0]).toMatchObject({
    quoteAt: now - 2 * 86400000,
    inventoryAt: now,
    priceAge: 'stale',
  });
  const mcp = queryPortfolio(
    [row],
    [],
    {},
    { fetchedAt: now, registrars: ['gandi'], errors: [] },
    {},
    new Map(),
    { pricing: prices },
  );
  expect(mcp.rows[0]).toMatchObject({
    inventoryAt: now,
    renewalPrice: { observedAt: now - 2 * 86400000, priceAge: 'stale' },
  });
  await flushWrites();
  expect(network).not.toHaveBeenCalled();
  expect(await store.loadAll()).toEqual(before);
});

it('reports a genuine live read time, and keeps last-good price/age when a live read has no quote', async () => {
  const { account } = await seed();
  const provider = createRegistrar('gandi', { apiKey: 'synthetic' });
  const read = vi
    .spyOn(provider, 'getPricing')
    .mockResolvedValue({ tld: 'io', currency: 'USD' });
  configureRegistrarFactory(() => provider);
  const before = await store.loadAll();
  expect(
    await getRenewalPriceLive('gandi', 'owned.io', account.id),
  ).toMatchObject({
    renewal: 42,
    observedAt: now - 2 * 86400000,
    priceAge: 'stale',
  });
  read.mockResolvedValue({ tld: 'io', currency: 'USD', renewal: 43 });
  expect(
    await getRenewalPriceLive('gandi', 'owned.io', account.id),
  ).toMatchObject({
    renewal: 43,
    observedAt: now,
    inventoryAt: now,
    priceAge: 'current',
  });
  expect(read).toHaveBeenCalledTimes(2);
  await flushWrites();
  expect(await store.loadAll()).toEqual(before);
});

it('checks a held name once and returns a dated registrar quote without replacing the saved estimate', async () => {
  const { account } = await seed();
  clearEntry('detail', `${account.id}:owned.io`);
  setTldRate('gandi', 'io', 42, account.id);
  await flushWrites();
  const provider = createRegistrar('gandi', { apiKey: 'synthetic' });
  const read = vi.spyOn(provider, 'getPricing').mockResolvedValue({
    tld: 'io',
    renewal: 57,
    currency: 'EUR',
  });
  configureRegistrarFactory(() => provider);
  const target = {
    registrar: 'gandi',
    accountId: account.id,
    domainName: 'owned.io',
  } as const;
  const baseline = await store.loadAll();
  expect(getPortfolioPricing()[`${account.id}:owned.io`]).toMatchObject({
    renewal: 42,
    source: 'tld',
    canCheckQuote: true,
  });

  expect(await getRegistrarRenewalQuote(target)).toMatchObject({
    accountId: account.id,
    domain: 'owned.io',
    renewal: 57,
    currency: 'EUR',
    source: 'api',
    observedAt: now,
    priceAge: 'current',
  });
  expect(read).toHaveBeenCalledOnce();
  expect(read).toHaveBeenCalledWith(
    'owned.io',
    expect.objectContaining({ retries: 0 }),
  );
  read.mockResolvedValue({ tld: 'io', currency: 'USD' });
  expect(await getRegistrarRenewalQuote(target)).toBeNull();
  await flushWrites();
  expect(await store.loadAll()).toEqual(baseline);
});

it('does not contact the provider for an unknown name or a different account', async () => {
  const { account } = await seed();
  const other = await createAccount('gandi', 'Other', {
    apiKey: 'other-synthetic',
  });
  const provider = createRegistrar('gandi', { apiKey: 'synthetic' });
  const read = vi.spyOn(provider, 'getPricing');
  configureRegistrarFactory(() => provider);
  const target = {
    registrar: 'gandi',
    accountId: account.id,
    domainName: 'owned.io',
  } as const;
  await expect(
    getRegistrarRenewalQuote({ ...target, domainName: 'absent.io' }),
  ).rejects.toThrow(/Sync the selected/);
  await expect(
    getRegistrarRenewalQuote({ ...target, accountId: other.id }),
  ).rejects.toThrow(/different account/);
  expect(read).not.toHaveBeenCalled();
});

it('uses only a matching per-name premium renewal from Namecheap', async () => {
  const credentials = {
    username: 'test-user',
    apiKey: 'synthetic',
    clientIp: '192.0.2.1',
  };
  const account = await createAccount('namecheap', 'Test', credentials);
  writeEntry('portfolio', account.id, {
    domains: [{ ...domain(account.id), registrar: 'namecheap' }],
    lastSyncedAt: now,
    lastError: null,
  });
  const provider = createRegistrar('namecheap', credentials);
  const read = vi.spyOn(provider, 'checkAvailability').mockResolvedValue([
    {
      domainName: 'other.io',
      available: false,
      premium: true,
      renewalPrice: 1,
    },
    {
      domainName: 'owned.io',
      available: false,
      premium: true,
      renewalPrice: 129,
    },
  ]);
  const genericPricing = vi.spyOn(provider, 'getPricing');
  configureRegistrarFactory(() => provider);
  const target = {
    accountId: account.id,
    registrar: 'namecheap',
    domainName: 'owned.io',
  } as const;
  expect(await getRegistrarRenewalQuote(target)).toMatchObject({
    renewal: 129,
    currency: 'USD',
    source: 'api',
    observedAt: now,
  });
  read.mockResolvedValue([
    { domainName: 'owned.io', available: false, premium: false },
  ]);
  expect(await getRegistrarRenewalQuote(target)).toBeNull();
  expect(genericPricing).not.toHaveBeenCalled();
});
