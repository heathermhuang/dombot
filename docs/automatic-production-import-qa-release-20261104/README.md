# Automatic production import QA cleanup · 4 November 2026

The explicitly approved rollout is active in production. Control migration
`0023_production_import_qa.sql` is applied, the private provisioner runs source
`4ed323b6e86ff8aaf5bc2c55253951152ba831f5`, and its `*/2 * * * *` backup cron is
installed. Setup-object expiry recovery and normal runner cleanup use the same
guarded lifecycle. See [operator instructions](../production-import-qa.md).

Implementation [#150](https://github.com/heathermhuang/dombot/pull/150) and note
validation correction [#151](https://github.com/heathermhuang/dombot/pull/151)
merged after CI and Security passed. The deployed module SHA-256 is
`14a87e2851fad7fedf56a8e60a9821eb9d449f3e48fdcfecc1fca85b41e5744e`.
The gateway remains on `b7d9be213a6983fd58bf592573fac7a6fd30be9f` and tenant
engine `1.5.2-hosted.41`; neither required deployment for this change.

## Production acceptance

| Scenario | Observed result |
|---|---|
| Normal managed import | No allocation on open/preview; one Worker/database on valid import; retries reused the pair and import identity; readback passed; finally cleanup completed. |
| Injected failure after import | Test intentionally exited nonzero with the exact injected failure; finally cleanup and independent absence checks completed. Failure handling acceptance passed; the deliberately failed import test is not reported as a passing test. |
| Abandoned allocated lease | Participant imported synthetic data, confirmed one Worker/database, then exited without finish. Server-side expiry recovery completed 7,695 ms after expiry; independent checks found no resources or sessions. |

The abandoned case used a two-minute lease. Cleanup completed before any client
cleanup call; a subsequent idempotent call verified absence and scrubbed the local
obsolete password. The live evidence proves server-side expiry recovery without
attributing that recovery to a specific alarm or cron invocation. Native alarm
behavior is also covered by integration tests, and the backup schedule was checked.

The first live trial passed import checks but cleanup safely held because the note
guard assumed domain-name keys. Notes actually use their own IDs. #151 checks the
native note IDs, owning synthetic domain and persisted/native counts. Foreign or
missing notes still reject cleanup; resource and identity guards were retained.
That exact held run was re-evaluated through the corrected guards and fully cleaned
before a fresh successful run. Four managed runs in total are complete, including
this recovered initial trial; no run remains active or held.

## Independent final verification

At `2026-11-04T06:13:04.015Z`, provider reads/inventory and control/setup inspection
confirmed:

| Component | Remaining |
|---|---:|
| Managed QA accounts and sessions | 0 |
| Managed QA Workers | 0 |
| Managed QA D1 databases | 0 |
| Managed QA coordinator namespaces | 0 |
| Managed QA setup keys | 0 |
| Active QA runs | 0 |

Every temporary QA password was scrubbed. All **55 real users** retained their
credential fingerprints and workspace identities. All **39 real platform rows**
and **532 pre-existing workspace identities** matched the baseline. Gateway and
provisioner bindings, secrets, assets, future template and shared namespaces were
preserved; provisioner code and its backup cron changed as authorized.

Only disabled, non-reusable QA workspace identities and completed deletion/run
audit metadata remain. They cannot authenticate, allocate or route. Cleanup never
adopts a real account or an unregistered historical account based on a label/name
prefix. Identity changes, foreign data, unknown provider results and unreconciled
cleanup remain explicit holds that block further production tests.

The full local suite passed serially (238 files, 2,579 tests, one skipped).
After the note correction, 25 targeted safety/lifecycle/native-alarm tests,
hosted typecheck and lint passed, followed by CI and Security on the merged code.
Concurrent local execution had timed out in unchanged fixtures/build tests and the
new suite; serial execution passed without relaxing timeouts.

These tests used managed operator-seeded accounts and reserved `.invalid` data
through normal production password login/import. They do not qualify public signup,
email delivery or legal acceptance. No registrar, DNS, publication or payment writes
were performed.

Protected provider receipts, baseline snapshots and execution logs are retained in
the ignored primary-checkout directory
`.wrangler/automatic-production-import-qa-release-20261104` (directories 0700/files
0600). Per-run scrubbed receipts remain under `.wrangler/production-import-qa/runs`.
No credentials, secrets or customer records are included in public release evidence.
See [sanitized machine-readable results](summary.json). This receipt changes
documentation only and requires no application deployment.
