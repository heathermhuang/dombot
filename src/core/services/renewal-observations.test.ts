import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRegistrar } from '@aoxborrow/registrar-client';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../storage/namespace';
import { writeEntry } from './cache';
import { createAccount } from './accounts';
import {
  configureRegistrarFactory,
  getPortfolioPricing,
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
