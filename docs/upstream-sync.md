# Keeping the core app current

Fully merge each upstream release tag into current hosted main in an isolated
checkout. Preserve the dirty primary checkout and record exact upstream revisions.
A subset of cherry-picked fixes is not full feature parity.

1. Read current project instructions and CI. Compare upstream against hosted main,
   not a stale local branch. Merge the release tag without dropping hosted changes.
2. Upgrade registrar-client to the SDK required by that tag. Rebase the cumulative
   hosted source/test patches, run its offline suite/typecheck/build, and record
   the artifact integrity, source revision and patch hashes in `vendor`.
3. Resolve shared code conflicts by retaining OAuth scopes, credential redaction,
   per-account identity, hosted proxy/scheduler policies, independent quote ages,
   publication boundaries and the current selection/filter behavior. Preserve
   desktop/self-hosted functionality and the hosted release display.
4. Update the parity inventory and its test to the released revision. Bump the
   engine version/provenance, build the matched engine/UI artifact, install it,
   and verify the engine boundary and source/archive/installed-package hashes.
5. Run required CI: root/Worker/hosted typechecks, lint, full unit tests,
   security regressions, relay checks, all six Worker dry bundles and
   web/demo/site builds. Run the existing synthetic packaged-UI qualification
   where renderer behavior changes. Keep provider acceptance separate.
6. Land through a checked PR. For a managed production rollout, use the current
   preservation manifest, controlled canary, exact engine/UI pair, existing
   accounts and future template, provisioner and gateway qualification. Production
   import tests must use the trusted QA lease runner and independent cleanup.
   Record deployment evidence separately from source and CI results.

## v2.1.0 sync, 5 November 2026

Upstream tag `v2.1.0` resolves to
`e93d5210707f706451310e0a85c147a44c3177c1`. This merge retains the SaaS layer
through hosted base `a8405d3d` and packages engine `2.1.0-hosted.1` with
registrar-client `1.1.0-hosted.1`. Upstream brings Unstoppable Domains,
Namecheap detail/pacing fixes, resumable annual Afternic sales history,
90-second API defaults, desktop scrubbed logs and sync error visibility.

The hosted proxy policy overrides the upstream timeout default so the shared
queue keeps its separate waiting budget and retry policy. Quote refreshes preserve
the detail cache age while independently recording `renewalQuoteFetchedAt`.
The `domain_get` row/detail merge remains behind its OAuth scope gate. Managed
About retains the serving SaaS engine identity and source links. No schema
migration or production activation is introduced by the source merge.

## Qualification for this candidate

- Registrar SDK: 652 offline tests, typecheck and ESM/CommonJS/declarations build pass;
  archive and source/test patch hashes match the recorded provenance.
- Root/Worker/hosted typechecks, lint, engine integrity, four security regressions,
  four fixed-source relay checks, web/demo/site builds and six Worker dry bundles pass.
- Final PR CI passed 262 files and 2,791 tests with one existing manual skip;
  merged-main CI and both CodeQL languages passed for the identical checked tree.
- The exact installed `2.1.0-hosted.1` package passed all 11 desktop/mobile Chrome
  scenarios, including filtered bulk targets, pagination, navigation, real synthetic
  pricing/notes/folder saves, export and stale-completion isolation.
- Production dependency audit: zero advisories. The source sync changes no schema,
  tenant data, credentials, publication, routing or scheduling configuration.

The managed production rollout is now recorded separately in the
[v2.1.0 production receipt](upstream-v2.1-production-release-20261105/README.md):
all 44 admitted portfolios, future template/private provisioner and gateway agree;
production import/retries/readback, exact served assets and independent cleanup
passed, with accounts, holdings, credentials, publications and schedules preserved.
Native owner desktop selection/target previews and subsequent production registrar,
sync and mobile-emulator checks passed within the receipt’s recorded coverage.
Real Unstoppable acceptance still requires controlled credentials. Local synthetic results
and successful Namecheap/Dynadot connection reads do not clear those holds.
