import { describe, expect, it } from 'vitest';
import inventory from '../../docs/changelog-history-inventory-20261106.json';
import { changelogEntries } from './changelog-entries';
import { upstreamReleaseEntries } from './changelog-schema';
import { changelogPage } from './changelog';

const byId = new Map(changelogEntries.map((entry) => [entry.id, entry]));

describe('complete changelog archive', () => {
  it('keeps all published upstream and maintained-fork releases', () => {
    expect(inventory.upstreamPublishedReleases).toHaveLength(8);
    expect(inventory.forkDesktopReleases).toHaveLength(2);
    for (const release of [
      ...inventory.upstreamPublishedReleases,
      ...inventory.forkDesktopReleases,
    ]) {
      const entry = byId.get(release.entryId);
      expect(entry?.date).toBe(release.publishedAt.slice(0, 10));
      expect(entry?.links.some((link) => link.url === release.url)).toBe(true);
    }
    expect(byId.get('saas-desktop-1-5-2')?.status).toContain(
      'Separate from SaaS deployment',
    );
  });

  it('covers every upstream primary-source change back to the initial scaffold', () => {
    expect(inventory.upstreamPrimaryCommits).toHaveLength(268);
    for (const change of inventory.upstreamPrimaryCommits) {
      const entry = byId.get(change.entryId);
      expect(entry?.layer).toBe('core');
      expect(entry?.status).toContain('source history');
      expect(
        entry?.links.some(
          (link) =>
            link.url ===
            `https://github.com/aoxborrow/dombot/commit/${change.sha}`,
        ),
      ).toBe(true);
    }
    expect(
      changelogEntries.filter((entry) => entry.layer === 'core').at(-1)?.date,
    ).toBe('2026-08-30');
    expect(changelogPage('core')).toContain('From 30 August 2026');
  });

  it('covers all merged SaaS changes, including the original release branches', () => {
    expect(inventory.saasMergedPullRequests).toHaveLength(169);
    for (const change of inventory.saasMergedPullRequests) {
      const entry = byId.get(change.entryId);
      expect(entry?.layer).toBe('saas');
      expect(entry?.links.some((link) => link.url === change.url)).toBe(true);
    }
    const first = byId.get(inventory.firstHostedSource.entryId);
    expect(first?.date).toBe('2026-09-09');
    expect(first?.links[0].url.endsWith(inventory.firstHostedSource.sha)).toBe(
      true,
    );
    const archived = inventory.saasMergedPullRequests.find(
      (change) => change.number === 30,
    )!;
    expect(
      byId
        .get(archived.entryId)
        ?.changes.some(
          (change) =>
            change.includes('#30:') &&
            change.includes('historical release branch'),
        ),
    ).toBe(true);
    expect(changelogPage('saas')).toContain('From 9 September 2026');
  });

  it('accepts upstream releases before November without a date cutoff', () => {
    const result = upstreamReleaseEntries({
      releases: inventory.upstreamPublishedReleases.map((release) => ({
        tag: release.tag,
        version: release.tag.slice(1),
        publishedAt: release.publishedAt,
        url: release.url,
      })),
    });
    expect(result).toHaveLength(8);
    expect(result.find((entry) => entry.id === 'core-1-0-0')?.date).toBe(
      '2026-09-02',
    );
    expect(result.find((entry) => entry.id === 'core-1-5-0')?.date).toBe(
      '2026-10-09',
    );
    expect(result.every((entry) => !entry.status.includes('Deployed'))).toBe(
      true,
    );
  });

  it('keeps the complete newest-first timeline visible and its beginning reachable', () => {
    const html = changelogPage();
    expect(html).not.toContain('Selected highlights');
    expect(html).not.toContain('November 2026 onward');
    expect(html).toContain('Jump to the beginning');
    expect([
      ...html.matchAll(/<article class="changelog-entry"/g),
    ]).toHaveLength(changelogEntries.length);
    expect(changelogEntries.length).toBeGreaterThanOrEqual(104);
  });
});
