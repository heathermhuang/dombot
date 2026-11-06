import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import gateway from './gateway';
import { changelogEntries } from './changelog-entries';
import { changelogPage } from './changelog';
import { home } from './views';

const request = (suffix = '') =>
  gateway.fetch(
    new Request(`https://domains.domains/changelog${suffix}`),
    {} as HostedEnv,
  );

describe('public changelog', () => {
  beforeEach(() =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 503 })),
    ),
  );
  afterEach(() => vi.unstubAllGlobals());
  it('serves both layers without sign-in, database bindings or scripts', async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(response.headers.get('X-Robots-Tag')).toBeNull();
    expect(response.headers.get('Set-Cookie')).toBeNull();
    const html = await response.text();
    expect(html).toContain('<title>Changelog · domains.domains</title>');
    expect(html).toContain('DomBot 2.1.0');
    expect(html).toContain('Bulk actions follow your current view');
    expect(html).not.toContain('<script');
    expect(html).toContain('Skip to content');
    expect(html).toContain(
      'domains.domains is a hosted, multi-tenant version of',
    );
  });

  it.each(['core', 'saas'] as const)(
    'filters the %s layer on the server',
    async (layer) => {
      const response = await request(`?layer=${layer}`);
      expect(response.status).toBe(200);
      const html = await response.text();
      for (const entry of changelogEntries) {
        expect(html.includes(`id="${entry.id}"`)).toBe(entry.layer === layer);
      }
      expect(html).toContain(
        `href="/changelog?layer=${layer}" aria-current="page"`,
      );
      expect(html).toContain('href="/changelog">All updates</a>');
    },
  );

  it('falls back to all updates for unknown input without reflecting it', async () => {
    const payload = '<script>alert(1)</script>';
    const response = await request(`?layer=${encodeURIComponent(payload)}`);
    const html = await response.text();
    expect(html).not.toContain(payload);
    expect(html).toContain('href="/changelog" aria-current="page"');
    for (const entry of changelogEntries)
      expect(html).toContain(`id="${entry.id}"`);
  });

  it('keeps upstream releases separate from SaaS availability', () => {
    const html = changelogPage('core');
    expect(html).toContain('Deployed as SaaS 2.1.0-hosted.1');
    expect(html).toContain(
      'Available in managed portfolios as engine 2.1.0-hosted.1',
    );
    expect(html).toContain('Included in the 4 November SaaS release');
  });

  it('keeps stable permalinks, dated reverse chronology and inspectable sources', () => {
    expect(new Set(changelogEntries.map((entry) => entry.id)).size).toBe(
      changelogEntries.length,
    );
    const html = { core: changelogPage('core'), saas: changelogPage('saas') };
    let previous = '9999-12-31';
    for (const entry of changelogEntries) {
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(
        new Date(`${entry.date}T00:00:00Z`).toISOString().slice(0, 10),
      ).toBe(entry.date);
      expect(entry.date <= previous).toBe(true);
      previous = entry.date;
      expect(entry.id).toMatch(/^[a-z0-9-]+$/);
      expect(html[entry.layer]).toContain(`href="/changelog#${entry.id}"`);
      expect(entry.links.length).toBeGreaterThan(0);
      for (const link of entry.links) {
        expect(link.url).toMatch(
          /^https:\/\/github\.com\/(aoxborrow|heathermhuang)\/dombot\//,
        );
      }
    }
  });

  it('is discoverable from the landing page and preserves private-page indexing rules', async () => {
    expect(home()).toContain('<a href="/changelog">Changelog</a>');
    const response = await gateway.fetch(
      new Request('https://domains.domains/source'),
      {} as HostedEnv,
    );
    expect(await response.text()).toContain(
      '<a href="/changelog">Changelog</a>',
    );
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });
});
