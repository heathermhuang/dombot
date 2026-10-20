import { describe, expect, it } from 'vitest';
import { privateListing, emptyDraft } from './publication';
import {
  pageMembership,
  pageMembershipLabel,
  matchesPageScope,
} from './page-membership';
import { editPortfolioSelection } from './portfolio-management';
import { importPublication } from './publication-import';
import { buildDomainCatalog, selectedRegistrarTargets } from './domain-catalog';
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
  it('keeps a new account collection import visible without claiming inventory or registrar authority', () => {
    const imported = importPublication(
      'conference-sample.example\nplatform-sample.example',
      [],
    );
    const catalog = buildDomainCatalog(imported.listings, [], []);
    const visible = imported.listings.filter((item) =>
      matchesPageScope(
        item,
        undefined,
        'private',
        !!catalog.get(item.domain)?.records.length,
      ),
    );
    expect(visible.map((item) => item.domain)).toEqual([
      'conference-sample.example',
      'platform-sample.example',
    ]);
    expect(
      imported.listings.every((item) => item.visibility === 'private'),
    ).toBe(true);
    expect(
      imported.listings.filter((item) =>
        matchesPageScope(
          item,
          undefined,
          'registered',
          !!catalog.get(item.domain)?.records.length,
        ),
      ),
    ).toEqual([]);
    expect(
      selectedRegistrarTargets(
        catalog,
        new Set(visible.map((item) => item.domain)),
      ),
    ).toEqual({ targets: [], blocked: 2 });
  });
});
