import { describe, expect, it } from 'vitest';
import type { Domain, RegistrarMeta } from '../../shared/ipc';
import { STALE_AFTER_MS } from '../../shared/ipc';
import {
  canonicalDomain,
  draftSchema,
  emptyDraft,
  privateListing,
} from '../../shared/publication';
import { importPublication } from '../../shared/publication-import';
import { publicSnapshot, reconcilePortfolio } from './reconcile';

const now = 1_800_000_000_000;
const account: RegistrarMeta = {
  name: 'dynadot',
  accountId: 'dynadot',
  displayName: 'Dynadot',
  accountLabel: 'Main',
  configured: true,
  enabled: true,
  saved: true,
  supportsSandbox: false,
  configFields: [],
  features: [],
  sync: { lastSyncedAt: now - 1000, lastError: null, domainCount: 1 },
};
const owned = {
  domainName: 'Example.COM',
  registrar: 'dynadot',
  accountId: 'dynadot',
} as Domain;

describe('portfolio reconciliation and public projection', () => {
  it('new inventory is private and matches names canonically', () => {
    const result = reconcilePortfolio(emptyDraft(), [owned], [account], now);
    expect(result).toMatchObject([
      { domain: 'example.com', visibility: 'private', ownership: 'owned' },
    ]);
    expect(canonicalDomain('BÜCHER.de.')).toBe('xn--bcher-kva.de');
  });
  it('does not infer sold or expired from absent, stale, disabled or failed accounts', () => {
    const draft = {
      ...emptyDraft(),
      listings: [privateListing('example.com'), privateListing('absent.com')],
    };
    expect(
      reconcilePortfolio(draft, [owned], [account], now).find(
        (r) => r.domain === 'absent.com',
      ),
    ).toMatchObject({ ownership: 'unmatched', visibility: 'private' });
    for (const a of [
      { ...account, enabled: false },
      { ...account, configured: false },
      { ...account, sync: { ...account.sync, lastError: 'timeout' } },
      {
        ...account,
        sync: { ...account.sync, lastSyncedAt: now - STALE_AFTER_MS },
      },
    ])
      expect(
        reconcilePortfolio(draft, [owned], [a], now).find(
          (r) => r.domain === 'example.com',
        )?.ownership,
      ).toBe('stale');
  });
  it('requires review for the same name in more than one registrar account', () => {
    expect(
      reconcilePortfolio(
        emptyDraft(),
        [owned, { ...owned, accountId: 'other' }],
        [account],
        now,
      )[0].ownership,
    ).toBe('conflict');
  });
  it('publishes only selected fields and never exposes private domains or renewal costs', () => {
    const draft = {
      ...emptyDraft(),
      listings: [
        {
          ...privateListing('example.com'),
          visibility: 'showcase' as const,
          askingPrice: 100,
        },
        privateListing('secret.com'),
      ],
    };
    const snapshot = publicSnapshot(
      draft,
      reconcilePortfolio(draft, [owned], [account], now),
      now,
    );
    expect(snapshot.listings).toEqual([
      {
        domain: 'example.com',
        collection: '',
        description: '',
        visibility: 'showcase',
        askingPrice: null,
        currency: 'USD',
      },
    ]);
    expect(JSON.stringify(snapshot)).not.toMatch(
      /secret.com|accountId|registrar|lastSyncedAt|renewal/,
    );
    expect(
      draftSchema.safeParse({ ...draft, credentials: 'secret' }).success,
    ).toBe(false);
    expect(
      draftSchema.safeParse({
        ...draft,
        listings: [{ ...draft.listings[0], renewal: 15 }],
      }).success,
    ).toBe(false);
  });
  it('blocks unverified active listings but allows explicit historical display without an inquiry', () => {
    const draft = {
      ...emptyDraft(),
      listings: [
        { ...privateListing('old.com'), visibility: 'inquiry' as const },
      ],
    };
    expect(() =>
      publicSnapshot(draft, reconcilePortfolio(draft, [], [], now), now),
    ).toThrow(/ownership/);
    const historical = {
      ...draft,
      listings: [
        {
          ...draft.listings[0],
          visibility: 'historical' as const,
          askingPrice: 100,
        },
      ],
    };
    expect(
      publicSnapshot(
        historical,
        reconcilePortfolio(historical, [], [], now),
        now,
      ).listings[0],
    ).toMatchObject({ visibility: 'historical', askingPrice: null });
  });
  it('requires a valid public email for inquiry listings', () => {
    const draft = {
      ...emptyDraft(),
      listings: [
        { ...privateListing('example.com'), visibility: 'inquiry' as const },
      ],
    };
    expect(() =>
      publicSnapshot(
        draft,
        reconcilePortfolio(draft, [owned], [account], now),
        now,
      ),
    ).toThrow(/email/);
  });
});

describe('collection import', () => {
  it('preserves quoted CSV fields, canonicalizes duplicates, and makes every import private', () => {
    const result = importPublication(
      'domain,collection,description,askingPrice,currency\nEXAMPLE.com,"Short, memorable","A ""great"" name",200,USD\nexample.com,Again,,,',
      [],
    );
    expect(result.added).toBe(1);
    expect(result.duplicates).toBe(1);
    expect(result.listings[0]).toMatchObject({
      domain: 'example.com',
      collection: 'Short, memorable',
      description: 'A "great" name',
      visibility: 'private',
      askingPrice: 200,
    });
  });
  it('ignores incoming publication authorization and preserves existing edits', () => {
    const existing = [
      { ...privateListing('keep.com'), collection: 'Keep my edits' },
    ];
    const result = importPublication(
      JSON.stringify([
        { domain: 'keep.com', collection: 'Overwrite' },
        {
          domain: 'new.com',
          visibility: 'inquiry',
          privateNotes: 'do not copy',
        },
      ]),
      existing,
    );
    expect(result.listings[0].collection).toBe('Keep my edits');
    expect(result.listings[1]).toEqual(privateListing('new.com'));
  });
  it('rejects invalid rows atomically and rejects URLs and credentials as domains', () => {
    const existing = [privateListing('keep.com')];
    expect(() =>
      importPublication('good.com\nhttps://bad.com', existing),
    ).toThrow(/row 2/);
    expect(existing).toEqual([privateListing('keep.com')]);
    for (const input of [
      'user:password@name.com',
      'name.com/path',
      '*.name.com',
      'name.com?key=secret',
      'a..com',
    ])
      expect(() => canonicalDomain(input)).toThrow();
  });
  it('accepts tab-separated spreadsheet data and plain comma-separated names', () => {
    expect(
      importPublication('domain\tcollection\nexample.com\tShort names', [])
        .listings[0].collection,
    ).toBe('Short names');
    expect(importPublication('one.com, two.com\nthree.com', []).added).toBe(3);
  });
});
