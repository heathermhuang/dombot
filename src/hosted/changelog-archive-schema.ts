export const archivePageSize = 100;
export const archivePartByteLimit = 250_000;
export interface ArchivePart {
  id: string;
  path: string;
  sha256: string;
  count: number;
  core: number;
  saas: number;
  newest: string;
  oldest: string;
}
export interface ArchiveIndex {
  version: 2;
  totalEntries: number;
  parts: ArchivePart[];
  state: Record<string, unknown>;
}
export function parseArchiveIndex(value: unknown): ArchiveIndex {
  if (!value || typeof value !== 'object')
    throw new Error('Invalid archive index');
  const row = value as Record<string, unknown>;
  if (
    row.version !== 2 ||
    !Array.isArray(row.parts) ||
    !row.parts.length ||
    !Number.isSafeInteger(row.totalEntries)
  )
    throw new Error('Invalid archive index');
  const seen = new Set<string>();
  const parts = row.parts.map((raw): ArchivePart => {
    if (!raw || typeof raw !== 'object')
      throw new Error('Invalid archive page');
    const part = raw as Record<string, unknown>;
    if (
      typeof part.id !== 'string' ||
      !/^\d{4}-\d{6,}$/.test(part.id) ||
      part.id.length > 40 ||
      seen.has(part.id) ||
      part.path !== `changelog-archive/${part.id}.json` ||
      typeof part.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(part.sha256)
    )
      throw new Error('Invalid archive page identity');
    seen.add(part.id);
    for (const name of ['count', 'core', 'saas'])
      if (!Number.isSafeInteger(part[name]) || Number(part[name]) < 0)
        throw new Error('Invalid archive page count');
    if (
      Number(part.count) < 1 ||
      Number(part.count) > archivePageSize ||
      Number(part.core) + Number(part.saas) !== part.count
    )
      throw new Error('Invalid archive page count');
    for (const name of ['newest', 'oldest'])
      if (
        typeof part[name] !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(String(part[name]))
      )
        throw new Error('Invalid archive page date');
    if (String(part.oldest) > String(part.newest))
      throw new Error('Invalid archive date range');
    return {
      id: part.id,
      path: String(part.path),
      sha256: part.sha256,
      count: Number(part.count),
      core: Number(part.core),
      saas: Number(part.saas),
      newest: String(part.newest),
      oldest: String(part.oldest),
    };
  });
  if (parts.reduce((sum, part) => sum + part.count, 0) !== row.totalEntries)
    throw new Error('Archive total does not match its pages');
  return {
    version: 2,
    totalEntries: Number(row.totalEntries),
    parts: parts.sort(
      (a, b) => b.newest.localeCompare(a.newest) || b.id.localeCompare(a.id),
    ),
    state:
      row.state && typeof row.state === 'object' && !Array.isArray(row.state)
        ? (row.state as Record<string, unknown>)
        : {},
  };
}

export const archiveIndexGroupSize = 1000;
export interface ArchiveIndexGroup {
  id: string;
  path: string;
  sha256: string;
  year: string;
  firstPart: number;
  lastPart: number;
}
export interface ArchiveYear {
  year: string;
  count: number;
  core: number;
  saas: number;
  lastPart: number;
  newest: string;
  oldest: string;
  latest: { all: string; core?: string; saas?: string };
}
export interface ArchiveRoot {
  version: 3;
  totalEntries: number;
  core: number;
  saas: number;
  years: ArchiveYear[];
  indexes: ArchiveIndexGroup[];
  state: Record<string, unknown>;
}
export const archiveGroupId = (part: string) =>
  part.slice(0, 4) +
  '-' +
  String(
    Math.floor((Number(part.slice(5)) - 1) / archiveIndexGroupSize),
  ).padStart(6, '0');
export function parseArchiveRoot(value: unknown): ArchiveRoot {
  if (!value || typeof value !== 'object') throw Error('Invalid archive root');
  const row = value as Record<string, unknown>;
  if (
    row.version !== 3 ||
    !Array.isArray(row.years) ||
    !row.years.length ||
    !Array.isArray(row.indexes)
  )
    throw Error('Invalid archive root');
  const positive = (value: unknown) =>
    Number.isSafeInteger(value) && Number(value) >= 0;
  const indexes = row.indexes.map((item): ArchiveIndexGroup => {
    if (!item || typeof item !== 'object')
      throw Error('Invalid archive index group');
    const group = item as Record<string, unknown>;
    if (
      typeof group.id !== 'string' ||
      group.id.length > 40 ||
      !/^\d{4}-\d{6,}$/.test(group.id) ||
      group.path !== `changelog-archive-index/${group.id}.json` ||
      typeof group.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(group.sha256) ||
      group.year !== group.id.slice(0, 4) ||
      !positive(group.firstPart) ||
      !positive(group.lastPart) ||
      Number(group.firstPart) !==
        Number(group.id.slice(5)) * archiveIndexGroupSize + 1 ||
      Number(group.lastPart) < Number(group.firstPart) ||
      Number(group.lastPart) >= Number(group.firstPart) + archiveIndexGroupSize
    )
      throw Error('Invalid archive index group');
    return {
      id: group.id,
      path: String(group.path),
      sha256: group.sha256,
      year: String(group.year),
      firstPart: Number(group.firstPart),
      lastPart: Number(group.lastPart),
    };
  });
  if (new Set(indexes.map((group) => group.id)).size !== indexes.length)
    throw Error('Duplicate archive index group');
  const years = row.years.map((item): ArchiveYear => {
    if (!item || typeof item !== 'object') throw Error('Invalid archive year');
    const year = item as Record<string, unknown>;
    if (
      typeof year.year !== 'string' ||
      !/^\d{4}$/.test(year.year) ||
      !positive(year.count) ||
      !positive(year.core) ||
      !positive(year.saas) ||
      !positive(year.lastPart) ||
      Number(year.lastPart) < 1 ||
      Number(year.count) < Number(year.lastPart) ||
      Number(year.core) + Number(year.saas) !== year.count ||
      typeof year.oldest !== 'string' ||
      typeof year.newest !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(year.oldest) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(year.newest) ||
      year.oldest > year.newest ||
      !year.latest ||
      typeof year.latest !== 'object'
    )
      throw Error('Invalid archive year');
    let next = 1;
    for (const group of indexes
      .filter((group) => group.year === year.year)
      .sort((a, b) => a.firstPart - b.firstPart)) {
      if (group.firstPart !== next)
        throw Error('An archive index range disappeared');
      next = group.lastPart + 1;
    }
    if (next !== Number(year.lastPart) + 1)
      throw Error('Incomplete archive year index');
    const latest = year.latest as Record<string, unknown>;
    for (const name of ['all', 'core', 'saas']) {
      const id = latest[name];
      if (name !== 'all' && Number(year[name]) === 0) continue;
      if (
        typeof id !== 'string' ||
        !id.startsWith(year.year + '-') ||
        !/^\d{4}-\d{6,}$/.test(id) ||
        Number(id.slice(5)) < 1 ||
        Number(id.slice(5)) > Number(year.lastPart)
      )
        throw Error('Invalid latest archive page');
    }
    return {
      year: year.year,
      count: Number(year.count),
      core: Number(year.core),
      saas: Number(year.saas),
      lastPart: Number(year.lastPart),
      oldest: year.oldest,
      newest: year.newest,
      latest: {
        all: String(latest.all),
        ...(typeof latest.core === 'string' ? { core: latest.core } : {}),
        ...(typeof latest.saas === 'string' ? { saas: latest.saas } : {}),
      },
    };
  });
  if (
    new Set(years.map((year) => year.year)).size !== years.length ||
    indexes.some((group) => !years.some((year) => year.year === group.year))
  )
    throw Error('Invalid archive year coverage');
  if (
    !positive(row.totalEntries) ||
    !positive(row.core) ||
    !positive(row.saas) ||
    years.reduce((sum, year) => sum + year.count, 0) !== row.totalEntries ||
    years.reduce((sum, year) => sum + year.core, 0) !== row.core ||
    years.reduce((sum, year) => sum + year.saas, 0) !== row.saas
  )
    throw Error('Archive root totals are incomplete');
  return {
    version: 3,
    totalEntries: Number(row.totalEntries),
    core: Number(row.core),
    saas: Number(row.saas),
    years: years.sort((a, b) => b.year.localeCompare(a.year)),
    indexes,
    state:
      row.state && typeof row.state === 'object' && !Array.isArray(row.state)
        ? (row.state as Record<string, unknown>)
        : {},
  };
}
