import {
  canonicalDomain,
  privateListing,
  type PortfolioDraft,
  type PortfolioListing,
} from './publication';
import { domainKey } from './account-key';
import type { Domain, RegistrarMeta } from './ipc';

export interface CatalogEntry {
  listing: PortfolioListing;
  records: Domain[];
  target: Domain | null;
  reason: string | null;
}
/** New registrar inventory is visible immediately, but remains privately unselected. */
export function withInventory(
  draft: PortfolioDraft,
  inventory: Domain[],
): PortfolioDraft {
  const listings = new Map(draft.listings.map((item) => [item.domain, item]));
  for (const domain of inventory) {
    try {
      const name = canonicalDomain(domain.domainName);
      if (!listings.has(name)) listings.set(name, privateListing(name));
    } catch {
      /* Invalid provider records cannot become public candidates. */
    }
  }
  return { ...draft, listings: [...listings.values()] };
}
/** Registrar actions require one exact, live account target. Never invent one. */
export function buildDomainCatalog(
  listings: PortfolioListing[],
  inventory: Domain[],
  accounts: RegistrarMeta[] | null,
  accountFilter = '',
): Map<string, CatalogEntry> {
  const grouped = new Map<string, Map<string, Domain>>();
  for (const record of inventory) {
    try {
      const name = canonicalDomain(record.domainName);
      if (!grouped.has(name)) grouped.set(name, new Map());
      grouped.get(name)!.set(domainKey(record), record);
    } catch {
      /* Invalid provider names cannot be routed. */
    }
  }
  return new Map(
    listings.map((listing) => {
      const records = [...(grouped.get(listing.domain)?.values() ?? [])];
      const scoped = records.filter(
        (record) =>
          !accountFilter ||
          (record.accountId ?? record.registrar) === accountFilter,
      );
      const record = scoped.length === 1 ? scoped[0] : null;
      const account = record
        ? accounts?.find(
            (item) =>
              (item.accountId ?? item.name) ===
              (record.accountId ?? record.registrar),
          )
        : null;
      const reason =
        listing.visibility === 'historical'
          ? 'Historical record · registrar actions unavailable'
          : scoped.length === 0
            ? 'No connected registrar record'
            : scoped.length > 1
              ? 'Multiple accounts · choose an account filter'
              : record?.deleted
                ? 'Deleted registrar record'
                : !account?.configured || !account.enabled
                  ? 'Registrar account unavailable'
                  : null;
      return [
        listing.domain,
        { listing, records, target: reason ? null : record, reason },
      ];
    }),
  );
}
export function selectedRegistrarTargets(
  catalog: Map<string, CatalogEntry>,
  selection: Set<string>,
): { targets: Domain[]; blocked: number } {
  const entries = [...selection].map((name) => catalog.get(name));
  const blocked = entries.filter((entry) => !entry?.target).length;
  return {
    targets: blocked ? [] : entries.map((entry) => entry!.target!),
    blocked,
  };
}

export interface RegistrarFilters {
  account: string;
  tld: string;
  expiry: string;
  folder: string;
  nameserver: string;
}
export function matchesRegistrarFilters(
  entry: CatalogEntry,
  filters: RegistrarFilters,
  assignments: Record<string, string>,
  folderIds: Set<string>,
  hiddenFolderId: string,
  now = Date.now(),
): boolean {
  const records = entry.records.filter(
    (record) =>
      !filters.account ||
      (record.accountId ?? record.registrar) === filters.account,
  );
  if (filters.account && !records.length) return false;
  if (
    filters.tld &&
    entry.listing.domain.split('.').slice(1).join('.') !== filters.tld
  )
    return false;
  if (
    filters.expiry &&
    !records.some((record) => {
      if (!record.expirationDate) return false;
      const days =
        (new Date(record.expirationDate).getTime() - now) / 86_400_000;
      return filters.expiry === 'expired'
        ? days < 0
        : days >= 0 && days <= Number(filters.expiry);
    })
  )
    return false;
  if (
    filters.nameserver &&
    !records.some((record) =>
      record.nameservers?.some((name) =>
        name.toLowerCase().includes(filters.nameserver.toLowerCase()),
      ),
    )
  )
    return false;
  const folderOf = (record: Domain) => {
    const id = assignments[domainKey(record)];
    return id === hiddenFolderId || folderIds.has(id) ? id : undefined;
  };
  if (
    filters.folder &&
    !records.some((record) =>
      filters.folder === 'unassigned'
        ? !folderOf(record)
        : folderOf(record) === filters.folder,
    )
  )
    return false;
  if (
    !filters.folder &&
    records.length &&
    records.every((record) => folderOf(record) === hiddenFolderId)
  )
    return false;
  return true;
}

export function sortManagementRows<T extends PortfolioListing>(
  rows: T[],
  catalog: Map<string, CatalogEntry>,
  pricing: Record<string, { renewal: number | null }>,
  sort: string,
): T[] {
  if (sort !== 'expiry' && sort !== 'renewal') return rows;
  const value = (row: T) => {
    const target = catalog.get(row.domain)?.target;
    if (!target) return null;
    if (sort === 'renewal') return pricing[domainKey(target)]?.renewal ?? null;
    return target.expirationDate
      ? new Date(target.expirationDate).getTime()
      : null;
  };
  return [...rows].sort((a, b) => {
    const av = value(a),
      bv = value(b);
    if (av === null || !Number.isFinite(av))
      return bv === null || !Number.isFinite(bv) ? 0 : 1;
    if (bv === null || !Number.isFinite(bv)) return -1;
    return sort === 'renewal' ? bv - av : av - bv;
  });
}
