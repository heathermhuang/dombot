import legacy from '../../site/public/changelog-legacy.json';
import { changelogEntries } from './changelog-entries';
import { changelogFeedLimit, parseChangelogFeed } from './changelog-schema';
import {
  parseArchiveIndex,
  parseArchiveRoot,
  archiveGroupId,
  archivePartByteLimit,
} from './changelog-archive-schema';
import type { ArchiveRoot, ArchivePart } from './changelog-archive-schema';
import type { ChangelogEntry } from './changelog-schema';

export const changelogRefreshMs = 5 * 60 * 1000;
const retryDelayMs = 60 * 1000;
const base =
  'https://raw.githubusercontent.com/heathermhuang/dombot/main/site/public/';
export const changelogSources = { archive: base + 'changelog-index.json' };
const legacyIds = new Set(changelogEntries.map((entry) => entry.id));
const legacyLocations: Record<string, string> = legacy.locations;
const baselineParts: ArchivePart[] = [
  ...new Set(Object.values(legacyLocations)),
]
  .map((id) => {
    const entries = changelogEntries.filter(
      (entry) => legacyLocations[entry.id] === id,
    );
    return {
      id,
      path: `changelog-archive/${id}.json`,
      sha256: '0'.repeat(64),
      count: entries.length,
      core: entries.filter((entry) => entry.layer === 'core').length,
      saas: entries.filter((entry) => entry.layer === 'saas').length,
      newest: entries[0].date,
      oldest: entries.at(-1)!.date,
    };
  })
  .sort((a, b) => b.newest.localeCompare(a.newest) || b.id.localeCompare(a.id));
const baselineYears = [
  ...new Set(baselineParts.map((part) => part.id.slice(0, 4))),
].map((year) => {
  const parts = baselineParts.filter((part) => part.id.startsWith(year + '-'));
  return {
    year,
    count: parts.reduce((sum, part) => sum + part.count, 0),
    core: parts.reduce((sum, part) => sum + part.core, 0),
    saas: parts.reduce((sum, part) => sum + part.saas, 0),
    lastPart: Math.max(...parts.map((part) => Number(part.id.slice(5)))),
    newest: parts[0].newest,
    oldest: parts.at(-1)!.oldest,
    latest: {
      all: parts[0].id,
      core: parts.find((part) => part.core)?.id,
      saas: parts.find((part) => part.saas)?.id,
    },
  };
});
const baseline: ArchiveRoot = {
  version: 3,
  totalEntries: changelogEntries.length,
  core: changelogEntries.filter((entry) => entry.layer === 'core').length,
  saas: changelogEntries.filter((entry) => entry.layer === 'saas').length,
  years: baselineYears,
  indexes: [
    ...new Set(baselineParts.map((part) => archiveGroupId(part.id))),
  ].map((id) => {
    const parts = baselineParts.filter(
      (part) => archiveGroupId(part.id) === id,
    );
    return {
      id,
      path: `changelog-archive-index/${id}.json`,
      sha256: '0'.repeat(64),
      year: id.slice(0, 4),
      firstPart: Math.min(...parts.map((part) => Number(part.id.slice(5)))),
      lastPart: Math.max(...parts.map((part) => Number(part.id.slice(5)))),
    };
  }),
  state: {},
};
type FeedCache = Pick<Cache, 'match' | 'put'>;
export interface ChangelogSnapshot {
  entries: ChangelogEntry[];
  stale: boolean;
  checkedAt: number | null;
  archive?: {
    index: ArchiveRoot;
    part: ArchivePart;
    selected: string;
    root: boolean;
    locations: Record<string, string>;
  };
  notFound?: boolean;
  unavailable?: boolean;
}
async function readBytes(
  response: Response,
  limit = changelogFeedLimit,
): Promise<Uint8Array> {
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw Error('Archive source unavailable');
  }
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) throw Error('Archive document exceeds its safe size');
      chunks.push(next.value);
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
  return bytes;
}
const json = (bytes: Uint8Array): unknown =>
  JSON.parse(new TextDecoder().decode(bytes));
const hash = async (bytes: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
function fallback(archive: string | undefined): ChangelogSnapshot {
  if (archive)
    return { entries: [], stale: true, checkedAt: null, unavailable: true };
  const selected = baselineParts[0].id;
  if (!baselineParts.some((part) => part.id === selected))
    return { entries: [], stale: true, checkedAt: null, notFound: true };
  return {
    entries: archive
      ? changelogEntries.filter(
          (entry) => legacyLocations[entry.id] === selected,
        )
      : changelogEntries,
    stale: true,
    checkedAt: null,
    archive: {
      index: baseline,
      part: baselineParts[0],
      selected,
      root: !archive,
      locations: legacyLocations,
    },
  };
}
export async function loadChangelog(
  options: {
    cache?: FeedCache;
    fetcher?: typeof fetch;
    now?: number;
    archive?: string;
    layer?: string;
  } = {},
): Promise<ChangelogSnapshot> {
  if (
    options.archive &&
    (options.archive.length > 40 || !/^\d{4}-\d{6,}$/.test(options.archive))
  )
    return { entries: [], stale: false, checkedAt: null, notFound: true };
  const now = options.now ?? Date.now(),
    fetcher = options.fetcher ?? fetch,
    layer =
      options.layer === 'core' || options.layer === 'saas'
        ? options.layer
        : 'all';
  const key = new Request(
    `https://domains.domains/__changelog-cache/v3/${layer}/${options.archive ?? 'latest'}`,
  );
  let saved:
    | { fetchedAt: number; retryAt?: number; snapshot: ChangelogSnapshot }
    | undefined;
  try {
    const response = await options.cache?.match(key);
    if (response) {
      const raw = json(await readBytes(response, 2_000_000)) as {
        fetchedAt: number;
        retryAt?: number;
        snapshot: ChangelogSnapshot;
      };
      if (
        Number.isFinite(raw.fetchedAt) &&
        raw.fetchedAt <= now &&
        raw.snapshot?.archive
      ) {
        raw.snapshot.entries = raw.snapshot.entries.length
          ? parseChangelogFeed({ version: 1, entries: raw.snapshot.entries })
          : [];
        raw.snapshot.archive.index = parseArchiveRoot(
          raw.snapshot.archive.index,
        );
        saved = raw;
      }
    }
  } catch {
    /* Invalid caches never suppress an origin check. */
  }
  if (saved?.retryAt && saved.retryAt > now)
    return { ...saved.snapshot, stale: true };
  if (
    saved &&
    saved.fetchedAt > 0 &&
    now - saved.fetchedAt < changelogRefreshMs
  )
    return saved.snapshot;
  async function get(file: string) {
    const url = new URL(base + file);
    url.searchParams.set('changelog-check', String(now));
    return fetcher(url.toString(), {
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
      redirect: 'manual',
      signal: AbortSignal.timeout(3000),
    });
  }
  try {
    const index = parseArchiveRoot(
      json(await readBytes(await get('changelog-index.json'))),
    );
    for (const year of baseline.years) {
      const current = index.years.find((item) => item.year === year.year);
      if (
        !current ||
        current.count < year.count ||
        current.core < year.core ||
        current.saas < year.saas ||
        current.lastPart < year.lastPart
      )
        throw Error('Bundled archive history was removed');
    }
    if (saved?.snapshot.archive)
      for (const year of saved.snapshot.archive.index.years) {
        const current = index.years.find((item) => item.year === year.year);
        if (
          !current ||
          current.count < year.count ||
          current.lastPart < year.lastPart ||
          current.core < year.core ||
          current.saas < year.saas
        )
          throw Error('Previously published history was truncated');
      }
    const chosenId =
      options.archive ??
      index.years.find((year) => layer === 'all' || year[layer] > 0)?.latest[
        layer
      ];
    const year = index.years.find((item) =>
      chosenId?.startsWith(item.year + '-'),
    );
    if (
      !chosenId ||
      !year ||
      Number(chosenId.slice(5)) < 1 ||
      Number(chosenId.slice(5)) > year.lastPart
    )
      return { entries: [], stale: false, checkedAt: now, notFound: true };
    const needed = new Set([
        chosenId,
        ...(!options.archive ? Object.values(legacyLocations) : []),
      ]),
      groups = new Map<string, ArchivePart>();
    await Promise.all(
      [...new Set([...needed].map(archiveGroupId))].map(async (id) => {
        const group = index.indexes.find((item) => item.id === id);
        if (!group) throw Error('Required archive subindex missing');
        const bytes = await readBytes(await get(group.path));
        if ((await hash(bytes)) !== group.sha256)
          throw Error('Archive subindex changed during publication');
        const sub = parseArchiveIndex(json(bytes));
        if (
          sub.parts.length !== group.lastPart - group.firstPart + 1 ||
          sub.parts.some((part) => archiveGroupId(part.id) !== id)
        )
          throw Error('Incomplete archive subindex');
        for (const part of sub.parts) groups.set(part.id, part);
      }),
    );
    const chosen = groups.get(chosenId);
    if (!chosen) throw Error('Selected archive page missing');
    const records = new Map<string, ChangelogEntry>(),
      locations: Record<string, string> = {};
    await Promise.all(
      [...needed].map(async (id) => {
        const part = groups.get(id);
        if (!part) throw Error('Required archive page missing');
        const bytes = await readBytes(
          await get(part.path),
          archivePartByteLimit,
        );
        if ((await hash(bytes)) !== part.sha256)
          throw Error(
            'Archive page changed while publishing; retain saved data',
          );
        const entries = parseChangelogFeed(json(bytes));
        if (
          entries.length !== part.count ||
          entries.filter((entry) => entry.layer === 'core').length !==
            part.core ||
          entries.filter((entry) => entry.layer === 'saas').length !== part.saas
        )
          throw Error('Incomplete archive page');
        for (const entry of entries) {
          locations[entry.id] = part.id;
          if (id === chosen.id || legacyIds.has(entry.id))
            records.set(entry.id, entry);
        }
      }),
    );
    if (!options.archive)
      for (const entry of changelogEntries)
        if (!records.has(entry.id))
          throw Error('Legacy permalink history missing');
    if (options.archive && saved?.snapshot.archive?.selected === chosen.id)
      for (const entry of saved.snapshot.entries)
        if (!records.has(entry.id))
          throw Error('An archived entry disappeared');
    const snapshot: ChangelogSnapshot = {
      entries: [...records.values()].sort((a, b) =>
        b.date.localeCompare(a.date),
      ),
      stale: false,
      checkedAt: now,
      archive: {
        index,
        part: chosen,
        selected: chosen.id,
        root: !options.archive,
        locations,
      },
    };
    try {
      await options.cache?.put(
        key,
        Response.json(
          { fetchedAt: now, snapshot },
          { headers: { 'Cache-Control': 'public, max-age=604800' } },
        ),
      );
    } catch {
      /* A cache failure cannot hide successful origin data. */
    }
    return snapshot;
  } catch {
    const snapshot = saved?.snapshot ?? fallback(options.archive);
    try {
      await options.cache?.put(
        key,
        Response.json(
          {
            fetchedAt: saved?.fetchedAt ?? 0,
            retryAt: now + retryDelayMs,
            snapshot,
          },
          { headers: { 'Cache-Control': 'public, max-age=604800' } },
        ),
      );
    } catch {
      /* Recovery does not depend on cache availability. */
    }
    return { ...snapshot, stale: true };
  }
}
