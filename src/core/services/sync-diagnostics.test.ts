import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryDocStore } from '../storage/doc-store';
import {
  configureStore,
  flushWrites,
  hydrateStores,
  clearCacheNamespaces,
  importNamespaces,
} from '../storage/namespace';
import {
  configureSyncDiagnostics,
  recordSyncAttempt,
} from './sync-diagnostics';
import {
  classifySyncFailure,
  syncDiagnosticsSchema,
} from '../../shared/sync-monitor';
let store: MemoryDocStore;
const input = (at = Date.now(), ok = false) => ({
  accountId: 'dynadot',
  trigger: 'manual' as const,
  startedAt: at - 2500,
  at,
  durationMs: 2500,
  ok,
  lastGoodAt: ok ? at : null,
  domains: 12,
  route: 'managed' as const,
});
beforeEach(async () => {
  store = new MemoryDocStore();
  configureStore(store);
  await hydrateStores();
  configureSyncDiagnostics(true);
});
describe('retained Dynadot attempt diagnostics', () => {
  it('retains a brief failure through a successful retry, cache clear and import', async () => {
    recordSyncAttempt(
      input(),
      new Error(
        'proxy [proxy:PROXY_QUEUE_TIMEOUT] https://private.test?key=secret',
      ),
    );
    recordSyncAttempt({ ...input(Date.now(), true), trigger: 'mcp' });
    clearCacheNamespaces();
    importNamespaces({});
    await flushWrites();
    const snapshot = syncDiagnosticsSchema.parse(
      await store.get('sync-monitor', 'diagnostics'),
    );
    expect(snapshot.events.map((e) => [e.ok, e.code, e.trigger])).toEqual([
      [false, 'queue_timeout', 'manual'],
      [true, 'none', 'mcp'],
    ]);
    expect(JSON.stringify(snapshot)).not.toMatch(/private.test|secret|https:/);
  });
  it('retains the last 200 attempts and reports the exact pruned sequence', async () => {
    for (let i = 0; i < 203; i++)
      recordSyncAttempt({
        ...input(1700000000000 + i, true),
        accountId: 'account-' + i,
      });
    await flushWrites();
    const snapshot = syncDiagnosticsSchema.parse(
      await store.get('sync-monitor', 'diagnostics'),
    );
    expect(snapshot).toMatchObject({ seq: 203, prunedThrough: 3 });
    expect(snapshot.events).toHaveLength(200);
    recordSyncAttempt(input(1700000000203 + 31 * 86400_000, true));
    await flushWrites();
    const expired = syncDiagnosticsSchema.parse(
      await store.get('sync-monitor', 'diagnostics'),
    );
    expect(expired.events).toHaveLength(1);
    expect(expired.prunedThrough).toBe(203);
  });
  it('classifies transport and HTTP causes without retaining arbitrary text', () => {
    expect(
      classifySyncFailure('blocked [proxy:PROXY_AUTH_FAILED:407] key=secret'),
    ).toEqual({ code: 'proxy_auth', httpStatus: 407 });
    expect(
      classifySyncFailure(
        "Request to 'https://private/?key=secret' failed with HTTP 429",
      ),
    ).toEqual({ code: 'rate_limit', httpStatus: 429 });
    expect(classifySyncFailure('TLS certificate handshake error')).toEqual({
      code: 'tls',
      httpStatus: null,
    });
    expect(classifySyncFailure('Failed to parse JSON response')).toEqual({
      code: 'response_parse',
      httpStatus: null,
    });
    expect(classifySyncFailure('arbitrary private text')).toEqual({
      code: 'unknown',
      httpStatus: null,
    });
  });
});
