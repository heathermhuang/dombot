import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readArchive, archiveHash } from './changelog-archive.mjs';
import {
  parseArchiveIndex,
  parseArchiveRoot,
} from '../src/hosted/changelog-archive-schema.ts';
import {
  changelogFeedLimit,
  parseChangelogFeed,
} from '../src/hosted/changelog-schema.ts';

export function checkChangelogChange(baseEntries, entries, files) {
  const testsOnly = (file) =>
    /(?:\.(?:test|spec)\.[^/]+$|(?:^|\/)(?:__tests__|test-fixtures)\/)/.test(
      file,
    );
  const runtime = files.filter(
    (file) =>
      !testsOnly(file) &&
      (/^src\/(?:core|shared|worker|renderer|hosted|electron|web)\//.test(
        file,
      ) ||
        /^(?:hosted\/.*\.(?:mjs|ts|jsonc)|migrations\/|hosted\/migrations\/|relay\/.*\.mjs|package(?:-lock)?\.json$|wrangler.*\.jsonc$|vite.*\.m?ts$|scripts\/(?:dombot-engine|prepare-on-demand)\.mjs$)/.test(
          file,
        )),
  );
  const receipts = files.filter((file) =>
    /^docs\/.*release.*(?:\.json|\/README\.md)$/.test(file),
  );
  const before = new Map(baseEntries.map((entry) => [entry.id, entry]));
  for (const id of before.keys())
    if (!entries.some((entry) => entry.id === id))
      throw new Error(`Keep existing changelog entry and permalink: ${id}`);
  // Source and release events are published automatically after merge. Authored
  // notes remain optional enrichment, rather than a prerequisite for ingestion.
  return { runtimeFiles: runtime.length, releaseReceipts: receipts.length };
}

export function run(base) {
  const bytes = fs.readFileSync('site/public/changelog.json');
  if (bytes.length > changelogFeedLimit)
    throw new Error('Changelog feed exceeds the runtime size limit');
  const entries = parseChangelogFeed(JSON.parse(bytes));
  if (
    !entries.some((entry) => entry.layer === 'core') ||
    !entries.some((entry) => entry.layer === 'saas')
  )
    throw new Error('The changelog must document both core and SaaS updates');
  const archive = readArchive(process.cwd());
  if (!archive.index)
    throw new Error('The permanent changelog archive is missing');
  const legacyRaw = JSON.parse(
    fs.readFileSync('site/public/changelog-legacy.json', 'utf8'),
  );
  const legacy = parseChangelogFeed(legacyRaw);
  for (const entry of legacy)
    if (
      !archive.entries.has(entry.id) ||
      archive.locations.get(entry.id) !== legacyRaw.locations[entry.id]
    )
      throw new Error('A legacy changelog entry was lost');
  const notesDirectory = 'changelog-notes';
  if (fs.existsSync(notesDirectory))
    for (const name of fs
      .readdirSync(notesDirectory)
      .filter((name) => name.endsWith('.json'))) {
      const note = parseChangelogFeed({
        version: 1,
        entries: [
          JSON.parse(fs.readFileSync(path.join(notesDirectory, name), 'utf8')),
        ],
      })[0];
      if (name !== note.id + '.json')
        throw new Error('Curated note filenames must match their stable IDs');
      const existing = archive.entries.get(note.id);
      if (
        existing &&
        (existing.layer !== note.layer ||
          existing.date.slice(0, 4) !== note.date.slice(0, 4))
      )
        throw new Error('A published archive identity cannot move');
    }
  let result = {};
  if (base && !/^0+$/.test(base)) {
    if (!/^[a-f0-9]{40}$/.test(base))
      throw new Error('Changelog base must be a Git commit SHA');
    try {
      execFileSync('git', ['cat-file', '-e', `${base}^{commit}`], {
        stdio: 'ignore',
      });
    } catch {
      execFileSync('git', ['fetch', '--no-tags', '--depth=1', 'origin', base], {
        stdio: 'pipe',
        timeout: 30000,
      });
    }
    const files = execFileSync('git', ['diff', '--name-only', base, 'HEAD'], {
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter(Boolean);
    let previous;
    try {
      previous = execFileSync(
        'git',
        ['show', `${base}:site/public/changelog.json`],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch {
      // One-time introduction: validate the existing bundled history at the base.
      const legacy = execFileSync(
        'git',
        ['show', `${base}:src/hosted/changelog-entries.ts`],
        { encoding: 'utf8' },
      );
      const ids = [...legacy.matchAll(/id: '([^']+)'/g)].map(
        (match) => match[1],
      );
      if (!ids.length)
        throw new Error('Cannot establish the base changelog history');
      const preserved = entries.filter((entry) => ids.includes(entry.id));
      if (preserved.length !== ids.length)
        throw new Error('Existing changelog history was lost');
      previous = JSON.stringify({ version: 1, entries: preserved });
    }
    let priorArchive;
    try {
      priorArchive = execFileSync(
        'git',
        ['show', `${base}:site/public/changelog-index.json`],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch {
      /* Initial archive introduction. */
    }
    if (priorArchive) {
      const raw = JSON.parse(priorArchive);
      let index;
      if (raw.version === 3) {
        const root = parseArchiveRoot(raw),
          parts = [];
        for (const group of root.indexes) {
          const bytes = execFileSync(
            'git',
            ['show', `${base}:site/public/${group.path}`],
            { stdio: ['ignore', 'pipe', 'pipe'] },
          );
          if (archiveHash(bytes) !== group.sha256)
            throw new Error('Base archive index integrity failure');
          parts.push(...parseArchiveIndex(JSON.parse(bytes)).parts);
        }
        index = parseArchiveIndex({
          version: 2,
          totalEntries: root.totalEntries,
          parts,
          state: root.state,
        });
      } else index = parseArchiveIndex(raw);
      for (const part of index.parts) {
        const bytes = execFileSync(
          'git',
          ['show', `${base}:site/public/${part.path}`],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        );
        if (archiveHash(bytes) !== part.sha256)
          throw new Error('Base archive integrity failure');
        for (const old of parseChangelogFeed(JSON.parse(bytes))) {
          const current = archive.entries.get(old.id);
          if (
            !current ||
            archive.locations.get(old.id) !== part.id ||
            current.layer !== old.layer
          )
            throw new Error(
              'Published archive identity or location was removed: ' + old.id,
            );
          for (const link of old.links)
            if (!current.links.some((item) => item.url === link.url))
              throw new Error('Historical source evidence was removed');
        }
      }
    }
    let previousLegacy;
    try {
      previousLegacy = execFileSync(
        'git',
        ['show', `${base}:site/public/changelog-legacy.json`],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } catch {
      previousLegacy = previous;
    }
    for (const entry of parseChangelogFeed(JSON.parse(previousLegacy)))
      if (!legacy.some((item) => item.id === entry.id))
        throw new Error('A legacy root permalink was removed: ' + entry.id);
    result = checkChangelogChange(
      parseChangelogFeed(JSON.parse(previous)),
      entries,
      files,
    );
  }
  console.log(
    JSON.stringify({ valid: true, entries: entries.length, ...result }),
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  run(process.env.CHANGELOG_BASE_SHA || process.argv[2]);
