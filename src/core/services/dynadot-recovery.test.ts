import { expect, it } from 'vitest';
import { createDomain } from '@aoxborrow/registrar-client';
import { rearmDynadotRestriction } from './dynadot-recovery';
import type { SyncEvent } from '../../shared/sync-monitor';

it('rearms only the exact failed incident without changing protected cached data', () => {
  const event: SyncEvent = {
    id: crypto.randomUUID(),
    accountId: 'account',
    source: 'a'.repeat(64),
    engine: '1.5.2-hosted.30',
    domains: 1,
    lastGoodAt: 100,
    at: 200,
    startedAt: 190,
    durationMs: 10,
    seq: 16,
    trigger: 'scheduled',
    ok: false,
    code: 'rate_limit',
    httpStatus: 429,
    route: 'managed',
  };
  const expected = {
    id: event.id,
    accountId: event.accountId,
    source: event.source,
    engine: event.engine,
    domains: 1,
    lastGoodAt: 100,
    at: 200,
    errorAt: 210,
  };
  const entry = {
    domains: [
      createDomain({ domainName: 'retained.test', registrar: 'dynadot' }),
    ],
    lastSyncedAt: 100,
    lastError: 'Dynadot rate limit',
    lastErrorAt: 210,
    recovery: { state: 'failed' as const, attempts: 3 },
  };
  const circuit = {
    state: 'open' as const,
    reason: 'failed_request_ip' as const,
    scope: 'global' as const,
    probes: 0,
    notBefore: 1800000,
  };
  const result = rearmDynadotRestriction(entry, event, expected, circuit)!;
  expect(result.domains).toBe(entry.domains);
  expect(result.lastSyncedAt).toBe(100);
  expect(result.lastErrorAt).toBe(210);
  expect(result.recovery).toMatchObject({
    attempts: 3,
    state: 'deferred',
    retryAt: 1800000,
  });
  for (const changed of [
    { ...event, source: 'b'.repeat(64) },
    { ...event, domains: 2 },
    { ...event, id: crypto.randomUUID() },
    { ...event, ok: true },
  ])
    expect(
      rearmDynadotRestriction(entry, changed, expected, circuit),
    ).toBeNull();
  expect(
    rearmDynadotRestriction(
      { ...entry, lastSyncedAt: 101 },
      event,
      expected,
      circuit,
    ),
  ).toBeNull();
  expect(
    rearmDynadotRestriction(
      { ...entry, recovery: { state: 'deferred', attempts: 2 } },
      event,
      expected,
      circuit,
    ),
  ).toBeNull();
});
