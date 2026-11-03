import { cachedListing } from '../core/services/markets/sync';
import {
  activeMarketAccounts,
  getMarketSyncState,
} from '../core/services/markets/accounts';
import { publicMarketOffer } from '../shared/market-public-offer';
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
import { salesControlClockToleranceMs } from '../shared/sales-domain-control';
import type { SaleDraft } from '../shared/hosted-sales';
import {
  SalesStore,
  type SaleObservation,
  type SaleObserver,
} from './sales-store';

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
    const record = ownership.get(draft.domain);
    const archived = Boolean(record?.sale || record?.removal);
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
          : 'Sync a connected registrar or verify your DNS before publishing. Imported names stay private until control is verified.',
    };
  };
}
/** DNS leases are tenant-local and never portable; a live registrar remains an alternative. */
function createControlObserver(env: Env): SaleObserver {
  const observe = createSaleObserver(env);
  let storage: Promise<SalesStore> | undefined;
  return async (draft) => {
    const normal = observe(draft);
    if (
      env.DOMBOT_AUTH !== 'gateway' ||
      normal.available ||
      env.SALES_DNS_CONTROL_ENABLED !== 'true'
    )
      return normal;
    const record = ownershipByDomain(listEvents()).get(draft.domain);
    if (record?.sale || record?.removal) return normal;
    storage ??= SalesStore.from(env);
    const store = await storage;
    const row = await env.DB.prepare(
      'SELECT c.domain_hash,c.proof_id,c.epoch,c.observed_at,c.expires_at FROM sales_control_leases c JOIN sale_drafts d ON d.id=c.listing_id WHERE d.domain_hash=? AND c.domain_hash=d.domain_hash AND c.revoked_at IS NULL AND c.observed_at<=? AND c.expires_at>?',
    )
      .bind(
        await store.hash('domain', draft.domain),
        Date.now() + salesControlClockToleranceMs,
        Date.now(),
      )
      .first<{
        domain_hash: string;
        proof_id: string;
        epoch: number;
        observed_at: number;
        expires_at: number;
      }>();
    if (!row || row.domain_hash !== (await store.hash('domain', draft.domain)))
      return normal;
    return {
      ...normal,
      available: true,
      reason: null,
      controlSource: 'dns',
      controlExpiresAt: row.expires_at,
      ownershipFingerprint: JSON.stringify([
        'dns',
        row.proof_id,
        row.epoch,
        row.observed_at,
        row.expires_at,
      ]),
    };
  };
}
export async function observeSale(
  draft: SaleDraft,
  env: Env,
): Promise<SaleObservation> {
  return createVerifiedSaleObserver(env)(draft);
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
        ...listEvents().map((event) => ({ domainName: event.domain })),
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

/** Market reads add terms; they never grant control. */
export function createVerifiedSaleObserver(env: Env): SaleObserver {
  const control = createControlObserver(env);
  return async (draft) => {
    const observation = await control(draft),
      source = draft.priceSource;
    if (source?.kind !== 'market') return observation;
    const listing = cachedListing(source.accountId, draft.domain);
    if (
      !listing ||
      listing.market !== source.market ||
      !activeMarketAccounts().some((a) => a.id === source.accountId)
    )
      return { ...observation, marketOffer: null };
    return {
      ...observation,
      marketOffer: await publicMarketOffer(
        listing,
        getMarketSyncState(source.accountId),
      ),
    };
  };
}
