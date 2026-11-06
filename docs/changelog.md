# Automatic changelog and permanent history

The release archive is published by `changelog-sync.yml` when main changes, a
GitHub release is published/edited, or the desktop release workflow completes.
A quarter-hour scheduled catch-up handles upstream changes and manual gateway
releases. The nightly reconciliation traverses all release and merged-PR pages,
including old drafts published later. GitHub scheduling/source availability can
introduce delays; the page does not promise instantaneous provider delivery.

The publisher uses GitHub's ordinary temporary workflow token and public source
metadata. It requires no new production secret, customer binding, model task or
Cloudflare write authority. The public gateway is observed through `/health`.

## Automatically captured events

- All published upstream and maintained-fork releases, including prereleases and
  arbitrary release tags; drafts are excluded. Release IDs remain stable.
- All merged SaaS PRs, including historical release branches, and primary-branch
  source integrations in both repositories. Source merge is not deployment.
- New published release receipts explicitly marked `deployed_and_verified`.
  Their linked evidence defines the scope; their publication date is labelled.
- Changed public gateway source revisions, qualified against the public source
  repository. These are observations, not fabricated deployment timestamps or
  proof that every tenant engine was rolled out.

Authored notes are optional enrichment in `changelog-notes/<id>.json`; no person
has to add a note to make a future release appear. Existing curated history is
retained. Notes and upstream records can enrich an existing stable ID, but cannot
remove historical evidence links or move an ID to a different archive location.

## Permanent paged archive

`site/public/changelog-index.json` locates bounded year/range subindexes in
`site/public/changelog-archive-index/`, which locate the append-only pages in
`site/public/changelog-archive/`. Each page contains at most 100 entries and is
size-bounded. The total archive and its subindexes are not capped at 1,000 entries/pages and have no date or
age cutoff. New pages are allocated as needed. Existing IDs, source links and
archive-page locations are never removed; Git retains past metadata revisions.

Every publication validates every page's digest, unique IDs, counts, references
and index totals before writing/pushing. A failed page fetch, incomplete API
pagination, rate limit or concurrent main push fails the job without publishing
partial data or advancing its checkpoint. The next sync reconciles it. Normal
non-force pushes and one publisher concurrency group preserve other work.

The page loads bounded archive pages and provides year, older/newer and beginning
links. Original root-fragment URLs remain available from the fixed legacy
snapshot, refreshed from their permanent pages. New entries use stable
`/changelog?archive=<page-id>#<entry-id>` addresses. Pagination changes what is
shown on one view; it never discards older records.

## Efficient and honest refresh

Scheduled checks start with small head-page fingerprints. Unchanged sources stop
without rewriting files or committing a clock heartbeat. The nightly full pass
catches older/backdated records that a recent head page cannot reveal. Bot archive
commits are recognized by their actual data-only files to avoid self-trigger loops.

The gateway caches successful archive reads for five minutes. Individual origin
reads have three-second deadlines, manual redirect refusal and byte limits. Page
hashes/counts are checked against the index. Failed refreshes retain last-good
cached data with an explicit stale notice and one-minute retry backoff. A later
uncached archive page that cannot be loaded returns 503, never a fake empty page.
The original legacy snapshot remains readable when the source is unavailable.

The first core source record is 30 August 2026 UTC; hosted source starts on
9 September. The historical inventory protects eight initial upstream releases,
two fork releases, 268 core source references and 169 merged SaaS references.
The automatic publisher extends that archive without truncating the baseline.

## Commands and verification

- `npm run changelog:sync` reconciles source events and writes archive data.
  `-- --full` forces complete pagination. CI supplies `GH_TOKEN`; local automated
  tests use public fixtures without credentials.
- `npm run changelog:check` validates all published pages and baseline IDs.
  `CHANGELOG_BASE_SHA=<base>` also rejects removal or relocation of any previously
  published archive identity/evidence.
- `workflow_dispatch` can run a bounded catch-up. It is not needed for routine
  publication; scheduled/event triggers continue after the agent finishes.

Tests cover multiple API pages, prereleases, failed/incomplete pagination,
unchanged runs, deployment/source distinctions, more than 1,000 archived entries,
all-page traversal, stable legacy/new URLs, integrity failures and native Workers
fetch/cache behavior. This remains a gateway-only code release; archive updates
need no gateway deploy, tenant rollout or database migration.
