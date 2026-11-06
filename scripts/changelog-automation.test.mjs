import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readArchive, writeArchive } from './changelog-archive.mjs';
import { GithubArchiveClient, synchronizeArchive } from './sync-changelog.mjs';
import { parseArchiveIndex } from '../src/hosted/changelog-archive-schema';
import feed from '../site/public/changelog-legacy.json';
const dirs = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});
function root() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'changelog-archive-test-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, 'site/public'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs'));
  for (const name of ['changelog.json', 'changelog-legacy.json'])
    fs.writeFileSync(path.join(dir, 'site/public', name), JSON.stringify(feed));
  fs.writeFileSync(
    path.join(dir, 'docs/changelog-history-inventory-20261106.json'),
    JSON.stringify({
      upstreamSnapshot: 'a'.repeat(40),
      saasSnapshot: 'b'.repeat(40),
    }),
  );
  writeArchive(dir, feed.entries);
  return dir;
}
const release = (
  id,
  repo = 'aoxborrow/dombot',
  tag = 'v9.0.' + id,
  pre = false,
) => ({
  id,
  tag_name: tag,
  name: tag,
  published_at: '2026-11-06T01:00:00Z',
  draft: false,
  prerelease: pre,
  html_url: `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`,
});
function apiFixture({ fail = false } = {}) {
  const data = new Map([
    [
      '/repos/aoxborrow/dombot/releases?per_page=30',
      [release(101), { ...release(102), draft: true }],
    ],
    [
      '/repos/aoxborrow/dombot/releases?per_page=30&page=2',
      [release(103, 'aoxborrow/dombot', 'v9.0.1-beta.1', true)],
    ],
    [
      '/repos/heathermhuang/dombot/releases?per_page=30',
      [release(201, 'heathermhuang/dombot', 'nightly-2026-11-06', true)],
    ],
    [
      '/repos/heathermhuang/dombot/pulls?state=closed&sort=updated&direction=desc&per_page=30',
      [
        {
          number: 900,
          title: 'A new service improvement',
          merged_at: '2026-11-06T02:00:00Z',
          merge_commit_sha: 'c'.repeat(40),
          html_url: 'https://github.com/heathermhuang/dombot/pull/900',
          base: { ref: 'main' },
        },
      ],
    ],
    [
      '/repos/heathermhuang/dombot/pulls/900/files?per_page=100',
      [{ filename: 'docs/fixture-release.json', status: 'added' }],
    ],
    [
      '/repos/heathermhuang/dombot/contents/docs/fixture-release.json?ref=' +
        'c'.repeat(40),
      {
        encoding: 'base64',
        content: Buffer.from(
          JSON.stringify({
            status: 'deployed_and_verified',
            releaseCommit: 'd'.repeat(40),
            engine: '9.0.0-hosted.1',
          }),
        ).toString('base64'),
      },
    ],
    [
      '/repos/aoxborrow/dombot/commits/main',
      {
        sha: 'a'.repeat(40),
        parents: [],
        files: [],
        commit: { message: 'Core checkpoint' },
      },
    ],
    [
      '/repos/heathermhuang/dombot/commits/main',
      {
        sha: 'b'.repeat(40),
        parents: [],
        files: [],
        commit: { message: 'SaaS checkpoint' },
      },
    ],
    [
      '/repos/heathermhuang/dombot/commits/' + 'd'.repeat(40),
      { sha: 'd'.repeat(40), commit: { message: 'A verified source update' } },
    ],
  ]);
  const client = new GithubArchiveClient({
    token: 'fixture-only',
    fetcher: async (url) => {
      const key = new URL(url).pathname + new URL(url).search;
      if (fail && key.includes('page=2')) throw Error('injected page failure');
      if (!data.has(key)) throw Error('Unexpected fixture request ' + key);
      return Response.json(data.get(key), {
        headers:
          key === '/repos/aoxborrow/dombot/releases?per_page=30'
            ? {
                Link: '<https://api.github.com/repositories/12345/releases?per_page=30&page=2>; rel="next"',
              }
            : {},
      });
    },
  });
  client.fixtureData = data;
  return client;
}
const health = async () =>
  Response.json({
    ok: true,
    service: 'domains.domains',
    source: 'd'.repeat(40),
  });
function bytes(root) {
  return fs
    .readdirSync(path.join(root, 'site/public/changelog-archive'))
    .sort()
    .map((file) => [
      file,
      fs.readFileSync(
        path.join(root, 'site/public/changelog-archive', file),
        'utf8',
      ),
    ])
    .concat([
      [
        'index',
        fs.readFileSync(
          path.join(root, 'site/public/changelog-index.json'),
          'utf8',
        ),
      ],
    ]);
}

describe('automatic append-only release archive', () => {
  it('captures every paginated publication, prereleases, merged changes, evidence and observed service versions', async () => {
    const dir = root();
    const result = await synchronizeArchive({
      root: dir,
      api: apiFixture(),
      fetchPublic: health,
      now: '2026-11-06T03:00:00Z',
      full: true,
    });
    const archive = readArchive(dir);
    expect(result.added).toBe(6);
    expect(archive.entries.has('auto-core-release-101')).toBe(true);
    expect(archive.entries.has('auto-core-release-102')).toBe(false);
    expect(archive.entries.get('auto-core-release-103').status).toContain(
      'prerelease',
    );
    expect(archive.entries.get('auto-saas-release-201').title).toContain(
      'nightly',
    );
    expect(archive.entries.get('auto-saas-pr-900').status).toContain(
      'Merged SaaS source',
    );
    expect(
      [...archive.entries.values()].some((entry) =>
        entry.status.startsWith('Verified release evidence'),
      ),
    ).toBe(true);
    expect(
      archive.entries.get('auto-saas-gateway-' + 'd'.repeat(40) + '-1').date,
    ).toBe('2026-11-06');
    expect(
      archive.entries.get('auto-saas-gateway-' + 'd'.repeat(40) + '-1').status,
    ).toContain('observed');
    for (const entry of feed.entries)
      expect(archive.entries.has(entry.id)).toBe(true);
  });
  it('does not write a heartbeat, duplicate entries or discard history when sources are unchanged', async () => {
    const dir = root();
    await synchronizeArchive({
      root: dir,
      api: apiFixture(),
      fetchPublic: health,
      now: '2026-11-06T03:00:00Z',
      full: true,
    });
    const before = bytes(dir);
    const next = await synchronizeArchive({
      root: dir,
      api: apiFixture(),
      fetchPublic: health,
      now: '2026-11-07T03:00:00Z',
    });
    expect(next.added).toBe(0);
    expect(bytes(dir)).toEqual(before);
  });
  it('publishes nothing when any source page fails', async () => {
    const dir = root(),
      before = bytes(dir);
    await expect(
      synchronizeArchive({
        root: dir,
        api: apiFixture({ fail: true }),
        fetchPublic: health,
        full: true,
      }),
    ).rejects.toThrow('page failure');
    expect(bytes(dir)).toEqual(before);
  });
  it('reconciles older publications on a forced full pass even when the head fingerprint is unchanged', async () => {
    const dir = root();
    await synchronizeArchive({
      root: dir,
      api: apiFixture(),
      fetchPublic: health,
      full: true,
    });
    const api = apiFixture();
    const original = api.get.bind(api);
    api.get = async (url) =>
      url.includes('page=2')
        ? {
            value: [
              release(103, 'aoxborrow/dombot', 'v9.0.1-beta.1', true),
              release(104, 'aoxborrow/dombot', 'backdated-preview', true),
            ],
            next: null,
          }
        : original(url);
    const result = await synchronizeArchive({
      root: dir,
      api,
      fetchPublic: health,
      full: true,
    });
    expect(result.added).toBe(1);
    expect(readArchive(dir).entries.has('auto-core-release-104')).toBe(true);
  });
  it('grows past 1000 entries using bounded pages while keeping old IDs, links and locations', () => {
    const dir = root(),
      before = readArchive(dir),
      extra = Array.from({ length: 1200 }, (_, i) => ({
        ...feed.entries[0],
        id: 'future-release-' + i,
        title: 'Future release ' + i,
      }));
    const result = writeArchive(dir, extra);
    expect(result.index.totalEntries).toBe(feed.entries.length + 1200);
    expect(result.index.parts.length).toBeGreaterThan(10);
    expect(result.index.parts.every((part) => part.count <= 100)).toBe(true);
    const after = readArchive(dir);
    for (const [id, entry] of before.entries) {
      expect(after.locations.get(id)).toBe(before.locations.get(id));
      expect(after.entries.get(id).links).toEqual(entry.links);
    }
    expect(parseArchiveIndex(result.index).totalEntries).toBeGreaterThan(1000);
  });
  it('refuses historical page tampering instead of repairing it by dropping entries', () => {
    const dir = root(),
      archive = readArchive(dir),
      part = archive.index.parts[0];
    fs.writeFileSync(path.join(dir, 'site/public', part.path), '{}');
    expect(() => writeArchive(dir, [feed.entries[0]])).toThrow('integrity');
  });
  it('keeps historical evidence when an existing note is enriched', () => {
    const dir = root(),
      old = feed.entries[0];
    writeArchive(dir, [
      {
        ...old,
        links: [
          {
            label: 'A new reference',
            url: 'https://github.com/heathermhuang/dombot/pull/999',
          },
        ],
      },
    ]);
    const current = readArchive(dir).entries.get(old.id);
    for (const link of old.links) expect(current.links).toContainEqual(link);
  });
});

it('wires event, catch-up and full reconciliation paths without untrusted privileged PR execution', () => {
  const workflow = fs.readFileSync(
      '.github/workflows/changelog-sync.yml',
      'utf8',
    ),
    releaseWorkflow = fs.readFileSync('.github/workflows/release.yml', 'utf8');
  expect(workflow).toContain('branches: [main]');
  expect(workflow).toContain('types: [published, edited]');
  expect(workflow).toContain('7,22,37,52 * * * *');
  expect(workflow).toContain('19 18 * * *');
  expect(workflow).toContain('workflow_call:');
  expect(workflow).not.toContain('pull_request_target');
  expect(workflow).toContain('pull-requests: read');
  expect(workflow).toContain('git push origin HEAD:main');
  expect(workflow).not.toContain('--force');
  expect(releaseWorkflow).toContain(
    'uses: ./.github/workflows/changelog-sync.yml',
  );
  expect(releaseWorkflow).toContain('full: true');
});

it('skips archive-page reads on an unchanged checkpoint', async () => {
  const dir = root();
  await synchronizeArchive({
    root: dir,
    api: apiFixture(),
    fetchPublic: health,
    full: true,
  });
  const archive = path.join(dir, 'site/public/changelog-archive');
  fs.renameSync(archive, archive + '-offline');
  try {
    const result = await synchronizeArchive({
      root: dir,
      api: apiFixture(),
      fetchPublic: health,
      ensureArchive: async () => {
        throw Error(
          'Unchanged sources must stop before materializing archive pages',
        );
      },
    });
    expect(result.unchanged).toBe(true);
  } finally {
    fs.renameSync(archive + '-offline', archive);
  }
});
it('does not create self-trigger bookkeeping commits after consecutive archive publications', async () => {
  const dir = root(),
    api = apiFixture();
  await synchronizeArchive({ root: dir, api, fetchPublic: health, full: true });
  api.fixtureData.set('/repos/heathermhuang/dombot/commits/main', {
    sha: 'e'.repeat(40),
    parents: [{ sha: 'b'.repeat(40) }],
    files: [{ filename: 'site/public/changelog-index.json' }],
    commit: { message: 'changelog: synchronize release archive' },
  });
  api.fixtureData.set('/repos/heathermhuang/dombot/commits/' + 'f'.repeat(40), {
    sha: 'f'.repeat(40),
    commit: { message: 'Another qualified service source' },
  });
  const publicHealth = async () =>
    Response.json({
      ok: true,
      service: 'domains.domains',
      source: 'f'.repeat(40),
    });
  const observed = await synchronizeArchive({
    root: dir,
    api,
    fetchPublic: publicHealth,
  });
  expect(observed.added).toBe(1);
  api.fixtureData.set('/repos/heathermhuang/dombot/commits/main', {
    sha: '1'.repeat(40),
    parents: [{ sha: 'e'.repeat(40) }],
    files: [{ filename: 'site/public/changelog-index.json' }],
    commit: { message: 'changelog: synchronize release archive' },
  });
  const before = bytes(dir);
  const unchanged = await synchronizeArchive({
    root: dir,
    api,
    fetchPublic: publicHealth,
  });
  expect(unchanged.unchanged).toBe(true);
  expect(bytes(dir)).toEqual(before);
});

it('records a return to a previously observed source as a new observation', async () => {
  const dir = root(),
    api = apiFixture();
  await synchronizeArchive({
    root: dir,
    api,
    fetchPublic: health,
    now: '2026-11-06T03:00:00Z',
    full: true,
  });
  api.fixtureData.set('/repos/heathermhuang/dombot/commits/' + 'f'.repeat(40), {
    sha: 'f'.repeat(40),
    commit: { message: 'Another service source' },
  });
  await synchronizeArchive({
    root: dir,
    api,
    fetchPublic: async () =>
      Response.json({
        ok: true,
        service: 'domains.domains',
        source: 'f'.repeat(40),
      }),
    now: '2026-11-07T03:00:00Z',
  });
  const result = await synchronizeArchive({
    root: dir,
    api,
    fetchPublic: health,
    now: '2026-11-08T03:00:00Z',
  });
  expect(result.added).toBe(1);
  const records = readArchive(dir).entries;
  expect(records.get('auto-saas-gateway-' + 'd'.repeat(40) + '-1').date).toBe(
    '2026-11-06',
  );
  expect(records.get('auto-saas-gateway-' + 'd'.repeat(40) + '-3').date).toBe(
    '2026-11-08',
  );
});
it('retains an original release when the provider republishes it on another date', async () => {
  const dir = root(),
    api = apiFixture();
  await synchronizeArchive({ root: dir, api, fetchPublic: health, full: true });
  const rows = api.fixtureData.get(
    '/repos/aoxborrow/dombot/releases?per_page=30',
  );
  rows[0] = { ...rows[0], published_at: '2027-01-02T01:00:00Z' };
  await synchronizeArchive({ root: dir, api, fetchPublic: health, full: true });
  const records = readArchive(dir).entries;
  expect(records.get('auto-core-release-101').date).toBe('2026-11-06');
  expect(
    [...records.values()].some(
      (entry) =>
        entry.id.startsWith('auto-core-release-101-publication-') &&
        entry.date === '2027-01-02',
    ),
  ).toBe(true);
});
