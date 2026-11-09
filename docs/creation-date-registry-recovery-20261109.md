# Verified registry creation-date recovery

Domains.Domains serves engine **2.2.0-hosted.3**, SDK **1.1.1-hosted.1** and
application/gateway source `c5c82ed2f677f2cff1640113b4f3fbae6e53dc0d` across all **47 original
admitted portfolios** and the qualified future template.
[Recovery PR #205](https://github.com/heathermhuang/dombot/pull/205) and
[Worker compatibility PR #206](https://github.com/heathermhuang/dombot/pull/206)
merged after CI and security passed. The shared change is in
[upstream PR #276](https://github.com/aoxborrow/dombot/pull/276).

## Correct creation dates

The earlier null-only guard prevented an impossible date from being exposed but
did not complete recovery. Invalid registrar creation dates now trigger a bounded
lookup against the TLD registry selected by IANA bootstrap. Exact domain identity,
a single valid registration event and registry chronology are checked before the
actual instant is cached independently with its authority URL and observation time.
No registration year is inferred from expiry. Healthy dates and imported facts do
not initiate extra traffic. Registry outages retain previously verified evidence;
explicit registry negatives invalidate it.

The owner live MCP recovered the actual registry instant and returned provenance.
Forced detail, cached detail, fresh Namecheap inventory sync and cached portfolio
reads passed. All 943 unique owned rows were scanned from one inventory snapshot;
no future creation dates or sync errors remained. Expiry and controls were unchanged.
Private domain names and account records are omitted.

A canary exposed that Cloudflare Workers rejects fetch with
`redirect: "error"` before network I/O. The rollout was held and allocation
restored. The corrected code uses manual redirects and rejects redirect responses;
the actual recovery implementation passed in a remote Worker preview before the
second canary and live MCP qualification.

## Release qualification

- CI passed 3,226 tests across 300 files with one intentional skip, all typechecks,
  lint, engine integrity, four security regressions, four relay checks, six Worker
  dry bundles and renderer/demo/site builds. All 173 focused regressions passed.
  Upstream CI passed.
- Original 61 users, 582 workspace identities, 42 platform mappings and
  encrypted credential/account fingerprints for all 47 portfolios were preserved.
  All 28 Sales publications, 2 profiles, canonical/legacy routes and
  2 active custom hosts passed preservation checks.
- All 16 future-template bindings, provisioner/gateway schedules, allocation policy,
  notification preferences and renewal choices were preserved. No schema migration
  was needed. Protected code/settings snapshots and 48 Cloudflare-hosted D1
  bookmarks remain available; no database contents or root keys were exported.
- Interrupted immutable asset stages were reconciled before resuming. No uncertain
  Worker activation was blindly repeated, and the existing controller was retained.
- Trusted managed import: opening and preview allocated nothing; a valid save
  created one Worker/database pair; two retries reused it; readback passed.
  Independent Worker/database absence, erased setup and scrubbed temporary
  credentials passed. Active QA and unfinished allocation counts are zero.

See the [machine-readable receipt](creation-date-registry-recovery-20261109.json)
and [recovery contract](creation-date-recovery.md). Private operational evidence
stays in the ignored `.wrangler/creation-date-worker-recovery-release` directory.
These are operator checks and do not claim independent customer adoption.
