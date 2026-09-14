import { beforeEach, describe, expect, it } from 'vitest';
import { useDomainList } from './domain-list';
const initial = useDomainList.getState();
beforeEach(() =>
  useDomainList.setState({ ...initial, picked: new Set() }, true),
);
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
