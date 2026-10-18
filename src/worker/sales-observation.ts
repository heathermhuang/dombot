import {
  getCachedPortfolio,
  getRegistrarMetadata,
} from '../core/services/registrars';
import { getListPrices } from '../core/services/list-prices';
import { listEvents } from '../core/services/domain-events';
import { ownershipByDomain } from '../shared/ownership';
import { canonicalDomain } from '../shared/publication';
import type { SaleDraft } from '../shared/sales';
import type { SaleObservation } from './sales-store';

/** A request-local index; it never survives a hydrate or crosses tenants. */
export function createSaleObserver(): (draft: SaleDraft) => SaleObservation {
  const domains = new Map<
    string,
    NonNullable<ReturnType<typeof getCachedPortfolio>>['domains']
  >();
  for (const d of getCachedPortfolio()?.domains ?? []) {
    try {
      const name = canonicalDomain(d.domainName);
      domains.set(name, [...(domains.get(name) ?? []), d]);
    } catch {
      /* Invalid records grant no authority. */
    }
  }
  const accounts = new Map(
    getRegistrarMetadata().map((a) => [a.accountId ?? a.name, a]),
  );
  const ownership = ownershipByDomain(listEvents()),
    prices = getListPrices(),
    now = Date.now();
  return (draft) => {
    const rows = domains.get(draft.domain) ?? [],
      ids = new Set(rows.map((d) => d.accountId ?? d.registrar));
    const matched = [...ids].map((id) => accounts.get(id));
    const observedAt = matched.length
      ? Math.min(...matched.map((a) => a?.sync.lastSyncedAt ?? 0))
      : 0;
    const archived = ownership.get(draft.domain)?.archived;
    const available =
      ids.size === 1 &&
      !archived &&
      rows.every((d) => d.source !== 'imported' && !d.deleted) &&
      matched.every((a) => a?.configured && a.enabled && !a.sync.lastError) &&
      observedAt <= now &&
      observedAt + 86400_000 > now;
    return {
      price: prices[draft.domain] ?? null,
      ownershipFingerprint: JSON.stringify([
        draft.domain,
        [...ids].sort(),
        observedAt,
        !!archived,
        available,
      ]),
      controlExpiresAt: observedAt + 86400_000,
      available,
      reason: available
        ? null
        : ids.size > 1
          ? 'Resolve conflicting registrar accounts before publishing.'
          : 'Sync a connected registrar to confirm current control. Imported and historical names cannot be activated.',
    };
  };
}
export function observeSale(draft: SaleDraft): SaleObservation {
  return createSaleObserver()(draft);
}
export function salesControlState(): Map<string, string> {
  const observer = createSaleObserver(),
    names = new Set(
      (getCachedPortfolio()?.domains ?? []).map((d) => {
        try {
          return canonicalDomain(d.domainName);
        } catch {
          return '';
        }
      }),
    );
  return new Map(
    [...names]
      .filter(Boolean)
      .map((domain) => [
        domain,
        observer({ domain } as SaleDraft).ownershipFingerprint,
      ]),
  );
}
export function changedSalesDomains(
  before: Map<string, string>,
  after: Map<string, string>,
): string[] {
  return [...new Set([...before.keys(), ...after.keys()])].filter(
    (name) => before.get(name) !== after.get(name),
  );
}
