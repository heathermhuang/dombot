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
   Keep the service branding contract in `src/shared/product-brand.ts` and the
   copy/download regression check in `scripts/product-branding.test.mjs`. Resolve
   new upstream product copy to Domains.Domains; keep original-project credits
   and technical identifiers. See [Product branding](product-branding.md).
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
- The final local full run passed 260 files and 2,788 tests. The remaining homepage
  assertion was updated for the twelfth registrar; the unchanged 500-workspace setup
  fixture exceeded its 10-second hook during parallel checks. A subsequent serial
  run passed all 16 tests across platform, views and public product assets, without
  changing the timeout. The earlier full run also passed the platform tests.
- The exact installed `2.1.0-hosted.1` package passed all 11 desktop/mobile Chrome
  scenarios, including filtered bulk targets, pagination, navigation, real synthetic
  pricing/notes/folder saves, export and stale-completion isolation.
- Production dependency audit: zero advisories. The source sync changes no schema,
  tenant data, credentials, publication, routing or scheduling configuration.

CI on the PR remains the clean final full-suite gate. These offline and local
synthetic results do not claim a managed fleet deployment or live provider
acceptance. Managed production remains on its separately recorded release until
that engine/UI pair is rolled out and verified.

## v2.2.0 sync and creation-date repair, 9 November 2026

The complete upstream release tag is `1f6796840e0128664cf2a8bfa53702374a2edf7a`.
Engine `2.2.0-hosted.1` uses registrar-client `1.1.1-hosted.1` with the retained
hosted retry/deadline, unknown-write, date, Gandi/Cloudflare and Namefi ownership
patches. Dynadot and Spaceship marketplaces, linked registrar accounts, shared
Dynadot pacing and listing-price import are included. Marketplace sync requires
management scope because upstream can submit a pending verified listing.
The hosted public-page preparation still supports only its qualified providers;
new core marketplace adapters do not automatically enable public commercial links.

Registrar creation dates are qualified on cache reads, sync/detail writes, direct
MCP reads and UI merges. An impossible date becomes unknown with an optional
`createdDateIssue` (`invalid`, `future`, `after-expiration`), or falls back to a
valid known date. One day of date-only timezone ambiguity is tolerated. Valid
inventory dates reconcile old detail without changing quote age or other accounts.
Expiry and renewal dates, imported user facts and registrar controls are unchanged.
No year is inferred from the expiry and no live RDAP request is added to reads.

`upstream-parity-20261109.json` records the complete upstream API/tool inventory.
Source/CI qualification and managed production rollout are recorded separately.

## v2.2.1 / Namefi sync, 10 November 2026

The complete upstream release tag is `a688173c7e5099cec99d2f2721f040ef48f25fa7`.
Engine `2.2.1-hosted.1` uses SDK `1.2.1-hosted.1`, based on upstream SDK
`7f8b5a5f59edb8b91f0e29e65162de2f49d75324`. SDK #106 and former draft app
#268 have both merged. Upstream's subsequent DNS/auto-renew optimization #110
supersedes the hosted inventory guard. Hosted transport deadline/retry, provider
date, Gandi path and Cloudflare expression patches are retained; Namefi redirect
refusal and secret-safe errors are now upstream implementation.

Independent market keys/proxies and account switching, sync progress, Namefi
capabilities and the complete released app history are merged. Managed egress,
OAuth scopes, fresh authentication, quote ages, registry date recovery,
notifications, Park.io and explicit publication boundaries are retained.
Market linking requires fresh identity; backup format 15 preserves independent
market routing and imports v14 and earlier supported formats. Existing tenant
records are not rewritten by this source change.

SDK qualification: 695 offline tests, typecheck and ESM/CJS/declarations pass.
App, installed engine/UI, security and managed release evidence are recorded
separately. No registrar purchase, DNS or auto-renew write is used for qualification.
