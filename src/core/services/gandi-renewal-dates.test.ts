import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRegistrar } from '@aoxborrow/registrar-client';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
  getStore,
} from '../storage/namespace';
import { readEntry, writeEntry } from './cache';
import { createAccount } from './accounts';
import {
  getCachedDetail,
  getCachedDomainDetail,
  getCachedPortfolio,
  getDomainDetail,
  getMergedPortfolio,
} from './registrars';

beforeEach(async () => {
  configureStore(new MemoryDocStore());
  await hydrateStores();
});

describe('Gandi provider renewal semantics', () => {
  it('keeps update and renewal-window dates out of both list and detail deadlines', async () => {
    const provider = createRegistrar('gandi', { apiKey: 'synthetic-key' });
    const record = {
      fqdn: 'future.example',
      dates: {
        updated_at: '2025-08-22T07:02:32Z',
        renew_begins_at: '2025-01-01T00:00:00Z',
        registry_ends_at: '2029-11-24T14:04:05Z',
      },
    };
    const request = vi.fn(async () => record as unknown);
    (
      provider as unknown as { http: { request: typeof request } }
    ).http.request = request;
    const detail = await provider.getDomain('future.example');
    request.mockResolvedValueOnce([record]);
    const list = await provider.listDomains();
    for (const domain of [detail, list[0]]) {
      expect(domain.renewalDate).toBeNull();
      expect(domain.expirationDate?.toISOString()).toBe(
        '2029-11-24T14:04:05.000Z',
      );
    }
    expect(request).toHaveBeenCalledTimes(2);
  });
});

it('qualifies old list and detail overlays without rewriting storage or touching another account', async () => {
  const gandi = await createAccount('gandi', 'Legacy Gandi', {
    apiKey: 'synthetic',
  });
  const other = await createAccount('porkbun', 'Other', {
    apiKey: 'synthetic',
    secretApiKey: 'synthetic',
  });
  const old = {
    domainName: 'future.example',
    registrar: 'gandi',
    status: 'active',
    createdDate: null,
    expirationDate: '2029-11-24T14:04:05Z',
    renewalDate: '2025-08-22T07:02:32Z',
    autoRenew: false,
    privacy: true,
    locked: true,
    nameservers: ['ns1.example'],
  };
  const portfolio = { domains: [old], lastSyncedAt: 123, lastError: null };
  writeEntry('portfolio', gandi.id, portfolio);
  writeEntry('portfolio', other.id, {
    ...portfolio,
    domains: [{ ...old, registrar: 'porkbun' }],
  });
  writeEntry('detail', `${gandi.id}:future.example`, {
    ...old,
    renewalQuote: { renewal: 45, currency: 'USD' },
    renewalQuoteFetchedAt: 456,
  });
  writeEntry('detail', `${other.id}:future.example`, old);
  await flushWrites();
  const original = JSON.stringify(readEntry('portfolio', gandi.id));
  const originalDetail = JSON.stringify(
    readEntry('detail', `${gandi.id}:future.example`),
  );
  const storedBefore = await getStore().loadAll!();
  const gandiRow = () =>
    getCachedPortfolio()!.domains.find((d) => d.accountId === gandi.id)!;
  expect(gandiRow()).toMatchObject({
    renewalDate: null,
    renewalDateIssue: 'gandi-updated-at-v1',
    accountId: gandi.id,
  });
  expect(getCachedDetail()[`${gandi.id}:future.example`]).toMatchObject({
    renewalDate: null,
    renewalDateIssue: 'gandi-updated-at-v1',
  });
  expect(
    getCachedDomainDetail(gandi.id, 'future.example')?.renewalDate,
  ).toBeNull();
  expect(
    (await getDomainDetail('gandi', 'future.example', false, gandi.id))
      ?.renewalDate,
  ).toBeNull();
  expect(
    getMergedPortfolio().domains.find((d) => d.accountId === gandi.id)
      ?.renewalDate,
  ).toBeNull();
  expect(
    getMergedPortfolio().domains.find((d) => d.accountId === other.id)
      ?.renewalDate,
  ).toEqual(new Date(old.renewalDate));
  // A second read does not migrate or restamp either encrypted-cache entry.
  gandiRow();
  await flushWrites();
  expect(JSON.stringify(readEntry('portfolio', gandi.id))).toBe(original);
  expect(
    JSON.stringify(readEntry('detail', `${gandi.id}:future.example`)),
  ).toBe(originalDetail);
  expect(await getStore().loadAll!()).toEqual(storedBefore);
});
