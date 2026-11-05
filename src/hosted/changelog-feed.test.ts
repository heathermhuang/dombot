import { describe, expect, it, vi } from 'vitest';
import { changelogEntries } from './changelog-entries';
import {
  loadChangelog,
  changelogRefreshMs,
  changelogSources,
} from './changelog-feed';
import { changelogFeedLimit, parseChangelogFeed } from './changelog-schema';
import { changelogPage } from './changelog';

const now = Date.parse('2026-11-05T12:00:00Z');
const newer = {
  ...changelogEntries[0],
  id: 'saas-new-source-update',
  title: 'A newly merged SaaS update',
};
const upstream = {
  releases: [
    {
      version: '2.2.0',
      tag: 'v2.2.0',
      publishedAt: '2026-11-05T10:00:00Z',
      url: 'https://github.com/aoxborrow/dombot/releases/tag/v2.2.0',
    },
  ],
};
function memoryCache() {
  const saved = new Map<string, Response>();
  return {
    saved,
    match: vi.fn(async (key: Request) => saved.get(key.url)?.clone()),
    put: vi.fn(async (key: Request, response: Response) => {
      saved.set(key.url, response.clone());
    }),
  };
}
function feeds(entries = changelogEntries) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(init?.headers).toEqual({
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
    });
    expect(init?.redirect).toBe('manual');
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect([changelogSources.saas, changelogSources.core]).toContain(
      url.origin + url.pathname,
    );
    return Response.json(
      url.pathname.endsWith('/changelog.json')
        ? { version: 1, entries }
        : upstream,
    );
  });
}

describe('live changelog feeds', () => {
  it('discovers new upstream releases without claiming a hosted rollout', async () => {
    const result = await loadChangelog({ fetcher: feeds(), now });
    expect(result.stale).toBe(false);
    expect(
      result.entries.find((entry) => entry.id === 'core-2-2-0')?.status,
    ).toBe('Released upstream · Hosted rollout tracked separately');
    expect(
      result.entries.find((entry) => entry.id === 'core-2-1-0')?.status,
    ).toContain('Deployed as SaaS 2.1.0-hosted.1');
  });

  it('loads newly published SaaS notes after five minutes without rebuilding the page', async () => {
    const cache = memoryCache(),
      first = feeds(),
      next = feeds([newer, ...changelogEntries]);
    await loadChangelog({ cache, fetcher: first, now });
    const fresh = await loadChangelog({
      cache,
      fetcher: next,
      now: now + changelogRefreshMs - 1,
    });
    expect(next).not.toHaveBeenCalled();
    expect(fresh.entries.some((entry) => entry.id === newer.id)).toBe(false);
    const updated = await loadChangelog({
      cache,
      fetcher: next,
      now: now + changelogRefreshMs,
    });
    expect(next).toHaveBeenCalledTimes(2);
    expect(
      new URL(String(next.mock.calls[0][0])).searchParams.get(
        'changelog-check',
      ),
    ).toBe(String(now + changelogRefreshMs));
    expect(updated.entries.some((entry) => entry.id === newer.id)).toBe(true);
    expect(changelogPage('saas', updated)).toContain(newer.title);
    expect(changelogPage('core', updated)).not.toContain(newer.title);
  });

  it('retains last good data and reports stale on a failed refresh, then recovers', async () => {
    const cache = memoryCache();
    await loadChangelog({
      cache,
      fetcher: feeds([newer, ...changelogEntries]),
      now,
    });
    const offline = vi.fn(
      async () => new Response('unavailable', { status: 503 }),
    );
    const stale = await loadChangelog({
      cache,
      fetcher: offline,
      now: now + changelogRefreshMs,
    });
    expect(stale.stale).toBe(true);
    expect(stale.checkedAt).toBe(now);
    expect(stale.entries.some((entry) => entry.id === newer.id)).toBe(true);
    expect(changelogPage(undefined, stale)).toContain(
      'newer changes may be missing',
    );

    await loadChangelog({
      cache,
      fetcher: offline,
      now: now + changelogRefreshMs + 1,
    });
    expect(offline).toHaveBeenCalledTimes(2);
    const recovered = await loadChangelog({
      cache,
      fetcher: feeds(),
      now: now + changelogRefreshMs + 60_000,
    });
    expect(recovered.stale).toBe(false);
  });

  it('keeps the bundled history readable with no cache and both sources unavailable', async () => {
    const result = await loadChangelog({
      fetcher: vi.fn(async () => {
        throw new Error('offline');
      }),
      now,
    });
    expect(result.entries).toEqual(changelogEntries);
    expect(result.stale).toBe(true);
    expect(result.checkedAt).toBeNull();
  });

  it('does not replace a good feed with malformed or oversized content', async () => {
    const cache = memoryCache();
    await loadChangelog({
      cache,
      fetcher: feeds([newer, ...changelogEntries]),
      now,
    });
    const broken = vi.fn(
      async (input: RequestInfo | URL) =>
        new Response(
          String(input).includes('/changelog.json')
            ? '{broken'
            : 'x'.repeat(changelogFeedLimit + 1),
        ),
    );
    const result = await loadChangelog({
      cache,
      fetcher: broken,
      now: now + changelogRefreshMs,
    });
    expect(result.stale).toBe(true);
    expect(result.entries.some((entry) => entry.id === newer.id)).toBe(true);
  });

  it('cancels an oversized stream before consuming unbounded input', async () => {
    let canceled = 0;
    const result = await loadChangelog({
      now,
      fetcher: vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array(changelogFeedLimit + 1));
              },
              cancel() {
                canceled++;
              },
            }),
          ),
      ),
    });
    expect(canceled).toBe(2);
    expect(result.stale).toBe(true);
  });

  it('escapes hostile feed content and refuses external evidence links', async () => {
    const hostile = { ...newer, title: '<script>alert(1)</script>' };
    const result = await loadChangelog({
      fetcher: feeds([hostile, ...changelogEntries]),
      now,
    });
    const html = changelogPage(undefined, result);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(() =>
      parseChangelogFeed({
        version: 1,
        entries: [
          { ...newer, links: [{ label: 'Bad', url: 'javascript:alert(1)' }] },
        ],
      }),
    ).toThrow();
  });

  it('tolerates cache outages without marking successful source data stale', async () => {
    const cache = {
      match: vi.fn(async () => {
        throw new Error('cache unavailable');
      }),
      put: vi.fn(async () => {
        throw new Error('cache unavailable');
      }),
    };
    const result = await loadChangelog({ cache, fetcher: feeds(), now });
    expect(result.stale).toBe(false);
    expect(result.checkedAt).toBe(now);
  });
});
