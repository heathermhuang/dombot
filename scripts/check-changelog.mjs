import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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
  if (
    runtime.length &&
    !entries.some((entry) => entry.layer === 'saas' && !before.has(entry.id))
  )
    throw new Error(
      'Application changes require a new SaaS entry in site/public/changelog.json. Describe merged source separately from verified deployment.',
    );
  if (
    receipts.length &&
    !entries.some(
      (entry) => JSON.stringify(entry) !== JSON.stringify(before.get(entry.id)),
    )
  )
    throw new Error(
      'Release receipts require a matching changelog update, including verified rollout status and evidence.',
    );
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
