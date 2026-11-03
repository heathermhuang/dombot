import { describe, expect, it } from 'vitest';
import { marketObservationRows } from './market-observation-rows';
import type { MarketListing } from './markets';
import { importedRow } from './imported-domains';
const offer = { publicObservedAt: 1000 } as MarketListing;
describe('derived marketplace-only rows', () => {
  it('labels an observation without importing it or granting registrar authority', () => {
    const listings = { 'working.io': [offer] };
    const [row] = marketObservationRows(listings, []);
    expect(row.marketObservation).toBe(true);
    expect(row.source).toBe('imported');
    expect(row.registrar).toBe('');
    expect(row.importedRegistrarLabel).toBe(
      'Marketplace observation · control unverified',
    );
    expect(row.syncedAt).toEqual(new Date(1000));
    expect(listings).toEqual({ 'working.io': [offer] });
  });
  it('retains existing registrar/import rows and excludes empty observations', () => {
    const existing = importedRow('working.io', {
      registrar: null,
      addedAt: 1,
      updatedAt: 1,
    });
    expect(
      marketObservationRows({ 'working.io': [offer], 'empty.io': [] }, [
        existing,
      ]),
    ).toEqual([]);
    expect(existing.marketObservation).toBeUndefined();
  });
});
