import { describe, expect, it } from 'vitest';
import { privateListing, emptyDraft } from './publication';
import type { Domain, RegistrarMeta } from './ipc';
import {
  buildDomainCatalog,
  withInventory,
  selectedRegistrarTargets,
  matchesRegistrarFilters,
  sortManagementRows,
} from './domain-catalog';
const record = (
  name: string,
  accountId = 'a',
  patch: Partial<Domain> = {},
): Domain => ({
  domainName: name,
  accountId,
  accountLabel: accountId,
  registrar: 'dynadot',
  status: 'active',
  createdDate: null,
  expirationDate: new Date('2030-01-01'),
  renewalDate: null,
  nameservers: [],
  locked: true,
  privacy: true,
  autoRenew: true,
  deleted: false,
  syncedAt: new Date(),
  ...patch,
});
const accounts = ['a', 'b'].map((accountId) => ({
  name: 'dynadot',
  accountId,
  configured: true,
  enabled: true,
})) as RegistrarMeta[];
const filters = {
  account: '',
  tld: '',
  expiry: '',
  folder: '',
  nameserver: '',
};
describe('one domain catalog with exact registrar targets', () => {
  it('adds newly synced names privately without overwriting editorial selections', () => {
    const listing = {
      ...privateListing('existing.example'),
      visibility: 'inquiry' as const,
      description: 'keep',
    };
    const draft = { ...emptyDraft(), listings: [listing] };
    const result = withInventory(draft, [
      record('existing.example'),
      record('NEW.EXAMPLE'),
    ]);
    expect(result.listings[0]).toEqual(listing);
    expect(result.listings[1]).toEqual(privateListing('new.example'));
    expect(JSON.stringify(result)).not.toContain('accountId');
    expect(draft.listings).toHaveLength(1);
  });
  it('has one catalog entry per name and requires an explicit account to resolve duplicates', () => {
    const listing = privateListing('shared.example'),
      a = record('shared.example', 'a'),
      b = record('shared.example', 'b');
    const all = buildDomainCatalog([listing], [a, b], accounts);
    expect(all.size).toBe(1);
    expect(all.get(listing.domain)?.target).toBeNull();
    expect(
      buildDomainCatalog([listing], [a, b], accounts, 'b').get(listing.domain)
        ?.target,
    ).toBe(b);
  });
  it('never exposes a registrar target for history, unmatched, deleted, or unavailable accounts', () => {
    const listings = [
      { ...privateListing('past.example'), visibility: 'historical' as const },
      privateListing('missing.example'),
      privateListing('deleted.example'),
      privateListing('disabled.example'),
    ];
    const rows = [
      record('past.example'),
      record('deleted.example', 'a', { deleted: true }),
      record('disabled.example', 'b'),
    ];
    const metadata = accounts.map((a) =>
      a.accountId === 'b' ? { ...a, enabled: false } : a,
    );
    for (const entry of buildDomainCatalog(listings, rows, metadata).values())
      expect(entry.target).toBeNull();
  });
  it('fails closed for the entire mixed registrar selection rather than silently acting on a subset', () => {
    const listings = [
      privateListing('owned.example'),
      privateListing('unmatched.example'),
    ];
    const catalog = buildDomainCatalog(
      listings,
      [record('owned.example')],
      accounts,
    );
    expect(
      selectedRegistrarTargets(
        catalog,
        new Set(['owned.example', 'unmatched.example']),
      ),
    ).toEqual({ targets: [], blocked: 1 });
    expect(
      selectedRegistrarTargets(catalog, new Set(['owned.example'])).targets[0]
        .accountId,
    ).toBe('a');
  });
  it('applies expiration, folder and DNS filters within the explicitly selected account', () => {
    const name = 'shared.example';
    const a = record(name, 'a', {
        expirationDate: new Date('2030-01-01'),
        nameservers: ['a.example'],
      }),
      b = record(name, 'b', {
        expirationDate: new Date('2026-09-20'),
        nameservers: ['b.example'],
      });
    const entry = buildDomainCatalog(
      [privateListing(name)],
      [a, b],
      accounts,
      'a',
    ).get(name)!;
    const now = Date.parse('2026-09-10');
    const folders = { 'a:shared.example': 'one', 'b:shared.example': 'two' };
    expect(
      matchesRegistrarFilters(
        entry,
        { ...filters, account: 'a', expiry: '30' },
        folders,
        new Set(['one', 'two']),
        'hidden',
        now,
      ),
    ).toBe(false);
    expect(
      matchesRegistrarFilters(
        entry,
        { ...filters, account: 'a', folder: 'two' },
        folders,
        new Set(['one', 'two']),
        'hidden',
        now,
      ),
    ).toBe(false);
    expect(
      matchesRegistrarFilters(
        entry,
        { ...filters, account: 'a', nameserver: 'b.example' },
        folders,
        new Set(['one', 'two']),
        'hidden',
        now,
      ),
    ).toBe(false);
  });
  it('keeps unknown dates and renewal prices last and uses the exact account key', () => {
    const listings = ['later.example', 'soon.example', 'unknown.example'].map(
      privateListing,
    );
    const catalog = buildDomainCatalog(
      listings,
      [
        record('later.example'),
        record('soon.example', 'b', { expirationDate: new Date('2027-01-01') }),
      ],
      accounts,
    );
    expect(
      sortManagementRows(listings, catalog, {}, 'expiry').map((i) => i.domain),
    ).toEqual(['soon.example', 'later.example', 'unknown.example']);
    expect(
      sortManagementRows(
        listings,
        catalog,
        {
          'b:soon.example': { renewal: 100 },
          'a:later.example': { renewal: 5 },
        },
        'renewal',
      ).map((i) => i.domain),
    ).toEqual(['soon.example', 'later.example', 'unknown.example']);
  });
});
