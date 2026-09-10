import { beforeEach, describe, expect, it } from 'vitest';
import { useDomainList } from './domain-list';
const initial = useDomainList.getState();
beforeEach(() =>
  useDomainList.setState({ ...initial, picked: new Set() }, true),
);
describe('shared Manage/Publish context', () => {
  it('preserves filters, search, page and selection when changing columns', () => {
    useDomainList
      .getState()
      .setFilters({
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
