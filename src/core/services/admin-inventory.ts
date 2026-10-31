import {
  getCachedPortfolio,
  getCachedDetail,
  getPortfolioPricing,
  getRegistrarMetadata,
} from './registrars';
import { getImportedDomains } from './imported-domains';
import { listEvents } from './domain-events';
import { readEntry } from './cache';
import { importedRows } from '../../shared/imported-domains';
import { ownershipByDomain, archiveRows } from '../../shared/ownership';
import { domainKey } from '../../shared/account-key';
import { toAscii } from '../../shared/domain-name';
import { currencyInfo } from '../../shared/money';
import { STALE_AFTER_MS } from '../../shared/ipc';
import {
  adminInventorySchema,
  type AdminInventory,
  type AdminInventoryQuery,
  type AdminInventoryRow,
} from '../../shared/admin-inventory';
import type {
  Domain,
  DomainEvent,
  ImportedDomain,
  RegistrarMeta,
  RenewalPricing,
} from '../../shared/ipc';

const time = (value: unknown): number | null => {
  if (value == null) return null;
  const at =
    value instanceof Date
      ? value.getTime()
      : new Date(value as string | number).getTime();
  return Number.isSafeInteger(at) && at >= 0 ? at : null;
};
const decimal = (minor: bigint, places: number) => {
  const value = minor.toString().padStart(places + 1, '0');
  return places ? value.slice(0, -places) + '.' + value.slice(-places) : value;
};

export function projectAdminInventory(
  input: {
    domains: Domain[];
    imported: Record<string, ImportedDomain>;
    events: DomainEvent[];
    detail: Record<string, Partial<Domain>>;
    pricing: Record<string, RenewalPricing>;
    metadata: RegistrarMeta[];
    quoteTimes: Record<string, number | null>;
    available: boolean;
  },
  query: AdminInventoryQuery,
  at = Date.now(),
): AdminInventory {
  const ownership = ownershipByDomain(input.events);
  const live = [
    ...input.domains,
    ...importedRows(input.imported, input.domains),
  ];
  const domains = [...live, ...archiveRows(ownership, live, input.metadata)];
  const multiplicity = new Map<string, number>();
  for (const domain of domains) {
    const name = toAscii(domain.domainName);
    if (!ownership.get(name)?.archived)
      multiplicity.set(name, (multiplicity.get(name) ?? 0) + 1);
  }
  const accounts = new Map(
    input.metadata.map((account) => [
      account.accountId ?? account.name,
      account,
    ]),
  );
  const rows: AdminInventoryRow[] = domains.map((domain) => {
    const key = domainKey(domain),
      name = toAscii(domain.domainName),
      detail = input.detail[key];
    const pricing = input.pricing[key],
      currency = pricing ? currencyInfo(pricing.currency) : null;
    const valid =
      pricing &&
      pricing.source !== 'unavailable' &&
      pricing.renewal !== null &&
      Number.isFinite(pricing.renewal) &&
      pricing.renewal >= 0 &&
      pricing.renewal <= 1e12 &&
      currency;
    const account = accounts.get(domain.accountId ?? domain.registrar);
    const inventoryAt =
      domain.source === 'imported' || domain.departed
        ? time(domain.syncedAt)
        : (account?.sync.lastSyncedAt ?? null);
    const quoteAt =
      pricing?.source === 'api'
        ? (input.quoteTimes[key] ?? null)
        : pricing?.source === 'portal'
          ? time(pricing.observedAt)
          : null;
    return {
      domain: name,
      registrar: domain.importedRegistrarLabel || domain.registrar,
      accountId: domain.accountId ?? domain.registrar,
      accountLabel:
        domain.accountLabel ??
        (domain.source === 'imported' ? 'Imported' : 'Default'),
      source: domain.source,
      archived: Boolean(ownership.get(name)?.archived),
      departed: Boolean(domain.departed),
      ambiguous: (multiplicity.get(name) ?? 0) > 1,
      expiresAt: time(detail?.expirationDate ?? domain.expirationDate),
      inventoryAt,
      inventoryStale: inventoryAt === null || at - inventoryAt > STALE_AFTER_MS,
      renewal: valid ? pricing.renewal!.toFixed(currency.decimals) : null,
      currency: valid ? currency.code : null,
      priceSource: valid ? pricing.source : 'unavailable',
      quoteAt,
      priceAge: !valid
        ? 'unavailable'
        : pricing.source === 'manual'
          ? 'manual'
          : pricing.source === 'api' || pricing.source === 'portal'
            ? quoteAt === null
              ? 'unknown'
              : at - quoteAt > STALE_AFTER_MS
                ? 'stale'
                : 'current'
            : 'estimate',
    };
  });
  const owned = rows.filter((row) => !row.archived);
  const totals = new Map<
    string,
    { minor: bigint; domains: number; places: number }
  >();
  let priced = 0,
    stalePrices = 0;
  for (const row of owned) {
    if (row.ambiguous || row.renewal === null || row.currency === null)
      continue;
    const places = currencyInfo(row.currency)!.decimals;
    const entry = totals.get(row.currency) ?? { minor: 0n, domains: 0, places };
    entry.minor += BigInt(row.renewal.replace('.', ''));
    entry.domains++;
    totals.set(row.currency, entry);
    priced++;
    if (row.priceAge === 'stale') stalePrices++;
  }
  const names = new Set(owned.map((row) => row.domain));
  const search = query.q.trim().toLowerCase();
  const filtered = rows
    .filter(
      (row) =>
        (query.state === 'all' ||
          (query.state === 'archived') === row.archived) &&
        `${row.domain} ${row.registrar} ${row.accountLabel} ${row.accountId}`
          .toLowerCase()
          .includes(search),
    )
    .sort(
      (a, b) =>
        a.domain.localeCompare(b.domain) ||
        a.accountId.localeCompare(b.accountId),
    );
  const active = input.metadata.filter(
    (account) => account.configured && account.enabled,
  );
  return adminInventorySchema.parse({
    at,
    available: input.available || domains.length > 0,
    owned: names.size,
    archived: [...ownership.values()].filter((value) => value.archived).length,
    unobservedAccounts: active.filter(
      (account) => account.sync.lastSyncedAt === null,
    ).length,
    failedAccounts: active.filter((account) => account.sync.lastError).length,
    staleAccounts: active.filter(
      (account) =>
        account.sync.lastSyncedAt !== null &&
        at - account.sync.lastSyncedAt > STALE_AFTER_MS,
    ).length,
    priced,
    unpriced: names.size - priced,
    ambiguous: new Set(
      owned.filter((row) => row.ambiguous).map((row) => row.domain),
    ).size,
    stalePrices,
    totals: [...totals]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, value]) => ({
        currency,
        amount: decimal(value.minor, value.places),
        domains: value.domains,
      })),
    query,
    matched: filtered.length,
    rows: filtered.slice(query.offset, query.offset + query.limit),
  });
}

/** Called under the engine's ordinary authenticate/hydrate/flush request lock.
 * No registrar calls, secret projection, price refresh or cache clearing. */
export function getAdminInventory(query: AdminInventoryQuery): AdminInventory {
  const portfolio = getCachedPortfolio();
  const domains = portfolio?.domains ?? [];
  const quoteTimes = Object.fromEntries(
    domains.map((domain) => [
      domainKey(domain),
      time(
        readEntry<{ renewalQuoteFetchedAt?: number }>(
          'detail',
          domainKey(domain),
        )?.data.renewalQuoteFetchedAt,
      ),
    ]),
  );
  return projectAdminInventory(
    {
      domains,
      imported: getImportedDomains(),
      events: listEvents(),
      detail: getCachedDetail(),
      pricing: getPortfolioPricing(),
      metadata: getRegistrarMetadata(),
      quoteTimes,
      available: portfolio !== null,
    },
    query,
  );
}
