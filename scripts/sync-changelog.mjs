import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseArchiveRoot } from '../src/hosted/changelog-archive-schema.ts';
import { readArchive, writeArchive } from './changelog-archive.mjs';
const owner = 'heathermhuang/dombot',
  upstream = 'aoxborrow/dombot';
const fingerprint = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const short = (value) => String(value).slice(0, 12);
const day = (value) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw Error('Invalid source date');
  return date.toISOString().slice(0, 10);
};
const title = (value) =>
  String(value || 'Published source update').slice(0, 200);
export class GithubArchiveClient {
  constructor({ token = process.env.GH_TOKEN, fetcher = fetch } = {}) {
    this.token = token;
    this.fetcher = fetcher;
  }
  async get(url) {
    const parsed = new URL(url, 'https://api.github.com');
    if (
      parsed.origin !== 'https://api.github.com' ||
      ![owner, upstream].some((repo) =>
        parsed.pathname.startsWith('/repos/' + repo + '/'),
      )
    )
      throw Error('Unexpected GitHub archive source');
    const response = await this.fetcher(parsed.toString(), {
      headers: {
        Accept: 'application/vnd.github+json',
        ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}),
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw Error('GitHub archive read failed: ' + response.status);
    }
    const reader = response.body.getReader(),
      chunks = [];
    let size = 0;
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        size += item.value.byteLength;
        if (size > 8_000_000) throw Error('GitHub response exceeds safe size');
        chunks.push(item.value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
    const bytes = Buffer.concat(chunks);
    const linked = response.headers
      .get('link')
      ?.match(/<([^>]+)>; rel="next"/)?.[1];
    let next = null;
    if (linked) {
      const target = new URL(linked);
      const suffix = parsed.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, '');
      if (
        target.origin !== parsed.origin ||
        target.username ||
        target.password ||
        !(
          target.pathname === parsed.pathname ||
          new RegExp(
            '^/repositories/[0-9]+' +
              suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
              '$',
          ).test(target.pathname)
        )
      )
        throw Error('Unexpected GitHub pagination source');
      const page = Number(target.searchParams.get('page'));
      if (
        !Number.isSafeInteger(page) ||
        page !== Number(parsed.searchParams.get('page') || 1) + 1 ||
        target.searchParams.get('per_page') !==
          parsed.searchParams.get('per_page')
      )
        throw Error('GitHub pagination skipped or changed a page');
      // Canonical-ID links never select a different repository: retain the
      // original allowlisted path and copy only the sequential page number.
      const canonical = new URL(parsed);
      canonical.searchParams.set('page', String(page));
      next = canonical.toString();
    }
    return { value: JSON.parse(bytes.toString('utf8')), next };
  }
  async list(url) {
    const result = [];
    const seen = new Set();
    for (let next = url; next;) {
      if (seen.has(next)) throw Error('GitHub pagination loop');
      seen.add(next);
      const page = await this.get(next);
      if (!Array.isArray(page.value)) throw Error('Invalid GitHub collection');
      result.push(...page.value);
      next = page.next;
    }
    return result;
  }
  async changedList(url, previous, force, normalize) {
    const first = await this.get(url);
    if (!Array.isArray(first.value)) throw Error('Invalid GitHub collection');
    const signature = fingerprint(normalize(first.value));
    if (!force && signature === previous)
      return { items: [], signature, unchanged: true };
    const items = [...first.value],
      seen = new Set([url]);
    let next = first.next;
    while (next) {
      if (seen.has(next)) throw Error('GitHub pagination loop');
      seen.add(next);
      const page = await this.get(next);
      if (!Array.isArray(page.value)) throw Error('Invalid GitHub collection');
      items.push(...page.value);
      next = page.next;
    }
    return { items, signature, unchanged: false };
  }
}
function releaseEntry(release, repo) {
  if (release.draft || !release.published_at) return null;
  const base = 'https://github.com/' + repo;
  const url = String(release.html_url),
    tag = String(release.tag_name);
  if (
    !Number.isSafeInteger(release.id) ||
    !url.startsWith(base + '/releases/tag/') ||
    decodeURIComponent(
      new URL(url).pathname.slice(('/' + repo + '/releases/tag/').length),
    ) !== tag
  )
    throw Error('Invalid published release identity');
  const core = repo === upstream;
  return {
    id: `auto-${core ? 'core' : 'saas'}-release-${release.id}`,
    date: day(release.published_at),
    layer: core ? 'core' : 'saas',
    title: title(
      core ? 'DomBot ' + tag.replace(/^v/, '') : 'Maintained fork ' + tag,
    ),
    status: release.prerelease
      ? 'Published prerelease · Hosted availability tracked separately'
      : core
        ? 'Released upstream · Hosted rollout tracked separately'
        : 'Published fork release · Hosted deployment verified separately',
    changes: [
      'Published release notes and downloads are available in the linked project release. This publication does not infer a managed tenant rollout.',
    ],
    links: [
      {
        label: release.prerelease
          ? 'Published prerelease'
          : 'Published release',
        url,
      },
    ],
  };
}
function commitTitle(commit) {
  const message = String(commit.commit?.message ?? commit.message ?? '');
  const lines = message.split('\n').filter((line) => line.trim());
  return title(
    /^Merge pull request/.test(lines[0] ?? '')
      ? (lines[1] ?? lines[0])
      : lines[0],
  );
}
async function primaryChanges(api, repo, base, head) {
  if (base === head) return [];
  if (!/^[a-f0-9]{40}$/.test(base) || !/^[a-f0-9]{40}$/.test(head))
    throw Error('Invalid source revision');
  const url = `/repos/${repo}/compare/${base}...${head}?per_page=100`;
  const commits = [];
  let expected;
  const seen = new Set();
  for (let next = url; next;) {
    if (seen.has(next)) throw Error('Compare pagination loop');
    seen.add(next);
    const result = await api.get(next);
    if (!Array.isArray(result.value.commits))
      throw Error('Invalid commit comparison');
    expected ??= result.value.total_commits;
    commits.push(...result.value.commits);
    next = result.next;
  }
  if (commits.length !== expected)
    throw Error('Incomplete source comparison; refusing partial history');
  const bySha = new Map(commits.map((commit) => [commit.sha, commit]));
  const primary = [];
  let sha = head;
  while (sha !== base) {
    const commit = bySha.get(sha);
    if (!commit)
      throw Error(
        'Source history rewrote its checkpoint; refusing partial publication',
      );
    primary.push(commit);
    sha = commit.parents?.[0]?.sha;
  }
  return primary;
}
async function probeSources(root, api, fetchPublic, full) {
  const file = path.join(root, 'site/public/changelog-index.json');
  const index = fs.existsSync(file)
    ? parseArchiveRoot(JSON.parse(fs.readFileSync(file, 'utf8')))
    : null;
  const previous = structuredClone(index?.state ?? {}),
    state = structuredClone(previous),
    releaseResults = new Map();
  const signatures = { ...(state.signatures ?? {}) };
  for (const repo of [upstream, owner]) {
    const result = await api.changedList(
      `/repos/${repo}/releases?per_page=30`,
      signatures[repo + ':releases'],
      full || !index,
      (items) =>
        items
          .filter((item) => !item.draft && item.published_at)
          .map((item) => [
            item.id,
            item.tag_name,
            item.name,
            item.published_at,
            item.prerelease,
          ]),
    );
    releaseResults.set(repo, result);
    signatures[repo + ':releases'] = result.signature;
  }
  const pulls = await api.changedList(
    `/repos/${owner}/pulls?state=closed&sort=updated&direction=desc&per_page=30`,
    signatures.pulls,
    full || !index,
    (items) =>
      items.map((item) => [
        item.number,
        item.title,
        item.merged_at,
        item.merge_commit_sha,
        item.base?.ref,
      ]),
  );
  signatures.pulls = pulls.signature;
  state.signatures = signatures;
  const heads = {};
  let ignoreMain = false;
  for (const [repo, key] of [
    [upstream, 'upstreamHead'],
    [owner, 'mainHead'],
  ]) {
    const head = (await api.get(`/repos/${repo}/commits/main`)).value;
    if (!/^[a-f0-9]{40}$/.test(head.sha ?? ''))
      throw Error('Invalid source head');
    heads[repo] = head;
    if (
      repo === owner &&
      head.parents?.[0]?.sha ===
        (previous.archiveParent ?? previous.mainHead) &&
      Array.isArray(head.files) &&
      head.files.length &&
      head.files.every((item) =>
        /^site\/public\/changelog-(?:index\.json|archive(?:-index)?\/)/.test(
          item.filename,
        ),
      )
    ) {
      ignoreMain = true;
      continue;
    }
    state[key] = head.sha;
  }
  const response = await fetchPublic('https://domains.domains/health', {
    headers: { Accept: 'application/json' },
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw Error('Public deployment observation unavailable');
  const health = await response.json();
  if (
    health.ok !== true ||
    health.service !== 'domains.domains' ||
    !/^[a-f0-9]{40}$/.test(health.source ?? '')
  )
    throw Error('Invalid public deployment observation');
  let healthCommit;
  if (previous.gatewaySource !== health.source) {
    healthCommit = (await api.get(`/repos/${owner}/commits/${health.source}`))
      .value;
    if (healthCommit.sha !== health.source)
      throw Error('Observed source is not qualified by the public repository');
  }
  state.gatewaySource = health.source;
  const noteDir = path.join(root, 'changelog-notes');
  const noteFiles = fs.existsSync(noteDir)
    ? fs
        .readdirSync(noteDir)
        .filter((name) => /^[a-z0-9-]+\.json$/.test(name))
        .sort()
    : [];
  state.curationFingerprint = fingerprint([
    fs.readFileSync(path.join(root, 'site/public/changelog.json'), 'utf8'),
    ...noteFiles.map((name) => [
      name,
      fs.readFileSync(path.join(noteDir, name), 'utf8'),
    ]),
  ]);
  return {
    index,
    previous,
    state,
    releaseResults,
    pulls,
    heads,
    ignoreMain,
    health,
    healthCommit,
    unchanged: !!index && !full && fingerprint(previous) === fingerprint(state),
  };
}

export async function synchronizeArchive({
  root = process.cwd(),
  api = new GithubArchiveClient(),
  fetchPublic = fetch,
  now = new Date().toISOString(),
  full = false,
  ensureArchive,
} = {}) {
  const probe = await probeSources(root, api, fetchPublic, full);
  if (probe.unchanged)
    return {
      entries: probe.index.totalEntries,
      added: 0,
      sourcesChecked: 3,
      parts: probe.index.years.reduce((sum, year) => sum + year.lastPart, 0),
      gatewaySource: probe.health.source,
      unchanged: true,
      changed: false,
    };
  if (ensureArchive) await ensureArchive();
  const existing = readArchive(root),
    state = probe.state,
    records = new Map(existing.entries);
  const legacy = JSON.parse(
    fs.readFileSync(
      path.join(root, 'site/public/changelog-legacy.json'),
      'utf8',
    ),
  ).entries;
  const curated = JSON.parse(
    fs.readFileSync(path.join(root, 'site/public/changelog.json'), 'utf8'),
  ).entries;
  const noteDir = path.join(root, 'changelog-notes');
  const notes = fs.existsSync(noteDir)
    ? fs
        .readdirSync(noteDir)
        .filter((name) => /^[a-z0-9-]+\.json$/.test(name))
        .map((name) =>
          JSON.parse(fs.readFileSync(path.join(noteDir, name), 'utf8')),
        )
    : [];
  for (const entry of [...legacy, ...curated, ...notes])
    records.set(entry.id, entry);
  const knownUrl = () => {
    const urls = new Map();
    for (const entry of records.values())
      for (const link of entry.links) urls.set(link.url, entry.id);
    return urls;
  };
  const signatures = { ...(state.signatures ?? {}) },
    releaseIds = { ...(state.releaseIds ?? {}) };
  let sourcesChecked = 0;
  for (const repo of [upstream, owner]) {
    const result = probe.releaseResults.get(repo);
    sourcesChecked++;
    signatures[repo + ':releases'] = result.signature;
    for (const release of result.items) {
      const generated = releaseEntry(release, repo);
      if (!generated) continue;
      const key = repo + ':' + release.id;
      const id =
        releaseIds[key] ??
        knownUrl().get(generated.links[0].url) ??
        generated.id;
      // Automatic release IDs are self-locating. Keep only the small curated
      // alias set in the root checkpoint, not one root record per future release.
      if (!id.startsWith('auto-')) releaseIds[key] = id;
      if (records.has(id) && records.get(id).date !== generated.date) {
        const republication =
          generated.id +
          '-publication-' +
          fingerprint(release.published_at).slice(0, 12);
        records.set(republication, {
          ...generated,
          id: republication,
          title: title(generated.title + ' (republished)'),
        });
      } else if (!records.has(id) || id.startsWith('auto-'))
        records.set(id, { ...generated, id });
    }
  }
  const pulls = probe.pulls;
  signatures.pulls = pulls.signature;
  sourcesChecked++;
  const mergeShas = new Set();
  for (const pr of pulls.items) {
    if (!pr.merged_at) continue;
    if (
      !Number.isSafeInteger(pr.number) ||
      (pr.merge_commit_sha && !/^[a-f0-9]{40}$/.test(pr.merge_commit_sha)) ||
      !new RegExp(`^https://github.com/${owner}/pull/[0-9]+$`).test(pr.html_url)
    )
      throw Error('Invalid merged change identity');
    if (pr.merge_commit_sha) mergeShas.add(pr.merge_commit_sha);
    const covered = knownUrl().get(pr.html_url);
    const id = covered ?? `auto-saas-pr-${pr.number}`;
    if (covered && !covered.startsWith('auto-')) continue;
    const wasKnown = records.has(id);
    records.set(id, {
      id,
      date: day(pr.merged_at),
      layer: 'saas',
      title: title(pr.title),
      status: 'Merged SaaS source · Deployment tracked separately',
      changes: [
        `Source change #${pr.number} was merged. The linked review records its details, validation and rollout scope.`,
      ],
      links: [{ label: 'Change #' + pr.number, url: pr.html_url }],
    });
    if (wasKnown || !pr.merge_commit_sha) continue;
    const files = await api.list(
      `/repos/${owner}/pulls/${pr.number}/files?per_page=100`,
    );
    for (const file of files) {
      if (
        file.status === 'removed' ||
        !/^docs\/[A-Za-z0-9_./-]*release[A-Za-z0-9_./-]*\.json$/.test(
          file.filename,
        ) ||
        file.filename.split('/').includes('..')
      )
        continue;
      const content = (
        await api.get(
          `/repos/${owner}/contents/${file.filename}?ref=${pr.merge_commit_sha}`,
        )
      ).value;
      if (content.encoding !== 'base64' || typeof content.content !== 'string')
        throw Error('Release evidence cannot be read completely');
      const receipt = JSON.parse(
        Buffer.from(content.content, 'base64').toString('utf8'),
      );
      if (
        receipt.status !== 'deployed_and_verified' ||
        !/^[a-f0-9]{40}$/.test(receipt.releaseCommit ?? '')
      )
        continue;
      const rid =
        'auto-saas-evidence-' +
        fingerprint([pr.merge_commit_sha, file.filename]).slice(0, 24);
      if (records.has(rid)) continue;
      records.set(rid, {
        id: rid,
        date: day(pr.merged_at),
        layer: 'saas',
        title: title(
          'Verified hosted release record' +
            (typeof receipt.engine === 'string' ? ' ' + receipt.engine : ''),
        ),
        status:
          'Verified release evidence published · Scope follows the linked record',
        changes: [
          'A verified release record was published. Its linked evidence defines the deployed source, engine and validation scope; the date here is its publication date.',
        ],
        links: [
          {
            label: 'Verified release record',
            url: `https://github.com/${owner}/blob/${pr.merge_commit_sha}/${file.filename}`,
          },
        ],
      });
    }
  }
  const inventory = JSON.parse(
    fs.readFileSync(
      path.join(root, 'docs/changelog-history-inventory-20261106.json'),
      'utf8',
    ),
  );
  for (const [repo, key, initial] of [
    [upstream, 'upstreamHead', inventory.upstreamSnapshot],
    [owner, 'mainHead', inventory.saasSnapshot],
  ]) {
    const head = probe.heads[repo];
    const previous = probe.previous[key] ?? initial;
    if (repo === owner && probe.ignoreMain) continue;
    if (previous !== head.sha) {
      const commits = await primaryChanges(api, repo, previous, head.sha);
      for (const commit of commits) {
        const url = `https://github.com/${repo}/commit/${commit.sha}`;
        if (
          knownUrl().has(url) ||
          (repo === owner &&
            (mergeShas.has(commit.sha) ||
              /^Merge pull request/.test(commit.commit?.message ?? '') ||
              /\(#\d+\)/.test(commit.commit?.message ?? '') ||
              String(commit.commit?.message ?? '').startsWith(
                'changelog: synchronize release archive',
              )))
        )
          continue;
        const id = `auto-${repo === owner ? 'saas' : 'core'}-source-${commit.sha}`;
        records.set(id, {
          id,
          date: day(commit.commit.committer.date),
          layer: repo === owner ? 'saas' : 'core',
          title: commitTitle(commit),
          status:
            'Published source change · Release availability tracked separately',
          changes: [
            'This primary-branch source change is recorded in the linked commit. A source merge does not infer a hosted rollout.',
          ],
          links: [{ label: 'Source change ' + short(commit.sha), url }],
        });
      }
    }
    state[key] = head.sha;
  }
  const health = probe.health;
  if (probe.previous.gatewaySource !== health.source) {
    const commit = probe.healthCommit;
    const serial = Number.isSafeInteger(probe.previous.gatewayObservationSerial)
      ? probe.previous.gatewayObservationSerial + 1
      : 1;
    state.gatewayObservationSerial = serial;
    const id = 'auto-saas-gateway-' + health.source + '-' + serial;
    if (!records.has(id))
      records.set(id, {
        id,
        date: day(now),
        layer: 'saas',
        title:
          'Hosted service update observed: ' +
          commitTitle(commit).slice(0, 150),
        status:
          'Gateway deployment observed · Tenant engine rollouts are separate',
        changes: [
          'The public service reports this source revision. This date records the observation, not an inferred deployment time or a fleet-wide tenant rollout.',
        ],
        links: [
          {
            label: 'Observed service source',
            url: `https://github.com/${owner}/commit/${health.source}`,
          },
        ],
      });
    state.gatewaySource = health.source;
  }
  for (const entry of notes) records.set(entry.id, entry);
  state.signatures = signatures;
  state.releaseIds = releaseIds;
  const stripParent = (value) => {
    const copy = { ...value };
    delete copy.archiveParent;
    return copy;
  };
  const sorted = (values) =>
    [...values].sort((a, b) => a.id.localeCompare(b.id));
  if (
    fingerprint(stripParent(state)) !==
      fingerprint(stripParent(existing.index?.state ?? {})) ||
    fingerprint(sorted(records.values())) !==
      fingerprint(sorted(existing.entries.values()))
  )
    state.archiveParent = probe.heads[owner].sha;
  // No timestamp heartbeat: identical sources produce no archive or Git change.
  const output = writeArchive(root, [...records.values()], state);
  return {
    entries: output.index.totalEntries,
    added: output.added,
    sourcesChecked,
    parts: output.index.parts.length,
    gatewaySource: health.source,
    changed: output.changed,
    unchanged: !output.changed,
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const full =
    process.argv.includes('--full') ||
    process.env.CHANGELOG_FULL_RECONCILE === 'true';
  const result = await synchronizeArchive({
    full,
    ensureArchive:
      process.env.GITHUB_ACTIONS === 'true'
        ? async () => {
            execFileSync(
              'git',
              [
                'sparse-checkout',
                'add',
                '/site/public/changelog-archive/**',
                '/site/public/changelog-archive-index/**',
              ],
              { stdio: 'pipe' },
            );
          }
        : undefined,
  });
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `changed=${result.changed ? 'true' : 'false'}\n`,
    );
  console.log(JSON.stringify(result));
}
