import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseChangelogFeed } from '../src/hosted/changelog-schema.ts';
import {
  archivePageSize,
  archivePartByteLimit,
  parseArchiveIndex,
  parseArchiveRoot,
  archiveGroupId,
} from '../src/hosted/changelog-archive-schema.ts';
export const archiveIndexPath = 'site/public/changelog-index.json';
export const archiveHash = (bytes) =>
  createHash('sha256').update(bytes).digest('hex');
const encode = (value) => JSON.stringify(value, null, 2) + '\n';
export function archiveRootData(index) {
  const grouped = new Map(),
    years = [];
  for (const part of index.parts) {
    const key = archiveGroupId(part.id);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(part);
  }
  const files = [],
    indexes = [];
  for (const [id, parts] of grouped) {
    const value = parseArchiveIndex({
        version: 2,
        totalEntries: parts.reduce((sum, part) => sum + part.count, 0),
        parts,
        state: {},
      }),
      bytes = encode(value);
    if (Buffer.byteLength(bytes) > 1_000_000)
      throw Error('Archive subindex exceeds its bounded document size');
    const firstPart = Math.min(
        ...parts.map((part) => Number(part.id.slice(5))),
      ),
      lastPart = Math.max(...parts.map((part) => Number(part.id.slice(5))));
    const file = `changelog-archive-index/${id}.json`;
    indexes.push({
      id,
      path: file,
      sha256: archiveHash(bytes),
      year: id.slice(0, 4),
      firstPart,
      lastPart,
    });
    files.push([file, bytes]);
  }
  for (const year of [
    ...new Set(index.parts.map((part) => part.id.slice(0, 4))),
  ]) {
    const parts = index.parts.filter((part) => part.id.startsWith(year + '-')),
      count = parts.reduce((sum, part) => sum + part.count, 0),
      core = parts.reduce((sum, part) => sum + part.core, 0),
      saas = count - core;
    years.push({
      year,
      count,
      core,
      saas,
      lastPart: Math.max(...parts.map((part) => Number(part.id.slice(5)))),
      newest: parts[0].newest,
      oldest: parts.reduce(
        (old, part) => (part.oldest < old ? part.oldest : old),
        parts[0].oldest,
      ),
      latest: {
        all: parts[0].id,
        ...(core ? { core: parts.find((part) => part.core > 0).id } : {}),
        ...(saas ? { saas: parts.find((part) => part.saas > 0).id } : {}),
      },
    });
  }
  const root = parseArchiveRoot({
    version: 3,
    totalEntries: index.totalEntries,
    core: years.reduce((sum, year) => sum + year.core, 0),
    saas: years.reduce((sum, year) => sum + year.saas, 0),
    years,
    indexes,
    state: index.state,
  });
  if (Buffer.byteLength(encode(root)) > 1_000_000)
    throw Error(
      'Archive root metadata needs further index partitioning; refusing partial publication',
    );
  return { root, files };
}
export function readArchive(root) {
  const file = path.join(root, archiveIndexPath);
  if (!fs.existsSync(file))
    return {
      index: null,
      pages: new Map(),
      entries: new Map(),
      locations: new Map(),
    };
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  let index;
  if (raw.version === 3) {
    const rootIndex = parseArchiveRoot(raw),
      parts = [];
    for (const group of rootIndex.indexes) {
      const bytes = fs.readFileSync(path.join(root, 'site/public', group.path));
      if (archiveHash(bytes) !== group.sha256)
        throw Error('Archive subindex integrity failure');
      const sub = parseArchiveIndex(JSON.parse(bytes));
      for (const part of sub.parts) {
        if (archiveGroupId(part.id) !== group.id)
          throw Error('Archive page moved outside its index');
        parts.push(part);
      }
    }
    index = parseArchiveIndex({
      version: 2,
      totalEntries: rootIndex.totalEntries,
      parts,
      state: rootIndex.state,
    });
    if (parts.reduce((sum, part) => sum + part.core, 0) !== rootIndex.core)
      throw Error('Archive root layer totals do not match');
  } else index = parseArchiveIndex(raw);
  const pages = new Map(),
    entries = new Map(),
    locations = new Map();
  for (const part of index.parts) {
    const bytes = fs.readFileSync(path.join(root, 'site/public', part.path));
    if (
      bytes.length > archivePartByteLimit ||
      archiveHash(bytes) !== part.sha256
    )
      throw Error('Archive page integrity failure: ' + part.id);
    const records = parseChangelogFeed(JSON.parse(bytes));
    if (
      records.length !== part.count ||
      records.filter((e) => e.layer === 'core').length !== part.core ||
      records.filter((e) => e.layer === 'saas').length !== part.saas
    )
      throw Error('Archive page count mismatch');
    for (const entry of records) {
      if (entries.has(entry.id))
        throw Error('Duplicate archived entry: ' + entry.id);
      entries.set(entry.id, entry);
      locations.set(entry.id, part.id);
    }
    pages.set(part.id, records);
  }
  if (entries.size !== index.totalEntries) throw Error('Incomplete archive');
  return { index, pages, entries, locations };
}
export function writeArchive(root, updates, state = {}) {
  const before = readArchive(root),
    pages = new Map(
      [...before.pages].map(([id, entries]) => [id, [...entries]]),
    ),
    locations = new Map(before.locations);
  const normalized = updates
    .map((entry) => parseChangelogFeed({ version: 1, entries: [entry] })[0])
    .sort((a, b) => b.date.localeCompare(a.date));
  for (const entry of [...normalized].reverse()) {
    const existing = before.entries.get(entry.id);
    if (existing) {
      if (existing.layer !== entry.layer)
        throw Error(
          'Published archive entries cannot change layer; add a correction',
        );
      if (existing.date.slice(0, 4) !== entry.date.slice(0, 4))
        throw Error(
          'Archive entries cannot move years; add a linked correction',
        );
      const links = new Map(existing.links.map((link) => [link.url, link]));
      for (const link of entry.links) links.set(link.url, link);
      const merged = parseChangelogFeed({
        version: 1,
        entries: [{ ...entry, links: [...links.values()] }],
      })[0];
      const id = locations.get(entry.id),
        records = pages.get(id);
      records[records.findIndex((e) => e.id === entry.id)] = merged;
      continue;
    }
    const year = entry.date.slice(0, 4);
    let id = [...pages.keys()]
      .filter((key) => key.startsWith(year + '-'))
      .sort()
      .at(-1);
    let records = id ? pages.get(id) : [];
    if (
      !id ||
      records.length >= archivePageSize ||
      Buffer.byteLength(encode({ version: 1, entries: [...records, entry] })) >
        archivePartByteLimit
    ) {
      const next = id ? Number(id.split('-')[1]) + 1 : 1;
      id = year + '-' + String(next).padStart(6, '0');
      records = [];
      pages.set(id, records);
    }
    records.push(entry);
    locations.set(entry.id, id);
  }
  const all = new Map();
  const writes = [];
  const parts = [];
  for (const [id, rows] of pages) {
    const entries = parseChangelogFeed({ version: 1, entries: rows }).sort(
      (a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
    );
    const bytes = encode({ version: 1, entries });
    if (
      entries.length > archivePageSize ||
      Buffer.byteLength(bytes) > archivePartByteLimit
    )
      throw Error('Archive page exceeds its bounded size');
    for (const entry of entries) {
      if (all.has(entry.id)) throw Error('Duplicate archived entry');
      all.set(entry.id, entry);
    }
    const partPath = `changelog-archive/${id}.json`;
    parts.push({
      id,
      path: partPath,
      sha256: archiveHash(bytes),
      count: entries.length,
      core: entries.filter((e) => e.layer === 'core').length,
      saas: entries.filter((e) => e.layer === 'saas').length,
      newest: entries[0].date,
      oldest: entries.at(-1).date,
    });
    writes.push([path.join(root, 'site/public', partPath), bytes]);
  }
  for (const [id, old] of before.entries) {
    const current = all.get(id);
    if (!current) throw Error('Refusing to delete archived entry: ' + id);
    for (const link of old.links)
      if (!current.links.some((item) => item.url === link.url))
        throw Error('Refusing to delete historical evidence');
  }
  const index = parseArchiveIndex({
    version: 2,
    totalEntries: all.size,
    parts,
    state: { ...(before.index?.state ?? {}), ...state },
  });
  const publication = archiveRootData(index);
  // Validate the entire publication before changing any files. Never publish partial pagination.
  let changed = false;
  for (const [file, bytes] of writes) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== bytes) {
      fs.writeFileSync(file, bytes);
      changed = true;
    }
  }
  for (const [file, bytes] of publication.files) {
    const target = path.join(root, 'site/public', file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== bytes) {
      fs.writeFileSync(target, bytes);
      changed = true;
    }
  }
  const target = path.join(root, archiveIndexPath),
    bytes = encode(publication.root);
  if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== bytes) {
    fs.writeFileSync(target, bytes);
    changed = true;
  }
  return {
    index,
    added: all.size - before.entries.size,
    entries: all,
    changed,
  };
}
