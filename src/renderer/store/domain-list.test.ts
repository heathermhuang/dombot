import { beforeEach, describe, expect, it } from 'vitest';
import { useDomainList } from './domain-list';
import { usePreferences, DEFAULT_PREFERENCES } from '../lib/preferences';
const initial = useDomainList.getState();
beforeEach(() => {
  usePreferences.setState(DEFAULT_PREFERENCES);
  useDomainList.setState({ ...initial, picked: new Set() }, true);
});
describe('shared Manage/Publish context', () => {
  it('preserves filters, search, page and selection when changing columns', () => {
    useDomainList.getState().setFilters({
      query: 'example',
      scope: 'private',
      collection: 'AI',
      account: 'account-b',
    });
    useDomainList.getState().setPage(3);
    useDomainList.getState().setPicked(new Set(['one.example', 'two.example']));
    useDomainList.getState().setMode('publish');
    expect(useDomainList.getState()).toMatchObject({
      mode: 'publish',
      query: 'example',
      scope: 'private',
      collection: 'AI',
      account: 'account-b',
      page: 3,
    });
    expect([...useDomainList.getState().picked]).toEqual([
      'one.example',
      'two.example',
    ]);
    useDomainList.getState().setMode('manage');
    expect(useDomainList.getState().picked.size).toBe(2);
  });
  it('clears selection when changing account scope so targets cannot silently switch accounts', () => {
    useDomainList.getState().setPicked(new Set(['shared.example']));
    useDomainList.getState().setFilters({ account: 'b' });
    expect(useDomainList.getState().picked.size).toBe(0);
    expect(useDomainList.getState().page).toBe(1);
  });
});

it('explicit Add and Manage tasks clear incompatible filters and selection', () => {
  const list = useDomainList.getState();
  list.setFilters({
    scope: 'listed',
    ownership: 'blocking',
    account: 'stale',
    query: 'old',
    collection: 'Old',
    tld: 'io',
    expiry: 'soon',
    folder: 'private',
    nameserver: 'dns.example',
  });
  list.setPicked(new Set(['old.example']));
  list.startTask('private');
  expect(useDomainList.getState()).toMatchObject({
    scope: 'private',
    mode: 'publish',
    ownership: 'all',
    account: '',
    query: '',
    collection: '',
    tld: '',
    expiry: '',
    folder: '',
    nameserver: '',
    page: 1,
  });
  expect(useDomainList.getState().picked.size).toBe(0);
  list.startTask('listed');
  expect(useDomainList.getState().scope).toBe('listed');
});

it('applies hosted table preferences without losing the active filter context', () => {
  const list = useDomainList.getState();
  list.setFilters({ query: 'example', account: 'account-b', sort: 'price' });
  list.setPage(4);
  list.setPicked(new Set(['one.example']));
  usePreferences.getState().setPreferences({ density: 'compact' });
  expect(useDomainList.getState()).toMatchObject({ sort: 'price', page: 4 });
  expect(useDomainList.getState().picked.size).toBe(1);
  usePreferences
    .getState()
    .setPreferences({
      sortKey: 'expirationDate',
      sortDir: 'desc',
      pageSize: 25,
    });
  expect(useDomainList.getState()).toMatchObject({
    query: 'example',
    account: 'account-b',
    sort: 'expiry-desc',
    page: 1,
  });
  expect(useDomainList.getState().picked.size).toBe(0);
  list.startTask('registered');
  expect(useDomainList.getState().sort).toBe('expiry-desc');
});
