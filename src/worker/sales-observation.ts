import {
  managedControl,
  managedControls,
} from '../shared/sales-managed-control';
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
export function createSaleObserver(
  env: Partial<
    Pick<
      Env,
      'DOMBOT_AUTH' | 'DOMBOT_WORKSPACE_ID' | 'DOMBOT_SALES_DNS_CONTROL'
    >
  > = {},
): (draft: SaleDraft) => SaleObservation {
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
    const managed = managedControl(env, draft.domain, now);
    if (managed && !archived)
      return {
        price: prices[draft.domain] ?? null,
        available: true,
        reason: null,
        controlSource: 'operator-dns',
        controlExpiresAt: managed.expiresAt,
        ownershipFingerprint: JSON.stringify([
          'operator-dns',
          managed.workspace,
          managed.domain,
          managed.proofId,
          managed.observedAt,
          managed.expiresAt,
        ]),
      };
    const available =
      ids.size === 1 &&
      !archived &&
      rows.every((d) => d.source !== 'imported' && !d.deleted) &&
      matched.every((a) => a?.configured && a.enabled && !a.sync.lastError) &&
      observedAt <= now &&
      observedAt + 86400_000 > now;
    return {
      price: prices[draft.domain] ?? null,
      controlSource: 'registrar',
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
export function observeSale(
  draft: SaleDraft,
  env: Partial<
    Pick<
      Env,
      'DOMBOT_AUTH' | 'DOMBOT_WORKSPACE_ID' | 'DOMBOT_SALES_DNS_CONTROL'
    >
  > = {},
): SaleObservation {
  return createSaleObserver(env)(draft);
}
export function salesControlState(
  env: Partial<
    Pick<
      Env,
      'DOMBOT_AUTH' | 'DOMBOT_WORKSPACE_ID' | 'DOMBOT_SALES_DNS_CONTROL'
    >
  > = {},
): Map<string, string> {
  const observer = createSaleObserver(env),
    names = new Set(
      [
        ...(getCachedPortfolio()?.domains ?? []),
        ...managedControls(env.DOMBOT_SALES_DNS_CONTROL).map((p) => ({
          domainName: p.domain,
        })),
      ].map((d) => {
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
