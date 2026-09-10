import { describe, expect, it } from 'vitest';
import {
  emptyDraft,
  privateListing,
  type ReconciledListing,
} from './publication';
import {
  editPortfolioSelection,
  filterPortfolio,
} from './portfolio-management';
const draft = {
  ...emptyDraft(),
  listings: [
    {
      ...privateListing('alpha.example'),
      visibility: 'inquiry' as const,
      askingPrice: 4500,
      collection: 'AI; Short',
      description: 'Keep my description',
    },
    {
      ...privateListing('beta.example'),
      visibility: 'showcase' as const,
      askingPrice: 120,
      collection: 'Brands',
    },
    privateListing('private.example'),
    { ...privateListing('past.example'), visibility: 'historical' as const },
    privateListing('unmatched.example'),
  ],
};
const review: ReconciledListing[] = draft.listings.map((item) => ({
  ...item,
  ownership: ['past.example', 'unmatched.example'].includes(item.domain)
    ? 'unmatched'
    : 'owned',
  accountLabels: [],
  lastSyncedAt: 1,
}));
const defaults = {
  scope: 'all' as const,
  ownership: 'all' as const,
  query: '',
  collection: '',
  sort: 'az',
};
describe('portfolio management at bulk scale', () => {
  it('updates all selected rows once without overwriting other rows or public metadata', () => {
    const result = editPortfolioSelection(
      draft,
      new Set(['alpha.example', 'beta.example']),
      { kind: 'visibility', value: 'private' },
    );
    expect(
      result.listings
        .slice(0, 2)
        .every((item) => item.visibility === 'private'),
    ).toBe(true);
    expect(result.listings[0].description).toBe('Keep my description');
    expect(result.listings[0].askingPrice).toBe(4500);
    expect(result.listings.slice(2)).toEqual(draft.listings.slice(2));
    expect(draft.listings[0].visibility).toBe('inquiry');
  });
  it('adds collections without erasing mixed existing values or duplicating case variants', () => {
    const result = editPortfolioSelection(
      draft,
      new Set(['alpha.example', 'beta.example']),
      { kind: 'collection', mode: 'add', value: 'ai; Featured' },
    );
    expect(result.listings[0].collection).toBe('AI; Short; Featured');
    expect(result.listings[1].collection).toBe('Brands; ai; Featured');
  });
  it('removes and replaces collections only when explicitly chosen', () => {
    expect(
      editPortfolioSelection(draft, new Set(['alpha.example']), {
        kind: 'collection',
        mode: 'remove',
        value: 'AI',
      }).listings[0].collection,
    ).toBe('Short');
    expect(
      editPortfolioSelection(draft, new Set(['alpha.example']), {
        kind: 'collection',
        mode: 'replace',
        value: 'New',
      }).listings[0].collection,
    ).toBe('New');
  });
  it('rejects invalid bulk edits atomically instead of applying a partial change', () => {
    expect(() =>
      editPortfolioSelection(
        draft,
        new Set(['alpha.example', 'missing.example']),
        { kind: 'visibility', value: 'private' },
      ),
    ).toThrow('no longer');
    expect(() =>
      editPortfolioSelection(draft, new Set(['alpha.example']), {
        kind: 'collection',
        mode: 'replace',
        value: '',
      }),
    ).toThrow('collection name');
    expect(() =>
      editPortfolioSelection(draft, new Set(['alpha.example']), {
        kind: 'collection',
        mode: 'add',
        value: 'x'.repeat(200),
      }),
    ).toThrow('too long');
    expect(draft.listings[0].collection).toBe('AI; Short');
  });
  it('never reactivates historical names or asserts history for current listings in bulk', () => {
    expect(() =>
      editPortfolioSelection(
        draft,
        new Set(['alpha.example', 'past.example']),
        { kind: 'visibility', value: 'inquiry' },
      ),
    ).toThrow('Historical');
    expect(() =>
      editPortfolioSelection(draft, new Set(['alpha.example']), {
        kind: 'visibility',
        value: 'historical',
      }),
    ).toThrow('Only unlisted');
    expect(
      editPortfolioSelection(draft, new Set(['unmatched.example']), {
        kind: 'visibility',
        value: 'historical',
      }).listings[4].visibility,
    ).toBe('historical');
  });
  it('separates private unmatched candidates from publication blockers and historical assertions', () => {
    expect(
      filterPortfolio(draft.listings, review, {
        ...defaults,
        ownership: 'blocking',
      }),
    ).toEqual([]);
    expect(
      filterPortfolio(draft.listings, review, {
        ...defaults,
        ownership: 'attention',
      }).map((i) => i.domain),
    ).toEqual(['unmatched.example']);
    const stale = review.map((i) =>
      i.domain === 'alpha.example' ? { ...i, ownership: 'stale' as const } : i,
    );
    expect(
      filterPortfolio(draft.listings, stale, {
        ...defaults,
        ownership: 'blocking',
      }).map((i) => i.domain),
    ).toEqual(['alpha.example']);
  });
  it('combines scope, exact collection tokens, search and sorting', () => {
    expect(
      filterPortfolio(draft.listings, review, {
        ...defaults,
        scope: 'listed',
        collection: 'AI',
        query: 'ALPHA',
      }).map((i) => i.domain),
    ).toEqual(['alpha.example']);
    expect(
      filterPortfolio(draft.listings, review, {
        ...defaults,
        scope: 'private',
        ownership: 'owned',
      }).map((i) => i.domain),
    ).toEqual(['private.example']);
    expect(
      filterPortfolio(draft.listings, review, {
        ...defaults,
        scope: 'listed',
        sort: 'price',
      }).map((i) => i.domain),
    ).toEqual(['alpha.example', 'beta.example']);
  });
  it('inquiry actions cannot implicitly include private domains from a mixed selection', () => {
    expect(() =>
      editPortfolioSelection(
        draft,
        new Set(['alpha.example', 'private.example']),
        { kind: 'inquiries', value: 'showcase' },
      ),
    ).toThrow('only to current');
    expect(draft.listings[2].visibility).toBe('private');
    expect(
      editPortfolioSelection(
        draft,
        new Set(['alpha.example', 'beta.example']),
        { kind: 'inquiries', value: 'showcase' },
      )
        .listings.slice(0, 2)
        .every((i) => i.visibility === 'showcase'),
    ).toBe(true);
  });
  it('groups prices by currency rather than pretending different currencies are comparable', () => {
    const items = [
      { ...privateListing('usd.example'), currency: 'USD', askingPrice: 200 },
      { ...privateListing('hkd.example'), currency: 'HKD', askingPrice: 1000 },
      {
        ...privateListing('usd-high.example'),
        currency: 'USD',
        askingPrice: 500,
      },
      privateListing('on-request.example'),
    ];
    expect(
      filterPortfolio(items, [], { ...defaults, sort: 'price' }).map(
        (i) => i.domain,
      ),
    ).toEqual([
      'hkd.example',
      'usd-high.example',
      'usd.example',
      'on-request.example',
    ]);
  });
});
