import { changelogEntries } from './changelog-entries';
import {
  changelogFeedLimit,
  parseChangelogFeed,
  upstreamReleaseEntries,
} from './changelog-schema';
import type { ChangelogEntry } from './changelog-schema';

export const changelogRefreshMs = 5 * 60 * 1000;
const retryDelayMs = 60 * 1000;
export const changelogSources = {
  saas: 'https://raw.githubusercontent.com/heathermhuang/dombot/main/site/public/changelog.json',
  core: 'https://raw.githubusercontent.com/aoxborrow/dombot/main/site/public/releases.json',
};
type FeedCache = Pick<Cache, 'match' | 'put'>;
export interface ChangelogSnapshot {
  entries: ChangelogEntry[];
  stale: boolean;
  checkedAt: number | null;
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new Error('Changelog source unavailable');
  }
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > changelogFeedLimit)
        throw new Error('Changelog source exceeds size limit');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

async function source(
  kind: 'saas' | 'core',
  cache: FeedCache | undefined,
  fetcher: typeof fetch,
  now: number,
): Promise<ChangelogSnapshot> {
  const key = new Request(
    `https://domains.domains/__changelog-cache/v1/${kind}`,
  );
  let saved:
    | { fetchedAt: number; entries: ChangelogEntry[]; retryAt?: number }
    | undefined;
  try {
    const response = await cache?.match(key);
    if (response) {
      const raw = (await boundedJson(response)) as {
        fetchedAt?: unknown;
        entries?: unknown;
        retryAt?: unknown;
      };
      if (
        typeof raw.fetchedAt === 'number' &&
        raw.fetchedAt <= now &&
        raw.fetchedAt >= 0
      )
        saved = {
          fetchedAt: raw.fetchedAt,
          retryAt:
            typeof raw.retryAt === 'number' && raw.retryAt <= now + retryDelayMs
              ? raw.retryAt
              : undefined,
          entries:
            kind === 'core' &&
            Array.isArray(raw.entries) &&
            raw.entries.length === 0
              ? []
              : parseChangelogFeed({ version: 1, entries: raw.entries }),
        };
    }
  } catch {
    /* An absent or invalid cache never prevents a source refresh. */
  }
  if (saved?.retryAt && saved.retryAt > now)
    return {
      entries: saved.entries,
      stale: true,
      checkedAt: saved.fetchedAt || null,
    };
  if (
    saved &&
    saved.fetchedAt > 0 &&
    now - saved.fetchedAt < changelogRefreshMs
  )
    return { entries: saved.entries, stale: false, checkedAt: saved.fetchedAt };
  try {
    const url = new URL(changelogSources[kind]);
    url.searchParams.set(
      'changelog-check',
      String(Math.floor(now / changelogRefreshMs)),
    );
    const json = await boundedJson(
      await fetcher(url.toString(), {
        headers: { Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(3000),
      }),
    );
    const entries =
      kind === 'saas' ? parseChangelogFeed(json) : upstreamReleaseEntries(json);
    // Store the normalized public data for recovery, while enforcing our shorter refresh interval.
    try {
      await cache?.put(
        key,
        Response.json(
          { fetchedAt: now, entries },
          {
            headers: { 'Cache-Control': 'public, max-age=604800' },
          },
        ),
      );
    } catch {
      /* A successful source read remains usable if cache storage fails. */
    }
    return { entries, stale: false, checkedAt: now };
  } catch {
    const entries = saved?.entries ?? (kind === 'saas' ? changelogEntries : []);
    try {
      await cache?.put(
        key,
        Response.json(
          {
            fetchedAt: saved?.fetchedAt ?? 0,
            entries,
            retryAt: now + retryDelayMs,
          },
          {
            headers: { 'Cache-Control': 'public, max-age=604800' },
          },
        ),
      );
    } catch {
      /* Failure checkpoints are best-effort; retained data is still usable. */
    }
    return {
      entries: saved?.entries ?? (kind === 'saas' ? changelogEntries : []),
      stale: true,
      checkedAt: saved?.fetchedAt || null,
    };
  }
}

export async function loadChangelog(
  options: {
    cache?: FeedCache;
    fetcher?: typeof fetch;
    now?: number;
  } = {},
): Promise<ChangelogSnapshot> {
  const now = options.now ?? Date.now(),
    fetcher = options.fetcher ?? fetch;
  const [saas, core] = await Promise.all([
    source('saas', options.cache, fetcher, now),
    source('core', options.cache, fetcher, now),
  ]);
  const entries = new Map(core.entries.map((entry) => [entry.id, entry]));
  for (const entry of saas.entries) entries.set(entry.id, entry);
  return {
    entries: [...entries.values()].sort((a, b) => b.date.localeCompare(a.date)),
    stale: saas.stale || core.stale,
    checkedAt:
      saas.checkedAt === null || core.checkedAt === null
        ? null
        : Math.min(saas.checkedAt, core.checkedAt),
  };
}
