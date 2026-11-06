export interface ChangelogEntry {
  id: string;
  date: string;
  layer: 'core' | 'saas';
  title: string;
  status: string;
  changes: readonly string[];
  links: readonly { label: string; url: string }[];
}

export const changelogFeedLimit = 1_000_000;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected a changelog object');
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new Error('Invalid changelog text');
  return value;
}
export function parseChangelogFeed(value: unknown): ChangelogEntry[] {
  const feed = record(value);
  if (
    feed.version !== 1 ||
    !Array.isArray(feed.entries) ||
    !feed.entries.length ||
    feed.entries.length > 1000
  )
    throw new Error('Invalid changelog feed');
  const ids = new Set<string>();
  const entries = feed.entries.map((raw): ChangelogEntry => {
    const row = record(raw),
      id = text(row.id, 100),
      date = text(row.date, 10);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || ids.has(id))
      throw new Error('Invalid or duplicate changelog ID');
    ids.add(id);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date
    )
      throw new Error('Invalid changelog date');
    if (row.layer !== 'core' && row.layer !== 'saas')
      throw new Error('Invalid changelog layer');
    if (
      !Array.isArray(row.changes) ||
      !row.changes.length ||
      row.changes.length > 12 ||
      !Array.isArray(row.links) ||
      !row.links.length ||
      row.links.length > 8
    )
      throw new Error('Changelog changes and evidence links are required');
    return {
      id,
      date,
      layer: row.layer,
      title: text(row.title, 200),
      status: text(row.status, 300),
      changes: row.changes.map((change) => text(change, 1500)),
      links: row.links.map((rawLink) => {
        const link = record(rawLink),
          url = text(link.url, 1000);
        if (
          !/^https:\/\/github\.com\/(?:aoxborrow|heathermhuang)\/dombot\/[A-Za-z0-9_./%?=&+-]+$/.test(
            url,
          )
        )
          throw new Error(
            'Changelog evidence must link to a project repository',
          );
        return { label: text(link.label, 150), url };
      }),
    };
  });
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

export function upstreamReleaseEntries(value: unknown): ChangelogEntry[] {
  const releases = record(value).releases;
  if (!Array.isArray(releases) || releases.length > 1000)
    throw new Error('Invalid upstream release feed');
  const entries = releases.flatMap((raw) => {
    const row = record(raw);
    if (
      typeof row.version !== 'string' ||
      !/^\d+\.\d+\.\d+$/.test(row.version) ||
      row.tag !== `v${row.version}` ||
      typeof row.publishedAt !== 'string'
    )
      throw new Error('Invalid upstream release identity');
    const published = Date.parse(row.publishedAt);
    if (!Number.isFinite(published))
      throw new Error('Invalid upstream release date');
    const url = `https://github.com/aoxborrow/dombot/releases/tag/v${row.version}`;
    if (row.url !== url) throw new Error('Invalid upstream release URL');
    return [
      {
        id: `core-${row.version.replaceAll('.', '-')}`,
        date: new Date(published).toISOString().slice(0, 10),
        layer: 'core' as const,
        title: `DomBot ${row.version}`,
        status: 'Released upstream · Hosted rollout tracked separately',
        changes: [
          'A new core app release is available. Read the upstream release notes for the full list of changes.',
        ],
        links: [{ label: 'Upstream release', url }],
      },
    ];
  });
  return entries.length ? parseChangelogFeed({ version: 1, entries }) : [];
}
