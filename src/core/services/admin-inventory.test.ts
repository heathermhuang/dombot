import { afterEach, expect, it, vi } from 'vitest';
import { projectAdminInventory, getAdminInventory } from './admin-inventory';
import { adminInventoryQuerySchema } from '../../shared/admin-inventory';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  hydrateStores,
  flushWrites,
} from '../storage/namespace';
import type { Domain, RegistrarMeta, RenewalPricing } from '../../shared/ipc';
const now = Date.now();
const domain = (name: string, account = 'dynadot'): Domain => ({
  domainName: name,
  registrar: 'dynadot',
  accountId: account,
  accountLabel: account,
  status: 'active',
  createdDate: null,
  expirationDate: new Date(now + 86400_000),
  renewalDate: null,
  autoRenew: true,
  locked: true,
  privacy: true,
  nameservers: ['private-ns.test'],
  syncedAt: new Date(now),
  deleted: false,
  source: 'registrar',
});
const price = (
  name: string,
  value: number | null,
  currency = 'USD',
  source: RenewalPricing['source'] = 'api',
): RenewalPricing => ({
  domain: name,
  registrar: 'dynadot',
  renewal: value,
  currency,
  source,
});
const project = (
  domains: Domain[],
  pricing: Record<string, RenewalPricing>,
  extra: Partial<Parameters<typeof projectAdminInventory>[0]> = {},
  query = {},
) =>
  projectAdminInventory(
    {
      domains,
      pricing,
      imported: {},
      events: [],
      detail: {},
      metadata: [],
      quoteTimes: {},
      available: true,
      ...extra,
    },
    adminInventoryQuerySchema.parse(query),
    now,
  );
afterEach(() => vi.unstubAllGlobals());
it('totals each currency with decimal arithmetic and never prices unknown as zero', () => {
  const data = project(
    [domain('a.test'), domain('b.test'), domain('c.test'), domain('d.test')],
    {
      'dynadot:a.test': price('a.test', 0.1),
      'dynadot:b.test': price('b.test', 0.2),
      'dynadot:c.test': price('c.test', 123.456, 'KWD'),
      'dynadot:d.test': price('d.test', null),
    },
  );
  expect(data.totals).toEqual([
    { currency: 'KWD', amount: '123.456', domains: 1 },
    { currency: 'USD', amount: '0.30', domains: 2 },
  ]);
  expect(data).toMatchObject({ owned: 4, priced: 3, unpriced: 1 });
  expect(data.rows.find((row) => row.domain === 'd.test')).toMatchObject({
    renewal: null,
    currency: null,
    priceAge: 'unavailable',
  });
  expect(JSON.stringify(data)).not.toContain('nameservers');
  expect(JSON.stringify(data)).not.toContain('private-ns');
});
it('excludes ambiguous duplicates from cost subtotals instead of double-counting', () => {
  const data = project([domain('same.test'), domain('same.test', 'other')], {
    'dynadot:same.test': price('same.test', 10),
    'other:same.test': price('same.test', 20),
  });
  expect(data).toMatchObject({
    owned: 1,
    priced: 0,
    unpriced: 1,
    ambiguous: 1,
    totals: [],
  });
  expect(data.rows.every((row) => row.ambiguous)).toBe(true);
});
it('preserves price provenance, quote age, partial account coverage and pagination', () => {
  const metadata = [
    {
      name: 'dynadot',
      accountId: 'dynadot',
      configured: true,
      enabled: true,
      sync: { lastSyncedAt: null, lastError: 'private API error' },
    },
  ] as RegistrarMeta[];
  const data = project(
    [domain('c.test'), domain('a.test'), domain('b.test')],
    {
      'dynadot:a.test': price('a.test', 12),
      'dynadot:b.test': price('b.test', 13, 'USD', 'base'),
      'dynadot:c.test': price('c.test', 14, 'EUR', 'manual'),
    },
    { metadata, quoteTimes: { 'dynadot:a.test': now - 2 * 86400_000 } },
    { q: '.test', offset: 1, limit: 1 },
  );
  expect(data).toMatchObject({
    matched: 3,
    stalePrices: 1,
    unobservedAccounts: 1,
    failedAccounts: 1,
  });
  expect(data.rows[0]).toMatchObject({
    domain: 'b.test',
    priceSource: 'base',
    priceAge: 'estimate',
  });
  const all = project(
    [domain('a.test')],
    { 'dynadot:a.test': price('a.test', 12) },
    { quoteTimes: {} },
  );
  expect(all.rows[0].priceAge).toBe('unknown');
  expect(JSON.stringify(data)).not.toContain('private API error');
  expect(project([domain('a.test')], {}, {}, { offset: 100 }).rows).toEqual([]);
});
it('includes imports with their own currency and avoids duplicating registrar-held imports', () => {
  const imported = {
    'a.test': { registrar: null, addedAt: now, updatedAt: null },
    'import.test': {
      registrar: null,
      registrarLabel: 'Private registrar',
      addedAt: now,
      updatedAt: null,
    },
  };
  const data = project(
    [domain('a.test')],
    {
      'dynadot:a.test': price('a.test', 10),
      ':import.test': {
        domain: 'import.test',
        registrar: '',
        renewal: 20,
        currency: 'EUR',
        source: 'manual',
      },
    },
    { imported },
  );
  expect(data.owned).toBe(2);
  expect(data.rows.filter((row) => row.domain === 'a.test')).toHaveLength(1);
  expect(data.rows.find((row) => row.source === 'imported')?.registrar).toBe(
    'Private registrar',
  );
});
it('reads the actual cache without network calls, credential output or cache writes', async () => {
  const store = new MemoryDocStore();
  await store.put('registrar-credentials', 'dynadot', {
    apiKey: 'synthetic-secret',
    apiSecret: 'synthetic-secret-2',
  });
  await store.put('registrar-domains', 'dynadot', {
    fetchedAt: now,
    data: {
      domains: [domain('owned.test')],
      lastSyncedAt: now,
      lastError: null,
    },
  });
  await store.put('domain-prices', 'owned.test', {
    amount: '12.50',
    currency: 'USD',
  });
  configureStore(store);
  await hydrateStores();
  const before = await store.loadAll!();
  const network = vi.fn(() => {
    throw Error('No network permitted');
  });
  vi.stubGlobal('fetch', network);
  const result = getAdminInventory(adminInventoryQuerySchema.parse({}));
  await flushWrites();
  expect(result.owned).toBe(1);
  expect(result.rows[0].renewal).toBe('12.50');
  expect(network).not.toHaveBeenCalled();
  expect(await store.loadAll!()).toEqual(before);
  expect(JSON.stringify(result)).not.toContain('synthetic-secret');
});

it('excludes archived holdings from annual costs and includes historical archive rows when requested', () => {
  const event = {
    id: '001',
    domain: 'sold.test',
    type: 'sold' as const,
    source: 'user' as const,
    date: '2026-10-27',
    createdAt: now,
    updatedAt: null,
    accountId: 'dynadot',
  };
  const data = project(
    [domain('a.test')],
    { 'dynadot:a.test': price('a.test', 10) },
    { events: [event] },
    { state: 'all' },
  );
  expect(data).toMatchObject({ owned: 1, archived: 1, priced: 1 });
  expect(data.totals[0].amount).toBe('10.00');
  expect(data.rows.find((row) => row.domain === 'sold.test')).toMatchObject({
    archived: true,
    departed: true,
    renewal: null,
  });
});
