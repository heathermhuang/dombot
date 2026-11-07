# Domains.Domains output branding release

[PR #189](https://github.com/heathermhuang/dombot/pull/189) is merged and deployed
as engine `2.1.0-hosted.4`, application/gateway source
`aecf74e21120d7c3fab041bd8d7cb1c64345e7e2`. Production verification completed
at 05:06 UTC on 7 November 2026. See the [machine receipt](product-branding-release-20261107.json).

All 45 admitted portfolios serve the exact engine/source, and the future template
matches the gateway and private provisioner. The original 58 accounts, 564 workspace
identities, 40 platform mappings, encrypted credential/account fingerprints,
publications/revisions, canonical/legacy routes and active custom hosts were
preserved. All 14 managed template bindings, gateway assets, private provisioner
module, cleanup cron and the original allocation policy were retained. No schema
migration or registrar mutation was used.

## Observed output behavior

A fresh production MCP connection reported **Domains.Domains**, supplied the exact
naming instruction, and exposed 35 read-only tool descriptions with no legacy
branding. A portfolio query returned only its one synthetic holding. The temporary
OAuth client, authorization and grant were revoked/removed afterward.

A managed production QA lease verified four settings sections, all three served
JS/CSS/SVG assets against the pinned hashes, three branded downloads, unchanged
`dombot-data` backup content, mobile width 390 with no overflow, and no page errors.
The separate managed import test verified no allocation on open/preview, one valid
submission, two stable retries and readback. Both leases passed independent cleanup;
temporary passwords were scrubbed. Final audit found no active QA runs or unfinished
allocations. All 38 HTTP checks passed.

CI and CodeQL passed for the checked candidate and merged source. Root/Worker/hosted
typechecks, lint, engine integrity, security/relay checks, six Worker dry bundles,
web/demo/site builds, local regressions and 11 packaged UI scenarios passed before
release. Five local fixture files encountered loopback socket exhaustion in a final
full run; all 48 tests passed in the bounded serial retry. Final coverage was 2,949
passing tests with one intentional skip.

## Recovery and transport reconciliation

Automatic approval review rejected downloading production database exports to local
files. The release used 46 Cloudflare-hosted D1 Time Travel recovery bookmarks and
47 protected code/settings snapshots instead. Preservation checks saved only counts
and fingerprints; no database contents or root keys were exported.

One uncertain Worker upload was proven not to have applied before original admission
was restored and the rollout resumed from checkpoints. A later connection reset
occurred while staging inactive assets; a fresh provider session reconciled the
remaining content hashes. No active deployment write was blindly replayed.

## Client refresh and upstream sync

Existing client aliases and tool identifiers remain compatible. A client that caches
old initialization/tool metadata may need a reconnect or metadata refresh; historical
replies and upstream credits are not rewritten. The fresh production connection
above verified the metadata currently served by the service.

Follow [Product branding](product-branding.md) after each upstream merge. Display,
download and suggested client names are centralized; the source-copy regression
check flags reintroduced old product wording. Storage, backup-format and protocol
identifiers and original-project attribution remain stable.
