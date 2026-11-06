import {
  archiveRootData,
  archiveHash,
  writeArchive,
  readArchive,
} from '../../scripts/changelog-archive.mjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { changelogEntries } from './changelog-entries';
import { loadChangelog, changelogRefreshMs } from './changelog-feed';
import { changelogPage } from './changelog';
import index from '../../site/public/changelog-index.json';
const now = Date.parse('2026-11-06T03:00:00Z');
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});
function cache() {
  const saved = new Map<string, Response>();
  return {
    saved,
    match: vi.fn(async (key: Request) => saved.get(key.url)?.clone()),
    put: vi.fn(async (key: Request, response: Response) => {
      saved.set(key.url, response.clone());
    }),
  };
}
function fixture(root = process.cwd()) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(init?.redirect).toBe('manual');
    expect(init?.headers).toEqual({
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
    });
    const url = new URL(String(input));
    expect(url.origin).toBe('https://raw.githubusercontent.com');
    const file = url.pathname.split('/site/public/')[1];
    if (
      !file ||
      !/^changelog-(?:index\.json|archive(?:-index)?\/\d{4}-\d{6,}\.json)$/.test(
        file,
      )
    )
      throw Error('Unexpected archive source');
    return new Response(fs.readFileSync(path.join(root, 'site/public', file)));
  });
}
function bigArchive() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'changelog-reader-test-'));
  dirs.push(root);
  writeArchive(root, changelogEntries);
  writeArchive(root, [
    ...Array.from({ length: 1200 }, (_, i) => ({
      ...changelogEntries[0],
      id: 'future-' + i,
      title: 'Future ' + i,
    })),
  ]);
  return root;
}

describe('permanent paged changelog reader', () => {
  it('loads real archive pages and keeps all legacy root permalinks', async () => {
    const result = await loadChangelog({ fetcher: fixture(), now });
    expect(result.stale).toBe(false);
    for (const entry of changelogEntries)
      expect(result.entries.some((item) => item.id === entry.id)).toBe(true);
    expect(result.archive?.index.totalEntries).toBe(changelogEntries.length);
  });
  it('uses the five-minute cache and refreshes only when due', async () => {
    const c = cache(),
      fetcher = fixture();
    await loadChangelog({ cache: c, fetcher, now });
    const calls = fetcher.mock.calls.length;
    await loadChangelog({
      cache: c,
      fetcher,
      now: now + changelogRefreshMs - 1,
    });
    expect(fetcher).toHaveBeenCalledTimes(calls);
    await loadChangelog({ cache: c, fetcher, now: now + changelogRefreshMs });
    expect(fetcher.mock.calls.length).toBeGreaterThan(calls);
  });
  it('retains saved data during an outage, backs off, then recovers', async () => {
    const c = cache();
    await loadChangelog({ cache: c, fetcher: fixture(), now });
    const offline = vi.fn(async () => new Response(null, { status: 503 }));
    const stale = await loadChangelog({
      cache: c,
      fetcher: offline,
      now: now + changelogRefreshMs,
    });
    expect(stale.stale).toBe(true);
    expect(stale.entries.length).toBe(changelogEntries.length);
    await loadChangelog({
      cache: c,
      fetcher: offline,
      now: now + changelogRefreshMs + 1,
    });
    expect(offline).toHaveBeenCalledTimes(1);
    expect(
      (
        await loadChangelog({
          cache: c,
          fetcher: fixture(),
          now: now + changelogRefreshMs + 60000,
        })
      ).stale,
    ).toBe(false);
  });
  it('fails to the legacy snapshot but returns unavailable for an uncached requested page', async () => {
    const fetcher = vi.fn(async () => {
      throw Error('offline');
    });
    const root = await loadChangelog({ fetcher, now });
    expect(root.stale).toBe(true);
    expect(root.entries).toEqual(changelogEntries);
    const archive = await loadChangelog({
      fetcher,
      now,
      archive: index.years[0].latest.all,
    });
    expect(archive.unavailable).toBe(true);
    expect(archive.notFound).not.toBe(true);
  });
  it('keeps more than 1000 records accessible through every bounded archive page', async () => {
    const root = bigArchive(),
      origin = fixture(root),
      state = readArchive(root),
      seen = new Set<string>();
    const latest = await loadChangelog({ fetcher: origin, now });
    expect(latest.archive?.index.totalEntries).toBeGreaterThan(1000);
    expect(latest.entries.length).toBeLessThanOrEqual(
      changelogEntries.length + 100,
    );
    expect(changelogPage(undefined, latest)).toContain('Older page');
    for (const part of state.index.parts) {
      const snapshot = await loadChangelog({
        fetcher: origin,
        now,
        archive: part.id,
      });
      expect(snapshot.stale).toBe(false);
      expect(snapshot.entries.length).toBeLessThanOrEqual(100);
      for (const entry of snapshot.entries) seen.add(entry.id);
    }
    expect(seen.size).toBe(state.index.totalEntries);
  });
  it('gives new records stable page URLs while keeping legacy fragment URLs', async () => {
    const root = bigArchive(),
      result = await loadChangelog({ fetcher: fixture(root), now });
    const html = changelogPage(undefined, result);
    expect(html).toContain('/changelog?archive=');
    expect(html).toContain(`/changelog#${changelogEntries[0].id}`);
    const entry = result.entries.find((item) => item.id.startsWith('future-'))!;
    const location = result.archive!.locations[entry.id];
    const page = await loadChangelog({
      fetcher: fixture(root),
      now,
      archive: location,
    });
    expect(page.entries.some((item) => item.id === entry.id)).toBe(true);
  });
  it('does not silently accept a truncated index or a corrupted page', async () => {
    const c = cache();
    await loadChangelog({ cache: c, fetcher: fixture(), now });
    const corrupt = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('changelog-index.json')
        ? Response.json({ ...index, totalEntries: 1, parts: [] })
        : new Response('{}'),
    );
    expect(
      (
        await loadChangelog({
          cache: c,
          fetcher: corrupt,
          now: now + changelogRefreshMs,
        })
      ).stale,
    ).toBe(true);
  });
  it('refuses invalid and missing archive identities without reflecting untrusted input', async () => {
    const fetcher = fixture();
    const invalid = await loadChangelog({
      fetcher,
      now,
      archive: '../../secrets',
    });
    expect(invalid.notFound).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
    const missing = await loadChangelog({
      fetcher,
      now,
      archive: '2026-999999',
    });
    expect(missing.notFound).toBe(true);
  });
  it('cancels oversized source streams', async () => {
    let canceled = 0;
    const result = await loadChangelog({
      now,
      fetcher: vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array(1_000_001));
              },
              cancel() {
                canceled++;
              },
            }),
          ),
      ),
    });
    expect(result.stale).toBe(true);
    expect(canceled).toBe(1);
  });
});

it('uses bounded subindexes even when an archive has more than 1000 pages', async () => {
  const baseline = readArchive(process.cwd()),
    parts = [...baseline.index.parts],
    documents = new Map<string, string>();
  for (let sequence = 3; sequence <= 1003; sequence++) {
    const id = '2026-' + String(sequence).padStart(6, '0'),
      entry = {
        ...changelogEntries[0],
        id: 'index-growth-' + sequence,
        date: '2026-11-07',
        title: 'Index growth ' + sequence,
      };
    const bytes = JSON.stringify({ version: 1, entries: [entry] }) + '\n',
      file = 'changelog-archive/' + id + '.json';
    documents.set(file, bytes);
    parts.push({
      id,
      path: file,
      sha256: archiveHash(bytes),
      count: 1,
      core: 0,
      saas: 1,
      newest: entry.date,
      oldest: entry.date,
    });
  }
  parts.sort(
    (a, b) => b.newest.localeCompare(a.newest) || b.id.localeCompare(a.id),
  );
  const publication = archiveRootData({
    version: 2,
    totalEntries: changelogEntries.length + 1001,
    parts,
    state: {},
  });
  documents.set('changelog-index.json', JSON.stringify(publication.root));
  for (const [file, bytes] of publication.files) documents.set(file, bytes);
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const file = new URL(String(input)).pathname.split('/site/public/')[1];
    return new Response(
      documents.get(file) ?? fs.readFileSync('site/public/' + file),
    );
  });
  const result = await loadChangelog({ fetcher, now });
  expect(result.stale).toBe(false);
  expect(result.archive?.index.indexes).toHaveLength(2);
  expect(result.archive?.index.totalEntries).toBe(
    changelogEntries.length + 1001,
  );
  expect(result.entries.length).toBeLessThanOrEqual(
    changelogEntries.length + 100,
  );
  expect(fetcher).toHaveBeenCalledTimes(6);
  const older = await loadChangelog({ fetcher, now, archive: '2026-001002' });
  expect(older.stale).toBe(false);
  expect(older.entries[0].id).toBe('index-growth-1002');
});
