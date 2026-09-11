import { describe, expect, it } from 'vitest';
import { privateListing, emptyDraft } from './publication';
import {
  pageMembership,
  pageMembershipLabel,
  matchesPageScope,
} from './page-membership';
import { editPortfolioSelection } from './portfolio-management';
describe('clear public-page membership states', () => {
  const unlisted = privateListing('name.example');
  const listed = { ...unlisted, visibility: 'inquiry' as const };
  it('never calls a draft addition live or a pending removal already removed', () => {
    expect(pageMembership(listed, undefined)).toBe('adding');
    expect(pageMembership(unlisted, listed)).toBe('removing');
    expect(pageMembershipLabel.adding).toContain('Draft');
    expect(pageMembershipLabel.removing).toContain('Live');
  });
  it('distinguishes untouched live names, edits and names absent from the public page', () => {
    expect(pageMembership(listed, listed)).toBe('live');
    expect(pageMembership(listed, listed, true)).toBe('editing');
    expect(pageMembership(unlisted, undefined)).toBe('absent');
  });
  it('adds a mixed selection without resetting existing inquiries or history', () => {
    const history = {
      ...privateListing('past.example'),
      visibility: 'historical' as const,
    };
    const draft = {
      ...emptyDraft(),
      listings: [
        unlisted,
        { ...listed, domain: 'live.example', askingPrice: 500 },
        history,
      ],
    };
    const next = editPortfolioSelection(
      draft,
      new Set(['name.example', 'live.example', 'past.example']),
      { kind: 'include' },
    );
    expect(next.listings[0].visibility).toBe('showcase');
    expect(next.listings[1]).toEqual(draft.listings[1]);
    expect(next.listings[2]).toEqual(history);
    expect(draft.listings[0].visibility).toBe('private');
  });
  it('keeps pending additions and removals in the page list rather than the not-added list', () => {
    expect(matchesPageScope(listed, undefined, 'listed')).toBe(true);
    expect(matchesPageScope(unlisted, listed, 'listed')).toBe(true);
    expect(matchesPageScope(unlisted, listed, 'private')).toBe(false);
    expect(matchesPageScope(unlisted, undefined, 'private')).toBe(true);
  });
});
