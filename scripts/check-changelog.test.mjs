import { describe, expect, it } from 'vitest';
import { checkChangelogChange } from './check-changelog.mjs';
import { parseChangelogFeed } from '../src/hosted/changelog-schema';
import feed from '../site/public/changelog.json';
const base = parseChangelogFeed(feed);
const added = { ...base[0], id: 'new-saas-note' };

describe('changelog release coverage', () => {
  it.each([
    'src/hosted/gateway.ts',
    'src/renderer/App.tsx',
    'src/core/api.ts',
    'package-lock.json',
    'hosted/wrangler.gateway.jsonc',
    'hosted/migrations/0024.sql',
  ])('fails a behavior change without a new SaaS note: %s', (file) => {
    expect(() => checkChangelogChange(base, base, [file])).toThrow(
      'new SaaS entry',
    );
    expect(() =>
      checkChangelogChange(base, [added, ...base], [file]),
    ).not.toThrow();
  });
  it('does not let editing an old note hide an undocumented code change', () => {
    expect(() =>
      checkChangelogChange(
        base,
        [{ ...base[0], title: 'edited' }, ...base.slice(1)],
        ['src/hosted/gateway.ts'],
      ),
    ).toThrow('new SaaS entry');
  });
  it('does not require release notes for tests or ordinary documentation', () => {
    expect(() =>
      checkChangelogChange(base, base, [
        'src/hosted/changelog.test.ts',
        'src/hosted/test-fixtures/test.ts',
        'docs/testing.md',
        'AGENTS.md',
      ]),
    ).not.toThrow();
  });
  it('requires a changelog/status update alongside release receipts', () => {
    expect(() =>
      checkChangelogChange(base, base, ['docs/example-release-20261105.json']),
    ).toThrow('Release receipts');
    expect(() =>
      checkChangelogChange(
        base,
        [
          { ...base[0], status: 'Deployed · Verified release' },
          ...base.slice(1),
        ],
        ['docs/example-release-20261105.json', 'site/public/changelog.json'],
      ),
    ).not.toThrow();
  });
  it('preserves existing history and entry permalinks', () => {
    expect(() =>
      checkChangelogChange(base, base.slice(1), ['site/public/changelog.json']),
    ).toThrow('permalink');
  });
  it('rejects duplicate IDs and invalid calendar dates', () => {
    expect(() =>
      parseChangelogFeed({ version: 1, entries: [base[0], base[0]] }),
    ).toThrow('duplicate');
    expect(() =>
      parseChangelogFeed({
        version: 1,
        entries: [{ ...base[0], date: '2026-02-30' }],
      }),
    ).toThrow();
  });
});
