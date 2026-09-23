import { create } from 'zustand';
import { usePreferences, workspaceSort } from '../lib/preferences';
import type {
  OwnershipFilter,
  PortfolioScope,
} from '../../shared/portfolio-management';
export type DomainScope = PortfolioScope | 'registered';
export interface DomainListFilters {
  scope: DomainScope;
  ownership: OwnershipFilter;
  query: string;
  collection: string;
  sort: string;
  account: string;
  tld: string;
  expiry: string;
  folder: string;
  nameserver: string;
}
interface DomainListState extends DomainListFilters {
  mode: 'manage' | 'publish';
  page: number;
  picked: Set<string>;
  startTask: (scope: DomainScope, ownership?: OwnershipFilter) => void;
  setMode: (mode: 'manage' | 'publish') => void;
  setFilters: (patch: Partial<DomainListFilters>) => void;
  setPage: (page: number) => void;
  setPicked: (selection: Set<string>) => void;
}
/** One catalog selection/search survives mode changes and Public page visits. */
export const useDomainList = create<DomainListState>((set) => ({
  mode: 'manage',
  scope: 'registered',
  ownership: 'all',
  query: '',
  collection: '',
  sort: workspaceSort(usePreferences.getState()),
  account: '',
  tld: '',
  expiry: '',
  folder: '',
  nameserver: '',
  page: 1,
  picked: new Set(),
  startTask: (scope, ownership = 'all') =>
    set({
      scope,
      ownership,
      mode: scope === 'registered' ? 'manage' : 'publish',
      query: '',
      collection: '',
      sort: workspaceSort(usePreferences.getState()),
      account: '',
      tld: '',
      expiry: '',
      folder: '',
      nameserver: '',
      page: 1,
      picked: new Set(),
    }),
  setMode: (mode) => set({ mode }),
  setFilters: (patch) => set({ ...patch, page: 1, picked: new Set() }),
  setPage: (page) => set({ page }),
  setPicked: (picked) => set({ picked }),
}));

// Preferences change the next inventory view while ordinary navigation keeps
// the user's current filters, sort and selection intact.
const unsubscribePreferences = usePreferences.subscribe((next, previous) => {
  if (next.sortKey !== previous.sortKey || next.sortDir !== previous.sortDir)
    useDomainList.getState().setFilters({ sort: workspaceSort(next) });
  if (next.pageSize !== previous.pageSize) {
    useDomainList.getState().setPage(1);
    useDomainList.getState().setPicked(new Set());
  }
});
if (import.meta.hot) import.meta.hot.dispose(unsubscribePreferences);
