# Listing/core integration qualification

Updated 3 November 2026. Scope: implementation and dependency-ordered PR preparation. No merge, deployment, live migration/backfill, real provider listing/DNS writes, real messages or spending were authorized or performed.

The primary dirty checkout and original clean-URL branch/plan are preserved. Implementation uses isolated `codex/` branches in `/private/tmp/dombot-listing-core-20261102`.

## Current candidate

Engine/UI `1.5.2-hosted.41`, source digest `85e446bd12e518a55cfc5f99b66b2440617de2d3cfec583b457511c15a40745b`, repacked, reinstalled and verified. The browser continuation corrected marketplace-only source labels while preserving their unverified-row authority boundary; no derived row becomes an imported holding or domain control proof.

Local results: typecheck and lint passed; 234 test files passed, 2,535 passing tests plus one skip; four security regressions and four relay checks passed. Focused row-boundary/preparation tests passed 56 tests. The updated web/demo/site builds and all six Worker dry runs passed locally, and installed engine/asset integrity passed again after builds. These checks do not deploy. Builds and engine mutations remain separate from integrity-test runs.

Behavioral evidence covers exact market-only private preparation, no automatic exposure, recipient and control gates, revision/lost-response recovery, source fingerprints and leases, standalone/bulk/composite writers, tenant isolation, canonical/legacy routes, conflicts/transfers/tombstones, bounded published-only backfill, preservation of newer reservations during backfill, 500 admitted accounts and unrelated-tenant outages, exact decimal shop boundaries, stale/control/sale suppression, no automatic reopening, seller reports without booked revenue, explicit sale matching, separate counters, paused backward-compatible restoration and maintenance sleep with historical counters.

## Browser evidence

The owner/buyer flow was exercised in the in-app browser against a loopback-only synthetic account and the pinned engine/UI. Private preparation, stale-tab protection, explicit publication, canonical/provider/legacy paths, source-drift suppression, reviewed price update and withdrawal passed. No first-party console errors were observed. See `listing-browser-qualification-20261103/README.md` and its screenshots.

The fixture supplies invented market data, credentials and trusted control admission. It does not establish real DNS/control/authentication, provider checkout, payment/transfer/payout, customer acceptance or conversion improvement. Sedo accepted the domain handoff but redirected the fixture domain to brokerage and returned external CDN script 404s; live checkout remains unqualified.

## PR checks and release handoff

- #139 `4d3642e648c9a7c06fe1367086726edf7863b30c`: CI 41440951155 and Security analysis 41441961821 passed.
- #140 `0852ba9ba19d4e896555cdc0b4528c042c83c424`: CI 41444111195 and Security analysis 41444103559 passed.
- #141 `e1de7364a636c42672fc1faecb23b0c16ad9b90b`: CI 41444164821 and Security analysis 41444129073 passed.
- Previous #142 `.40` head `3f1a6c06dca79f4b0fb236cfa0d50491e8a8feca`: CI 41449863203 and Security analysis 41449852283 passed. The current `.41` correction requires its own exact-head checks; immutable receipts are recorded in PR #142 metadata after push.

PR order is #138 → #139 → #140 → #141 → #142. Before an authorized release, coordinate additive schemas, compatible readers/writers for all admitted tenants and future templates, bounded published-only backfill and conflict review, then directory cutover. Main-push self-hosted deployment can run when Cloudflare credentials are configured; treat merges as potentially releasing code. Browser qualification is no longer blocked. Merge/deployment and independent provider/customer qualification remain separate decisions.

## Authorized production release

The user subsequently approved merge and coordinated production release. The stack plus checked rollout follow-up #143 were merged; migrations, 43-tenant native compatibility, future-template update, published-only backfill/conflict review, gateway cutover, allocation restoration and production reads/preservation checks completed. See `listing-core-production-release-20261103/README.md`. The earlier PR-only authorization/status paragraphs are historical, not current blockers.
