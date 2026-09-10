import { create } from 'zustand';
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
  sort: 'az',
  account: '',
  tld: '',
  expiry: '',
  folder: '',
  nameserver: '',
  page: 1,
  picked: new Set(),
  setMode: (mode) => set({ mode }),
  setFilters: (patch) => set({ ...patch, page: 1, picked: new Set() }),
  setPage: (page) => set({ page }),
  setPicked: (picked) => set({ picked }),
}));
