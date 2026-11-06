# Public changelog upkeep

`/changelog` reads two public, fixed sources on demand:

- SaaS notes: `heathermhuang/dombot/main/site/public/changelog.json`.
- Core releases: `aoxborrow/dombot/main/site/public/releases.json`, maintained by
  the original project's release workflow after publication.

Successful reads are cached for five minutes. New SaaS notes reach the page
without another gateway deployment; new upstream releases are discovered after
publication in that upstream index. There is no recurring model task or new cron.
The page refreshes feeds when visited, works without sign-in or browser JavaScript,
and keeps the existing layer filters and stable entry links.

## Full history from day one

The archive starts with core source development on 30 August 2026 (UTC), before
the first published 1.0.0 release, and hosted SaaS source on 9 September 2026.
It includes all eight published upstream releases through 2.1.0, both maintained
fork desktop releases, 268 upstream primary-branch integrations and all 169
merged SaaS PRs through the audited source snapshots. Busy dates are grouped in
batches of up to eight linked changes; no item in those inventories is omitted.
Existing detailed entries and their permalinks are preserved.

`docs/changelog-history-inventory-20261106.json` records the source snapshots,
release dates and the entry covering every historical commit/PR. It is a coverage
baseline, not a deployment ledger. One historical release-branch PR (#30) is
labelled as such rather than being represented as current main or a rollout.
Release notes, desktop packages, historical source changes and verified hosted
availability are labelled separately. Dates are normalized to UTC.

There is no November or other date cutoff. The upstream release parser retains
all published releases; the SaaS reader rejects feeds that drop bundled or
previously saved history. The full snapshot is also the recovery fallback.
History coverage tests and the CI ID-preservation policy prevent silent loss.
The page remains newest first and each filter offers a link to its oldest entry.

## Adding SaaS updates

Every PR changing application behavior, security, UI, API, dependencies or hosted
runtime adds an entry to `site/public/changelog.json`. Use a unique, stable `id`,
a UTC `date`, `layer: "saas"`, a short `title`, explicit `status`, user-facing
`changes`, and public project-repository `links`. Preserve existing entries and
IDs. Test-only and documentation-only changes do not require an entry.

A merged change is not a deployment. Before rollout use a status such as
`Source update · Deployment verified separately`. After verified deployment,
update the matching entry to its deployed engine/service status and link the
public release evidence in the release-receipt PR. Do not expose private provider
receipts, customer data, credentials or operational identifiers.

Run `npm run changelog:check` to validate data. Set `CHANGELOG_BASE_SHA` to the
base commit to also check coverage for the actual diff. The CI test job does this
for PRs and main pushes. Application changes require a new SaaS entry; release
receipt changes require a matching entry/status update. Existing entry IDs cannot
be silently removed. CI is a release gate; do not bypass a failed coverage check.

## Core releases and availability

New core releases get their upstream version/date and a direct release-notes
link automatically. Their status says released upstream, with hosted rollout
tracked separately. This never claims SaaS deployment. Existing curated core
entries retain richer descriptions and verified managed availability. Update
those descriptions/statuses in the coordinated SaaS release when appropriate.

## Outages and limits

Each source read has a three-second deadline, rejects redirects and is streamed
with a 1 MB limit. The feed schema bounds entries/text and accepts evidence links
only in the two project repositories. All displayed text and URLs are escaped.
No credentials or customer/session information is sent to the public sources.

The last valid normalized data is retained in the existing edge cache for up to
seven days, subject to cache eviction. Refresh failures show saved data with an
explicit notice that newer changes may be missing. With no cached data, the
checked bundled snapshot remains readable. A failed or malformed fetch never
replaces a good cached feed. Failed sources back off for one minute when the
cache is available, rather than retrying on every visit. The timestamp describes successful source checks,
not deployment time. Availability depends on the public source services; the
page does not silently claim freshness during an outage.

Validation covers feed changes without redeployment, cache expiration, source
failure, malformed/oversized feeds, hostile content, rollout labels, both filters,
and CI's missing-note/release-receipt checks, plus the normal project checks.
This remains a gateway-only release: no tenant repack, migration, or import QA.
