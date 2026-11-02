# Listing pages / core integration implementation

Authorized scope: implement all four phases and prepare dependency-ordered PRs. No merge, deployment, live content/provider/DNS writes, real messages or spend. Approved plan is copied alongside this checklist; its original proposal/release status is preserved.

Base verified 2 November 2026: fork main `760237ec`; draft #138 remains open at `0fae67fe`. Independent clone `/private/tmp/dombot-listing-core-20261102`, branch `codex/listing-core-foundation-20261102` based on #138. Primary dirty checkout and #138 branch preserved.

- [x] Phase 1: existing market connections, draft inventory, exact money v2 and backup compatibility.
- [x] Phase 2: authoritative directory, reservation/fencing, reviewed transfers, resumable published-only backfill, 500-account isolation; typed source/destination contracts.
- [x] Phase 3: Domains/editor preparation, selected source, existing review/publication and explicit optional surfaces.
- [x] Phase 4: source freshness/suppression, outcomes/core Sales reconciliation, distinct measurements.
- [ ] Final checks: pinned engine/UI repack/reinstall/verify; typecheck/lint/tests/security/relay/builds/six dry runs; exact candidate CI/security; PR release order and evidence.

Money migration: legacy v1 payloads retain their original exact whole strings on read. Saving drafts and producing reviewed snapshots emit v2. No destructive rewrite of published records or previous payloads; legacy backups remain readable. Exported sales extension is v2 and bundle v11, so older readers reject new data rather than dropping it. Restore remains private/paused and does not recreate operational grants.

Phase 1 verification: targeted money/store/backup suite 59 passed; typecheck/lint passed. Full run: 229/231 files passed (2,511 tests passed, one skip); remaining two assertions expected bundle v10 and were updated to v11, to be rerun before commit. Pinned engine `.37`.

Phase 1: PR #139 at `4d3642e6`, CI success; Security analysis manually dispatched because stacked PR bases are excluded by its main-only automatic trigger. Phase 2: targeted routing/source/store/composite suite 84 passed; corrected DNS/provisioning/backfill suite 55 passed; typecheck/lint and engine `.38` integrity/boundary checks pass. Full phase-2 local run encountered EADDRNOTAVAIL loopback exhaustion and eight missing synthetic directory bindings (corrected); full final-candidate rerun and exact CI remain required. Directory release/backfill details are in `public-domain-directory.md`.

Phase 3: Domains Public page column and existing detail/presence paths; market-only rows in Listings; bounded per-name private preparation; selected market terms/destination in editor; provider buy/offer/view handoff; optional shop/profile surfaces retained. New read-only MCP proposal returns a suggestion without saving/syncing/publishing/provider writes. Targeted preparation/composite tests: 71 passed; MCP/proposal/preparation suite: 64 passed. Typecheck/lint passed after correcting purity and URL-regex lint; engine `.39` repacked/reinstalled/verified. PR #140 requires a backported regex lint correction with a refreshed `.38` artifact before CI can pass.

Phase 4 implementation: encrypted approved-source bindings; read-time price/discount lease suppression; known channel/sale/control holds; cancellation/reacquisition review; reports separated from core completed revenue; explicit exact transaction/event matching; separate aggregate hosted measurements and backup v3/bundle v12. Targeted corrected lifecycle suite 114 passed before final added decimal range and evidence-failure tests. Final validation remains pending; see lifecycle documentation for semantics. #140 corrected candidate `0852ba9b` and #141 candidate `e1de7364` both passed CI. #139 passed CI and Security analysis. Browser/final builds/security, exact lifecycle CI and final review remain.

Final pre-PR qualification: web/demo/site builds and all six Worker dry runs passed; engine `.40` repack/reinstall/asset integrity/host boundary passed. Full lifecycle suite 233 files, 2,531 tests plus one skip; security 4/4 and relay 4/4. Final review added the no-new-inquiry stale-offer regression; focused suite 73 passed. Exact final CI/security and refreshed full suite pending. Browser fixture ready but Computer Use has no connected browser and reports locked Mac; user unlock requested asynchronously. Detailed evidence: `listing-core-verification-20261102.md`.

Final exact source qualification: 233 test files passed, 2,532 passing tests, one skip. Typecheck/lint, four security tests, four relay checks, three builds and six Worker dry runs passed; engine `.40` source digest `1174806aed093ad69b8b8e4d9651297ef18ba7ac7b18e5aebbd85618921a7aea` verified after builds.

- [x] All four source phases implemented and locally qualified.
- [x] Relevant behavioral/security/migration/backup/routing/money/maintenance regressions corrected and passing.
- [x] Required web/demo/site builds and six Worker dry runs completed without deployment.
- [ ] Exact lifecycle PR-head CI/Security: status and immutable run receipts are recorded in PR metadata after push.
- [ ] Meaningful browser owner/buyer flow: blocked by locked Mac and no connected browser; synthetic fixture is ready, user unlock requested.
- [ ] Merge/release/backfill/provider/customer qualification: outside this PR-only authorization; release sequence documented.
