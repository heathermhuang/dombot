import { describe, expect, it } from 'vitest';
import { emptyDraft, privateListing } from './publication';
import {
  includeDomains,
  previewSnapshot,
  publicationChanges,
} from './publication-edit';
import { renderPortfolio } from './render-portfolio';

const draft = {
  ...emptyDraft(),
  listings: [
    privateListing('private.example'),
    {
      ...privateListing('owned.example'),
      visibility: 'inquiry' as const,
      askingPrice: 500,
      description: 'Keep this description',
    },
    {
      ...privateListing('past.example'),
      visibility: 'historical' as const,
      collection: 'Previously Collected',
    },
  ],
};
describe('portfolio editing', () => {
  it('includes selected private domains without resetting existing public and historical edits', () => {
    const next = includeDomains(draft, [
      'PRIVATE.EXAMPLE.',
      'private.example',
      'owned.example',
      'past.example',
    ]);
    expect(next.listings[0].visibility).toBe('showcase');
    expect(next.listings.slice(1)).toEqual(draft.listings.slice(1));
    expect(draft.listings[0].visibility).toBe('private');
    expect(() => includeDomains(draft, ['unknown.example'])).toThrow(
      'no longer',
    );
  });
  it('ignores changes to private fields and hidden asking prices in the publication diff', () => {
    const first = {
      ...draft,
      listings: draft.listings.map((item) => ({
        ...item,
        visibility:
          item.visibility === 'inquiry'
            ? ('showcase' as const)
            : item.visibility,
      })),
    };
    const live = previewSnapshot(first);
    const next = {
      ...first,
      listings: first.listings.map((item) => ({ ...item, askingPrice: 999 })),
    };
    expect(publicationChanges(next, live).count).toBe(0);
    const actual = includeDomains(next, ['private.example']);
    expect(
      publicationChanges(actual, live).added.map((item) => item.domain),
    ).toEqual(['private.example']);
  });
  it('reports removals, inquiry changes and page metadata against the actual live snapshot', () => {
    const live = previewSnapshot(draft);
    const next = {
      ...draft,
      title: 'New title',
      listings: [
        draft.listings[0],
        { ...draft.listings[1], visibility: 'showcase' as const },
      ],
    };
    const change = publicationChanges(next, live);
    expect(change.removed.map((item) => item.domain)).toEqual(['past.example']);
    expect(change.edited.map((item) => item.domain)).toEqual(['owned.example']);
    expect(change.page).toEqual(['title']);
  });
  it('never copies inventory metadata into the preview projection', () => {
    const contaminated = {
      ...draft,
      apiKey: 'secret',
      listings: draft.listings.map((item) => ({
        ...item,
        accountId: 'private-account',
        renewalCost: 30,
      })),
    };
    const json = JSON.stringify(previewSnapshot(contaminated));
    for (const hidden of [
      'private.example',
      'apiKey',
      'private-account',
      'renewalCost',
    ])
      expect(json).not.toContain(hidden);
  });
  it('separates historical listings from the default public view, retaining old category links', () => {
    const snapshot = previewSnapshot(draft);
    const current = renderPortfolio(
      snapshot,
      new URL('https://example.com/p/portfolio'),
    );
    expect(current).toContain('<h2>owned.example</h2>');
    expect(current).not.toContain('<h2>past.example</h2>');
    expect(current).toContain('Previously owned (1)');
    const history = renderPortfolio(
      snapshot,
      new URL('https://example.com/p/portfolio?view=history'),
    );
    expect(history).toContain('<h2>past.example</h2>');
    expect(history).not.toContain('mailto:');
    expect(history).not.toContain('<h2>owned.example</h2>');
    expect(
      renderPortfolio(
        snapshot,
        new URL(
          'https://example.com/p/portfolio?collection=Previously%20Collected',
        ),
      ),
    ).toContain('<h2>past.example</h2>');
  });
});
