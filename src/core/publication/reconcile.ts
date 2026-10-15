import type { Domain, RegistrarMeta } from '../../shared/ipc';
import { STALE_AFTER_MS } from '../../shared/ipc';
import {
  canonicalDomain,
  draftSchema,
  privateListing,
  type PortfolioDraft,
  type PublishedPortfolio,
  type ReconciledListing,
} from '../../shared/publication';

/** No registrar calls and no inference that an absent domain was sold. */
export function reconcilePortfolio(
  draft: PortfolioDraft,
  domains: Domain[],
  accounts: RegistrarMeta[],
  now = Date.now(),
): ReconciledListing[] {
  const inventory = new Map<string, Domain[]>();
  for (const item of domains) {
    let name: string;
    try {
      name = canonicalDomain(item.domainName);
    } catch {
      continue;
    }
    inventory.set(name, [...(inventory.get(name) ?? []), item]);
  }
  const listings = new Map(draft.listings.map((item) => [item.domain, item]));
  for (const name of inventory.keys())
    if (!listings.has(name)) listings.set(name, privateListing(name));
  return [...listings.values()]
    .map((listing): ReconciledListing => {
      const matches = inventory.get(listing.domain) ?? [];
      const ids = new Set(
        matches.map((item) => item.accountId ?? item.registrar),
      );
      const matchedAccounts = [...ids].map((id) =>
        accounts.find((a) => (a.accountId ?? a.name) === id),
      );
      const healthy =
        matchedAccounts.length > 0 &&
        matchedAccounts.every(
          (a) =>
            a?.configured &&
            a.enabled &&
            !a.sync.lastError &&
            a.sync.lastSyncedAt !== null &&
            a.sync.lastSyncedAt <= now &&
            now - a.sync.lastSyncedAt < STALE_AFTER_MS,
        );
      return {
        ...listing,
        ownership:
          ids.size > 1
            ? 'conflict'
            : ids.size === 0
              ? 'unmatched'
              : healthy
                ? 'owned'
                : 'stale',
        accountLabels: matchedAccounts.map((a) =>
          a
            ? `${a.displayName} · ${a.accountLabel ?? 'Default'}`
            : 'Unknown account',
        ),
        lastSyncedAt: matchedAccounts.length
          ? Math.min(
              ...matchedAccounts.map((a) => a?.sync.lastSyncedAt ?? 0),
            ) || null
          : null,
      };
    })
    .sort((a, b) => a.domain.localeCompare(b.domain));
}

/** Construct each field explicitly. Extra private fields can never be published. */
export function publicSnapshot(
  draft: PortfolioDraft,
  review: ReconciledListing[],
  now = Date.now(),
): PublishedPortfolio {
  const clean = draftSchema.parse(draft);
  const state = new Map(review.map((item) => [item.domain, item.ownership]));
  const selected = clean.listings.filter(
    (item) => item.visibility !== 'private',
  );
  if (
    selected.some(
      (item) =>
        item.visibility !== 'historical' && state.get(item.domain) !== 'owned',
    )
  ) {
    throw new Error(
      'Resolve ownership or sync issues for selected domains before publishing. Previously owned names must be explicitly marked Historical.',
    );
  }
  if (
    selected.some((item) => item.visibility === 'inquiry') &&
    !clean.contactEmail
  ) {
    throw new Error('Add a public contact email before accepting inquiries.');
  }
  return {
    handle: clean.handle,
    title: clean.title,
    intro: clean.intro,
    contactEmail: clean.contactEmail,
    publishedAt: now,
    listings: selected.map((item) => ({
      domain: item.domain,
      collection: item.collection,
      description: item.description,
      visibility: item.visibility as 'showcase' | 'inquiry' | 'historical',
      askingPrice: item.visibility === 'inquiry' ? item.askingPrice : null,
      currency: item.currency,
    })),
  };
}
