import type { Domain, Portfolio } from '../../shared/ipc';
// Host-supplied, strictly loaded observations. Never read by registrar authority
// reconciliation. The Worker installs a fresh projection under its request lock.
let rows: Domain[] = [];
let refresh: ((manual: boolean) => Promise<void>) | undefined;
export function configureParkioProjection(
  next: Domain[],
  refresher?: (manual: boolean) => Promise<void>,
) {
  refresh = refresher;
  rows = next;
}
export function withParkioProjection(portfolio: Portfolio): Portfolio {
  const held = new Set(
    portfolio.domains.map((r) => r.domainName.toLowerCase()),
  );
  return {
    ...portfolio,
    fetchedAt:
      Math.max(
        portfolio.fetchedAt ?? 0,
        ...rows.map((r) => r.parkio?.lastSuccessfulCheckAt ?? 0),
      ) || null,
    domains: [
      ...portfolio.domains,
      ...rows.filter((r) => !held.has(r.domainName.toLowerCase())),
    ],
  };
}
export function parkioProjection() {
  return rows;
}

export async function refreshParkioProjection(manual: boolean) {
  await refresh?.(manual);
}
