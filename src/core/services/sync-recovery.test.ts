import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDomain,
  createRegistrar,
  RateLimitError,
} from '@aoxborrow/registrar-client';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  hydrateStores,
  flushWrites,
} from '../storage/namespace';
import {
  configureIncrementalRenewalPricing,
  configureRegistrarFactory,
  resetRegistrarClients,
  saveRegistrarCredentials,
  getPortfolio,
  syncRegistrar,
  getRegistrarMetadata,
} from './registrars';
import { syncAll } from './auto-sync';
import { writeEntry } from './cache';
import { configureSyncDiagnostics } from './sync-diagnostics';
const list = vi.fn();
let raw: MemoryDocStore;
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-27T00:00:00Z'));
  raw = new MemoryDocStore();
  configureStore(raw);
  await hydrateStores();
  resetRegistrarClients();
  configureIncrementalRenewalPricing(true);
  configureSyncDiagnostics(true);
  configureRegistrarFactory((name, creds) => {
    const p = createRegistrar(name, creds);
    p.listDomains = list;
    return p;
  });
  list
    .mockReset()
    .mockResolvedValue([
      createDomain({ domainName: 'held.com', registrar: 'dynadot' }),
    ]);
  await saveRegistrarCredentials('dynadot', {
    apiKey: 'test-key',
    apiSecret: 'test-secret',
  });
});
afterEach(async () => {
  await flushWrites();
  configureIncrementalRenewalPricing(false);
  configureSyncDiagnostics(false);
  configureRegistrarFactory(null);
  resetRegistrarClients();
  vi.useRealTimers();
});
describe('inventory recovery', () => {
  it('deduplicates overlapping manual and scheduled inventory work', async () => {
    let finish!: (v: unknown[]) => void;
    list.mockImplementationOnce(() => new Promise((r) => (finish = r)));
    const first = syncRegistrar('dynadot');
    const second = getPortfolio(true, 'scheduled');
    expect(list).toHaveBeenCalledTimes(1);
    finish([]);
    await Promise.all([first, second]);
  });
  it('persists Retry-After and cached holdings across reload then recovers on schedule despite a fresh sibling', async () => {
    await syncRegistrar('dynadot');
    const lastGood = getRegistrarMetadata().find((m) => m.name === 'dynadot')!
      .sync.lastSyncedAt;
    vi.setSystemTime(Date.now() + 16000);
    list.mockRejectedValueOnce(
      new RateLimitError('HTTP 429 Too many requests', 180),
    );
    expect((await syncRegistrar('dynadot')).domains).toHaveLength(1);
    const failedAt = Date.now();
    expect(
      getRegistrarMetadata().find((m) => m.name === 'dynadot')!.sync.recovery,
    ).toMatchObject({
      state: 'deferred',
      retryAt: failedAt + 180000,
      attempts: 1,
    });
    await flushWrites();
    configureStore(raw);
    await hydrateStores();
    resetRegistrarClients();
    await syncRegistrar('dynadot');
    expect(list).toHaveBeenCalledTimes(2);
    expect(
      getRegistrarMetadata().find((m) => m.name === 'dynadot')!.sync
        .lastSyncedAt,
    ).toBe(lastGood);
    // A sibling with fresh inventory must not mask this due recovery.
    await saveRegistrarCredentials('porkbun', {
      apiKey: 'pk',
      secretApiKey: 'secret',
    });
    writeEntry('portfolio', 'porkbun', {
      domains: [],
      lastSyncedAt: failedAt + 180001,
      lastError: null,
    });
    vi.setSystemTime(failedAt + 180001);
    expect(await syncAll(86400000)).toBe(true);
    expect(list).toHaveBeenCalledTimes(3);
    expect(
      getRegistrarMetadata().find((m) => m.name === 'dynadot')!.sync.recovery,
    ).toMatchObject({ state: 'recovered' });
    expect(
      getRegistrarMetadata().find((m) => m.name === 'dynadot')!.sync.lastError,
    ).toBeNull();
  });
  it('does not record a locally deferred call as another upstream failure', async () => {
    list.mockRejectedValueOnce(
      new RateLimitError('HTTP 429 [dynadot:shared-cooldown]', 180),
    );
    await syncRegistrar('dynadot');
    await flushWrites();
    expect(await raw.get('sync-monitor', 'diagnostics')).toBeNull();
    expect(
      getRegistrarMetadata().find((m) => m.name === 'dynadot')!.sync.recovery,
    ).toMatchObject({ state: 'deferred', attempts: 0 });
  });

  it('does not exhaust a recovered account when a sibling triggers shared cooldown', async () => {
    await syncRegistrar('dynadot');
    const lastGood = Date.now();
    // Older releases retained the completed incident's retry count on recovery.
    writeEntry('portfolio', 'dynadot', {
      domains: [createDomain({ domainName: 'held.com', registrar: 'dynadot' })],
      lastSyncedAt: lastGood,
      lastError: null,
      recovery: { state: 'recovered', attempts: 3 },
    });
    await flushWrites();
    const before = await raw.get('sync-monitor', 'diagnostics');
    list.mockRejectedValueOnce(
      new RateLimitError('HTTP 429 [dynadot:shared-cooldown]', 180),
    );
    await getPortfolio(true, 'scheduled');
    await flushWrites();
    const account = getRegistrarMetadata().find((m) => m.name === 'dynadot')!;
    expect(account.sync).toMatchObject({
      domainCount: 1,
      lastSyncedAt: lastGood,
      recovery: { state: 'deferred', attempts: 0 },
    });
    expect(await raw.get('sync-monitor', 'diagnostics')).toEqual(before);
    vi.setSystemTime(Date.now() + 180001);
    expect(await syncAll(86400000)).toBe(true);
    expect(list).toHaveBeenCalledTimes(3);
    expect(
      getRegistrarMetadata().find((m) => m.name === 'dynadot')!.sync,
    ).toMatchObject({
      lastError: null,
      recovery: { state: 'recovered', attempts: 0 },
    });
  });

  it('starts a new incident at one attempt after a previously recovered incident', async () => {
    writeEntry('portfolio', 'dynadot', {
      domains: [createDomain({ domainName: 'held.com', registrar: 'dynadot' })],
      lastSyncedAt: Date.now(),
      lastError: null,
      recovery: { state: 'recovered', attempts: 3 },
    });
    list.mockRejectedValueOnce(
      new RateLimitError('HTTP 429 Too many requests', 60),
    );
    await getPortfolio(true, 'scheduled');
    expect(
      getRegistrarMetadata().find((m) => m.name === 'dynadot')!.sync.recovery,
    ).toMatchObject({ state: 'deferred', attempts: 1 });
    vi.setSystemTime(Date.now() + 60001);
    await syncAll(86400000);
    expect(
      getRegistrarMetadata().find((m) => m.name === 'dynadot')!.sync.recovery,
    ).toMatchObject({ state: 'recovered', attempts: 0 });
  });

  it('stops automatic retries after three total attempts and preserves holdings', async () => {
    list.mockRejectedValue(
      new RateLimitError('HTTP 429 Too many requests', 60),
    );
    await syncRegistrar('dynadot');
    for (let i = 0; i < 4; i++) {
      vi.setSystemTime(Date.now() + 240001);
      await getPortfolio(true, 'scheduled');
    }
    expect(list).toHaveBeenCalledTimes(3);
    expect(
      getRegistrarMetadata().find((m) => m.name === 'dynadot')!.sync.recovery,
    ).toMatchObject({ state: 'failed', attempts: 3 });
  });
});
