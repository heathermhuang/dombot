import type { SyncEvent } from '../../shared/sync-monitor';
import type { DynadotCircuitStatus } from '../../shared/proxy-scheduler';
import type { RegistrarPortfolioEntry } from './registrars';

/** Exact stopped-incident migration, used only by the guarded release operation.
 * It preserves holdings, last-good timestamps, attempts and diagnostic history. */
export function rearmDynadotRestriction(
  entry: RegistrarPortfolioEntry,
  latest: SyncEvent,
  expected: Pick<
    SyncEvent,
    'id' | 'accountId' | 'source' | 'engine' | 'domains' | 'lastGoodAt' | 'at'
  > & { errorAt: number },
  restriction: DynadotCircuitStatus,
): RegistrarPortfolioEntry | null {
  if (
    latest.ok ||
    latest.code !== 'rate_limit' ||
    latest.httpStatus !== 429 ||
    latest.route !== 'managed' ||
    latest.trigger !== 'scheduled' ||
    Object.entries(expected)
      .filter(([key]) => key !== 'errorAt')
      .some(([key, value]) => Reflect.get(latest, key) !== value) ||
    entry.domains.length !== expected.domains ||
    entry.lastSyncedAt !== expected.lastGoodAt ||
    // Older local deferrals could advance the cache error time without an
    // upstream event. Both independently observed checkpoints stay fenced.
    entry.lastErrorAt !== expected.errorAt ||
    !entry.lastError ||
    !/rate.?limit|429/i.test(entry.lastError) ||
    entry.recovery?.state !== 'failed' ||
    entry.recovery.attempts !== 3 ||
    restriction.state !== 'open' ||
    restriction.probes !== 0
  )
    return null;
  return {
    ...entry,
    lastError:
      'Dynadot failed-request IP restriction. Cached domains are retained; renewal pricing is blocked with pending work retained. One inventory recovery probe is eligible after the application quiet period; provider clearance is not guaranteed.',
    recovery: {
      ...entry.recovery,
      state: 'deferred',
      retryAt: restriction.notBefore,
      restriction,
    },
  };
}
