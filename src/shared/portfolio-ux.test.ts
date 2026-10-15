import { describe, expect, it } from 'vitest';
import {
  emptyDraft,
  privateListing,
  type PublicationState,
} from './publication';
import {
  editableDraft,
  previewSnapshot,
  publicationChanges,
  revertListing,
} from './publication-edit';
import { publicSnapshot } from '../core/publication/reconcile';
import { portfolioIssues, validDraftEdits } from './portfolio-validation';
import { renderPortfolio } from './render-portfolio';

const draft = {
  ...emptyDraft(),
  contactEmail: 'owner@example.com',
  listings: ['z.example', 'a.example'].map((domain) => ({
    ...privateListing(domain),
    visibility: 'inquiry' as const,
    askingPrice: 500,
  })),
};
const review = draft.listings.map((item) => ({
  ...item,
  ownership: 'owned' as const,
  accountLabels: ['Test'],
  lastSyncedAt: Date.now(),
}));
describe('portfolio UX contracts', () => {
  it('retains saved order despite alphabetic verification and adds discoveries privately', () => {
    const state: PublicationState = {
      draft,
      review: [
        ...[...review].reverse(),
        {
          ...privateListing('new.example'),
          ownership: 'owned',
          accountLabels: [],
          lastSyncedAt: Date.now(),
        },
      ],
      revision: 'r1',
      published: null,
      publishedSnapshot: null,
      accounts: [],
    };
    const editable = editableDraft(state);
    expect(editable.listings.map((item) => item.domain)).toEqual([
      'z.example',
      'a.example',
      'new.example',
    ]);
    const live = publicSnapshot(draft, review, 100);
    expect(previewSnapshot(editable).listings).toEqual(live.listings);
    expect(publicationChanges(editable, live).count).toBe(0);
  });
  it('reverts additions, removals and edits individually without losing unrelated work', () => {
    const live = previewSnapshot(draft);
    const changed = {
      ...draft,
      title: 'Keep this title',
      listings: [
        { ...draft.listings[0], description: 'Edited' },
        { ...draft.listings[1], visibility: 'private' as const },
        { ...privateListing('new.example'), visibility: 'showcase' as const },
      ],
    };
    const first = revertListing(changed, live, 'z.example');
    expect(first.listings[0]).toEqual(live.listings[0]);
    expect(first.title).toBe('Keep this title');
    const second = revertListing(first, live, 'a.example');
    expect(second.listings[1].visibility).toBe('inquiry');
    expect(
      revertListing(second, live, 'new.example').listings[2].visibility,
    ).toBe('private');
  });
  it('keeps valid independent edits and describes invalid fields by domain', () => {
    const invalid = {
      ...draft,
      title: 'Saved title',
      handle: 'bad handle',
      listings: [
        {
          ...draft.listings[0],
          askingPrice: -1,
          description: 'Valid description',
        },
        draft.listings[1],
      ],
    };
    const safe = validDraftEdits(invalid, draft);
    expect(safe).toMatchObject({ title: 'Saved title', handle: draft.handle });
    expect(safe.listings[0]).toMatchObject({
      askingPrice: 500,
      description: 'Valid description',
    });
    expect(invalid.listings[0].askingPrice).toBe(-1);
    expect(portfolioIssues(invalid)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ domain: 'z.example', field: 'askingPrice' }),
        expect.objectContaining({ field: 'handle' }),
      ]),
    );
  });
  it('keeps preview contact inert, supports browsing and exposes live email fallback', () => {
    const snapshot = previewSnapshot(draft);
    const preview = renderPortfolio(
      snapshot,
      new URL('https://test/p/portfolio'),
      true,
      true,
    );
    expect(preview).not.toContain('mailto:');
    expect(preview).not.toContain('<script');
    expect(preview).toContain('<button type="button">Apply</button>');
    expect(preview).toContain('Inquire · disabled in draft');
    const live = renderPortfolio(snapshot, new URL('https://test/p/portfolio'));
    expect(live).toContain('USD 500');
    expect(live).toContain('>Inquire ');
    expect(live).toContain('readonly value="owner@example.com"');
    expect(live).not.toContain('<script>');
  });
  it('resets search on history navigation, supports sorting, and explains empty filters', () => {
    const snapshot = previewSnapshot({
      ...draft,
      listings: [
        ...draft.listings,
        { ...privateListing('past.example'), visibility: 'historical' },
      ],
    });
    const current = renderPortfolio(
      snapshot,
      new URL('https://test/p/portfolio?q=z'),
    );
    expect(current).toContain('href="?view=history"');
    const empty = renderPortfolio(
      snapshot,
      new URL('https://test/p/portfolio?view=history&q=mobile'),
    );
    expect(empty).toContain('0 of 1 previously owned names');
    expect(empty).toContain('Clear filters');
    expect(empty).not.toContain('mailto:');
    const sorted = renderPortfolio(
      snapshot,
      new URL('https://test/p/portfolio?sort=az'),
    );
    expect(sorted.indexOf('<h2>a.example')).toBeLessThan(
      sorted.indexOf('<h2>z.example'),
    );
  });
});

it('reverting a display-only change preserves the hidden asking price and restores missing rows', () => {
  const display = {
    ...draft,
    listings: [{ ...draft.listings[0], visibility: 'showcase' as const }],
  };
  const live = previewSnapshot(display);
  const edited = {
    ...display,
    listings: [
      { ...display.listings[0], description: 'Changed', askingPrice: 800 },
    ],
  };
  expect(revertListing(edited, live, 'z.example').listings[0]).toMatchObject({
    description: '',
    askingPrice: 800,
  });
  expect(
    revertListing({ ...display, listings: [] }, live, 'z.example').listings[0]
      .domain,
  ).toBe('z.example');
});
it('default rendered order is identical even for previously saved snapshots with different array order', () => {
  const first = renderPortfolio(
    previewSnapshot(draft),
    new URL('https://test/p/portfolio'),
    true,
  );
  const second = renderPortfolio(
    previewSnapshot({ ...draft, listings: [...draft.listings].reverse() }),
    new URL('https://test/p/portfolio'),
  );
  const names = (html: string) =>
    [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map((match) => match[1]);
  expect(names(first)).toEqual(names(second));
  expect(first.indexOf('<h2>a.example')).toBeLessThan(
    first.indexOf('<h2>z.example'),
  );
});
