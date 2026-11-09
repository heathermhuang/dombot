import { ACQUISITION_TYPES } from '../shared/domain-events';
import { sourcePriceFingerprint } from '../core/publication/sales';
import {
  cachedListing,
  marketListings,
  marketSales,
} from '../core/services/markets/sync';
import {
  activeMarketAccounts,
  getMarketSyncState,
  marketAccountViews,
} from '../core/services/markets/accounts';
import {
  publicMarketOffer,
  supportsPublicMarket,
} from '../shared/market-public-offer';
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
  const events = listEvents(),
    arrived = new Map<string, string>();
  for (const event of events)
    if (
      ACQUISITION_TYPES.has(event.type) &&
      event.date &&
      event.date > (arrived.get(event.domain) ?? '')
    )
      arrived.set(event.domain, event.date);
  const transactions = marketSales(),
    pending = new Set(
      transactions
        .filter(
          (s) =>
            ['in_progress', 'unknown'].includes(s.status) &&
            (!s.soldOn || (arrived.get(s.name) ?? '') < s.soldOn),
        )
        .map((s) => s.name),
    );
  const ownership = ownershipByDomain(events, transactions),
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
        transactionState: record?.sale
          ? 'completed'
          : pending.has(draft.domain)
            ? 'pending'
            : null,
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
      transactionState: record?.sale
        ? 'completed'
        : pending.has(draft.domain)
          ? 'pending'
          : null,
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
  const listings = marketListings(),
    sales = marketSales(),
    prices = getListPrices();
  const listingState = new Map<string, unknown[]>(),
    saleState = new Map<string, unknown[]>();
  for (const l of listings)
    listingState.set(l.name, [
      ...(listingState.get(l.name) ?? []),
      [
        l.accountId,
        l.status,
        l.forSale,
        l.price,
        l.currency,
        l.buyNow,
        l.minOffer,
        l.discount,
        l.publicObservedAt,
      ],
    ]);
  for (const sale of sales)
    saleState.set(sale.name, [
      ...(saleState.get(sale.name) ?? []),
      [sale.accountId, sale.id, sale.status, sale.action],
    ]);
  const accountState = marketAccountViews().map((a) => [
    a.id,
    a.enabled,
    a.configured,
    a.sync?.lastError,
    a.sync?.incomplete,
  ]);
  const observer = createSaleObserver(env),
    names = new Set(
      [
        ...(getCachedPortfolio()?.domains ?? []),
        ...listings.map((l) => ({ domainName: l.name })),
        ...sales.map((l) => ({ domainName: l.name })),
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
        JSON.stringify([
          observer({ domain } as SaleDraft).ownershipFingerprint,
          listingState.get(domain) ?? [],
          accountState,
          saleState.get(domain) ?? [],
          sourcePriceFingerprint(prices[domain]),
        ]),
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
      !supportsPublicMarket(listing.market) ||
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
