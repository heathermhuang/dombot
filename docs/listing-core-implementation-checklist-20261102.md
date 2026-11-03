# Listing/core integration implementation checklist

Updated 3 November 2026. Approved plan preserved at `listing-pages-core-integration-plan-20261102.md`. Authorization covers implementation, verification, isolated branches, commits, pushes and dependency-ordered PRs. Merge, deployment, live migration/backfill/publication, real DNS/provider writes/messages and spend remain outside this assignment.

The primary dirty checkout and original clean-URL branch/plan are preserved. Implementation uses `/private/tmp/dombot-listing-core-20261102`; the routing correction has a separate linked worktree.

- [x] Phase 1 — existing market connections, private market-only draft inventory, exact decimal money and versioned backup compatibility. PR #139, after #138.
- [x] Phase 2 — authoritative canonical directory, reservations/revision and generation fences, conflicts, reviewed transfer, withdrawal/tombstones, bounded published-only backfill, 500-account/outage isolation and typed source/destination contracts. PR #140; final backfill race correction is in #142.
- [x] Phase 3 — Domains/detail/presence actions, selected-market private preparation, exact review/commit, primary provider handoff, explicitly optional surfaces and read-only MCP proposals. PR #141.
- [x] Phase 4 — separately retained approved source bindings, drift/expiry/sale/control suppression, no automatic reopening, seller reports distinct from completed revenue, explicit exact transaction matching, separate hosted counters and paused backup restoration. PR #142.
- [x] Browser qualification — private preparation, recipient gate, stale-tab protection, exact review/publication, canonical/provider/legacy paths, price drift, reviewed update and withdrawal. See `listing-browser-qualification-20261103/README.md` and screenshots.
- [x] Browser-discovered source-origin copy corrected. Derived marketplace rows remain unverified and are not persisted as imported holdings.
- [x] Engine/UI `.41` repacked, reinstalled and verified; typecheck/lint, 234 files / 2,535 tests plus one skip, four security regressions and four relay checks passed.
- [x] Updated web/demo/site builds and all six Worker dry runs passed; installed engine/asset integrity reverified after builds.
- [ ] Updated exact-head CI/Security receipts — recorded in PR #142 after push; final source/build evidence in `listing-core-verification-20261102.md`.

All prior PR heads remain independently checked: #139 `4d3642e6`, #140 `0852ba9b`, #141 `e1de7364` passed CI and Security analysis. Previous #142 head `3f1a6c06` passed 233 files, 2,533 tests plus one skip in CI, security/relay checks and required build/dry-run jobs. The current `.41` browser copy correction requires its own final checks.

Release handoff: #138 → #139 → #140 → #141 → #142. Coordinate additive schemas, every admitted tenant reader/writer and future templates, published-only backfill/conflict review, then directory cutover. Main-push self-hosted deployment can run when Cloudflare credentials are configured; treat merges as potentially releasing code. Real provider checkout/purchase, independent customer acceptance and production release qualification remain separate.

## Approved production release · 3 November 2026

- [x] #138–#142 and the checked rollout follow-up #143 merged.
- [x] Protected control/tenant recovery exports and code/configuration snapshots retained.
- [x] Control 0022 and tenant 0009 migrations applied.
- [x] All 43 admitted serving runtimes qualified at engine/UI `.41`; future template and public edge updated.
- [x] All 43 backfill checkpoints complete; two active routes, zero conflicts.
- [x] Directory-only cutover completed; allocation restored and template hashes matched.
- [x] Production canonical/legacy/profile/custom-host/source/preservation checks passed.

Release evidence supersedes earlier PR-only and locked-browser notes: `listing-core-production-release-20261103/README.md`. One pre-existing unfinished allocation remains an explicit recovery hold with its existing resources preserved. Independent customer/payment/provider acceptance is not implied.
