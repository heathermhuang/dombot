# Weekly review and upstream release · 4 November 2026

Production runs **2.0.0-hosted.2**, source `01001a7489abe5df51d1eb0b10399fae114921a4`, across all **44 admitted portfolios**. The gateway and future-allocation template agree; the original allocation policy and two-minute private-provisioner backup cron are restored/preserved.

This fully merges upstream DomBot 2.0.0 through `ccb918deed20f8d01009970064027fcb021bac97`, with registrar-client 0.15.1 and the documented hosted patches. It retains the three weekly-review fixes: Gandi update timestamps are excluded from renewal deadlines, past reported expiry has a separate verification workflow, and quote age/source is independent of inventory sync.

PRs [#153](https://github.com/heathermhuang/dombot/pull/153), [#154](https://github.com/heathermhuang/dombot/pull/154), [#155](https://github.com/heathermhuang/dombot/pull/155), [#156](https://github.com/heathermhuang/dombot/pull/156) and [#157](https://github.com/heathermhuang/dombot/pull/157) merged. The final correction negotiates registrar-connection responses so existing browser tabs retain their success/failure contract. New verification writes preserve fresh authentication, MCP scopes and provider limits. No new control migration was needed.

## Verification

| Check                     | Result                                                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI / security             | Exact candidate passed: 251 test files, 2,698 tests, one existing skip; four security regressions, four relay checks, all builds and both CodeQL languages. SDK: 586 non-live tests pass.         |
| Serving runtime           | 44/44 report the exact engine and source digest through existing coordinator-backed readers. Uploaded module hashes and unrelated bindings were checked.                                          |
| Account preservation      | 55 users, 536 original workspace identities and 39 platform mappings preserved. Encrypted registrar/market account and credential namespace fingerprints match across all 44 admitted portfolios. |
| Publications / routing    | 2 Sales and 2 profile publications retain their exact stored payloads/revisions. Canonical pages, legacy 308 redirects, profiles and 2 active custom hosts pass. Directory conflicts: 0.          |
| Owner browser             | Existing owner portfolio verified Domains expiry attention, Renewals forecast and quote-age coverage on the final runtime. No registrar action was submitted.                                     |
| Managed production import | Open/preview allocated nothing; valid submission allocated one pair; retries reused it. Automatic cleanup and independent absence/preservation checks passed.                                     |
| Source / operations       | Exact source offer, template hash agreement, original admission/allocation policy and existing backup cron verified. No unfinished allocations or active QA runs remain.                          |

The controlled canary used its existing identity/resources. An intermediate readback returned an older module and one transport failure left an upload outcome unknown; both were reconciled against provider state before continuing. No unknown write was blindly repeated. Protected recovery includes 45 database exports and 46 code/settings snapshots; no root keys were exported.

The managed QA account, Worker/database, coordinator and setup state were removed by the guarded lifecycle, with temporary credentials scrubbed. Only the disabled, non-reusable deletion audit identity remains. Real accounts were never selected for cleanup. The unchanged cleanup implementation retains its earlier success, injected-failure and abandoned-lease qualification; this release adds a fresh normal import/cleanup result on the new template.

Private customer records, credentials and provider receipts stay in the ignored owner-only custody directory `.wrangler/weekly-review-release-20261104/upstream-2.0-release`. [Sanitized results](summary.json) identify the deployed candidate. No registrar/DNS, marketplace listing, publication, payment or outside messaging action was used for acceptance. Past expiry still requires provider verification; these checks do not establish renewal completion, customer adoption or paid demand.
