import type { Domain } from './ipc';
import type { MarketListing } from './markets';
import { toAscii } from './domain-name';
import { importedRow } from './imported-domains';

/** Derived table rows only: no import, saved holding, or control grant. Keep
 * registrar actions disabled through the existing unverified-row boundary. */
export function marketObservationRows(
  listings: Record<string, MarketListing[]>,
  existing: readonly Domain[],
): Domain[] {
  const present = new Set(existing.map((domain) => toAscii(domain.domainName)));
  return Object.entries(listings)
    .filter(
      ([name, offers]) => offers.length > 0 && !present.has(toAscii(name)),
    )
    .map(([name, offers]) => ({
      ...importedRow(name, {
        addedAt: Math.min(
          ...offers.map((offer) => offer.publicObservedAt ?? 0),
        ),
        updatedAt: Math.max(
          ...offers.map((offer) => offer.publicObservedAt ?? 0),
        ),
        registrar: null,
        registrarLabel: 'Marketplace observation · control unverified',
      }),
      marketObservation: true,
    }));
}
