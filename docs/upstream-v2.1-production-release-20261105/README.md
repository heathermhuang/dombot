# DomBot v2.1.0 production release · 5 November 2026

Production serves **2.1.0-hosted.1** across all **44 admitted portfolios**, from
source `26e3933f0afa05e6c29337b219b7d8a546328143` ([PR #167](https://github.com/heathermhuang/dombot/pull/167)).
The future template, private provisioner and gateway agree, and the original
allocation policy is restored. Production runtime, import and preservation checks
passed. Signed-in owner browser and real Unstoppable acceptance remain held as
specified below. [Machine-readable receipt](summary.json).

This contains the complete upstream v2.1.0 release
`e93d5210707f706451310e0a85c147a44c3177c1`, with registrar-client
`1.1.0-hosted.1` and the retained hosted deadline, jitter, Gandi, Porkbun UTC and
Cloudflare safety patches. The checked engine/UI artifact was reused without a
rebuild. Its source SHA-256 is
`feb778f11b9d7cdb145cc71347a9ea17868314a450b61624e7ea4cd8f5c2345a`; archive
SHA-256 is `1327a38d75b446642fe1b49317467767ca78d1f074e3152ddf4bf4e6a16df232`.
No schema migration was applied to existing production databases.

| Check                     | Observed result                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Checked source / CI       | Checked tree and merged main match. PR CI passed 262 files / 2,791 tests with one existing manual skip, type/lint/security/relay/build checks; merged-main [CI](https://github.com/heathermhuang/dombot/actions/runs/42021751206) and [CodeQL](https://github.com/heathermhuang/dombot/actions/runs/42021751136) pass. SDK: 652 offline tests and ESM/CommonJS/declaration builds pass. |
| Serving fleet             | 44/44 report the exact engine and source digest through coordinator-backed readers. Uploaded modules, preserved settings and restored tenant admission were independently checked.                                                                                                                                                                                                      |
| Template / gateway        | Template hash `8efda208073b86a80608303c20983038e17296f825139fe5959ea7a6fd823293` agrees. Gateway source offer and original allocation policy pass.                                                                                                                                                                                                                                      |
| Accounts / credentials    | All 55 real accounts, 544 original workspace identities, 39 platform mappings and 44 credential/account namespace fingerprints preserved.                                                                                                                                                                                                                                               |
| Holdings / settings       | Imported and cached holdings, notes/events, asking and manual renewal prices, folders/assignments and settings match fingerprints reconstructed from the fresh rollback exports across all 44 portfolios.                                                                                                                                                                               |
| Publications / routes     | Two Sales publications and two profiles retain their payloads/revisions. Canonical/legacy URLs and two active custom hosts pass. No directory conflicts.                                                                                                                                                                                                                                |
| Schedules / HTTP          | Eight legacy schedules, gateway schedules and the provisioner’s existing two-minute backup cron preserved. All 38 public HTTP checks pass.                                                                                                                                                                                                                                              |
| Provider reads            | The owner MCP runtime lists 12 registrars. Actual read-only Namecheap and Dynadot connection tests pass through their preserved managed defaults; no customer proxy overrides were removed.                                                                                                                                                                                             |
| Managed production import | Opening/preview allocated zero resources. Valid synthetic import allocated one Worker/database pair; two retries reused it and readback matched. Managed HTML title is `domains.domains`; both served JS/CSS asset hashes match the exact packaged UI.                                                                                                                                  |
| Cleanup                   | The trusted runner and a separate operator readback confirm no run-owned Worker, database, account, session or platform/pending mapping; setup keys are zero and the temporary password is scrubbed. No active QA run or unfinished allocation remains.                                                                                                                                 |

The controlled canary used its existing identity/resources. New allocation was
paused; tenants were drained and promoted sequentially. Fresh recovery custody
contains 45 database exports, 46 code/settings snapshots and the previous template,
whose bytes match its observed live hash. Two connection resets stopped promotion.
Exact remote reads proved each original runtime/settings remained intact;
admission was restored before retrying. No uncertain upload was blindly repeated.

Trusted import run `0c0f6f16-35bc-4443-8f0b-79a3b225baf0` completed its test and
cleanup. The runner’s 532 non-QA identity scope excludes retained audit identities;
the separate release readback preserved all 544 original identities. One additional
read-only verifier initially expected HTTP 404 for an absent dispatch Worker.
Cloudflare returned successful HTTP 200 with an explicit `script: null`. The
verifier was corrected to require that explicit absence contract, rejecting missing
fields, present scripts and API failures; it passed on the same completed lease.
No extra production QA run or cleanup mutation was needed for that correction.

The exact package’s 11 pre-release desktop/mobile Chrome scenarios passed and are
retained in [the results](packaged-ui-results.json), including filtering, selection,
pagination/navigation, synthetic saves, CSV targets, Activity and delayed completion.
Additional local CUA checks at 1440×1000 and 390×844 verified a synthetic import,
the 12-registrar catalog, Unstoppable’s blank-key form/cancel behavior and sync
settings. These browser checks use synthetic local data. [Desktop](selection-verified.png)
and [mobile](mobile-selection.png) screenshots show the packaged regression fixture.

The Mac was locked, so fresh signed-in owner desktop/mobile production browser
inspection remains held; no lock or authentication bypass was attempted. No
controlled Unstoppable credential was available, so real Unstoppable provider
acceptance remains held. Connection tests do not establish every provider operation,
physical-device or mailbox acceptance. Already-open owner tabs need a refresh to
load the new renderer.

No registrar, marketplace, DNS, publication, payment or messaging write was used
as a production fixture. Customer data, keys, passwords and raw provider receipts
remain in owner-only ignored custody under
`.wrangler/upstream-v2.1-release-20261105`. The dirty primary checkout was untouched.
The successful self-hosted post-merge workflow skipped its deployment step; this
receipt records the separate managed SaaS rollout.
