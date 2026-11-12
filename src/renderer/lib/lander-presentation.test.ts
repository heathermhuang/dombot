import { expect, it } from 'vitest';
import { landerDnsProgress } from '../../shared/lander-connection';
import {
  domainCount,
  landerItemLabel,
  landerJobLabel,
  landerRoutingChanges,
  savedLanderReview,
  landerReviewPath,
  landerReviewFromLocation,
} from './lander-presentation';
it('does not count an unknown submitted write as verified', () => {
  expect(landerDnsProgress(12)).toEqual({
    total: 12,
    tracked: 0,
    verified: 0,
    restored: 0,
  });
  expect(landerDnsProgress(12, { index: 8, state: 'intent' })).toEqual({
    total: 12,
    tracked: 9,
    verified: 8,
    restored: 0,
  });
  expect(landerDnsProgress(12, { index: 8, state: 'verified' }, -1)).toEqual({
    total: 12,
    tracked: 9,
    verified: 9,
    restored: 9,
  });
});
it('preserves the connection view through authentication in another tab without storing an action', () => {
  const place = {
    pathname: '/w/owner/',
    search: '?keep=yes',
    hash: '#/?q=fixture.example',
  };
  const view = { id: '11111111-1111-4111-8111-111111111111', cursor: -1 };
  const path = landerReviewPath(place, view);
  const url = new URL(path, 'https://domains.domains');
  expect(url.searchParams.get('keep')).toBe('yes');
  expect(new URLSearchParams(url.hash.split('?')[1]).get('q')).toBe(
    'fixture.example',
  );
  expect(landerReviewFromLocation(url)).toEqual(view);
  expect(landerReviewPath(url, null)).toBe(
    '/w/owner/?keep=yes#/?q=fixture.example',
  );
  expect(path).not.toMatch(/approve|restore|digest/);
  expect(
    landerReviewFromLocation({
      pathname: '/w/owner/',
      search: '?landerConnection=..%2Fother',
      hash: '',
    }),
  ).toBeNull();
});
it('calls a connection connected only after every domain is live', () => {
  expect(
    landerJobLabel({
      state: 'finished',
      total: 2,
      counts: [
        { state: 'live', count: 1 },
        { state: 'held', count: 1 },
      ],
    }),
  ).toBe('Needs attention');
  expect(
    landerJobLabel({
      state: 'finished',
      total: 1,
      counts: [{ state: 'live', count: 1 }],
    }),
  ).toBe('Connected');
  expect(landerJobLabel({ state: 'finished', total: 0, counts: [] })).toBe(
    'Finished',
  );
  expect(
    landerItemLabel({ state: 'restored', dnsProgress: landerDnsProgress(12) }),
  ).toBe('Connection removed');
  expect(domainCount(1)).toBe('1 domain');
});
it('restores only a read-only view identifier, never a saved approval or destination', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  expect(
    savedLanderReview(
      JSON.stringify({
        id,
        cursor: 3,
        approve: true,
        url: 'https://other.example',
      }),
    ),
  ).toEqual({ id, cursor: 3 });
  for (const value of [
    '{}',
    'broken',
    JSON.stringify({ id: '../other', cursor: 0 }),
  ])
    expect(savedLanderReview(value)).toBeNull();
});
it('shows a native delete/append pair as one complete routing comparison', () => {
  const before = {
    id: 'old',
    type: 'ANAME',
    name: 'fixture.example',
    content: 'park.example',
    ttl: 300,
  };
  const after = { ...before, content: 'origin.example' };
  expect(
    landerRoutingChanges([
      { before, after: null },
      { before: null, after },
    ]),
  ).toEqual([
    {
      name: 'fixture.example',
      before: 'ANAME park.example',
      after: 'ANAME origin.example',
    },
  ]);
});
