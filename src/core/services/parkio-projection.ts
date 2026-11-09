import type { ParkioCacheStatus } from '../../shared/parkio';
import { toAscii } from '../../shared/domain-name';
import type { Domain, Portfolio } from '../../shared/ipc';
// Host-supplied, strictly loaded observations. Never read by registrar authority
// reconciliation. The Worker installs a fresh projection under its request lock.
let rows: Domain[] = [];
let sources: ParkioCacheStatus[] = [];
let refresh: ((manual: boolean) => Promise<void>) | undefined;
export function configureParkioProjection(
  next: Domain[],
  refresher?: (manual: boolean) => Promise<void>,
  sourceStatus: ParkioCacheStatus[] = [],
) {
  refresh = refresher;
  sources = sourceStatus;
  rows = next;
}
export function withParkioProjection(portfolio: Portfolio): Portfolio {
  const held = new Set(portfolio.domains.map((r) => toAscii(r.domainName)));
  return {
    ...portfolio,
    fetchedAt:
      Math.max(
        portfolio.fetchedAt ?? 0,
        ...rows.map((r) => r.parkio?.lastSuccessfulCheckAt ?? 0),
      ) || null,
    domains: [
      ...portfolio.domains,
      ...rows.filter((r) => !held.has(toAscii(r.domainName))),
    ],
  };
}
export function parkioProjection() {
  return rows;
}

export async function refreshParkioProjection(manual: boolean) {
  await refresh?.(manual);
}

export function parkioSourceStatus() {
  return sources;
}
