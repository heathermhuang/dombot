# Integration qualification · 2 November 2026

Authorized scope: source implementation and dependency-ordered PR preparation. No merge, deployment, live publication/backfill, real DNS, external listing writes, real messages or spend.

Stack: #138 clean URLs → #139 integration/money → #140 directory/source contracts → #141 preparation/publication → lifecycle PR. Primary dirty checkout and the original clean-URL checkout/plan are preserved. Work uses independent `codex/` branches in `/private/tmp/dombot-listing-core-20261102`; the routing lint/artifact correction uses its own linked worktree.

Earlier exact candidates:

- #139 `4d3642e648c9a7c06fe1367086726edf7863b30c`: CI run 41440951155 passed; Security analysis 41441961821 passed.
- #140 `0852ba9ba19d4e896555cdc0b4528c042c83c424`: CI 41444111195 passed; Security analysis 41444103559 passed.
- #141 `e1de7364a636c42672fc1faecb23b0c16ad9b90b`: CI 41444164821 passed; Security analysis 41444129073 passed.

Final engine/UI: `1.5.2-hosted.40`, repacked, reinstalled, with engine/asset integrity and host boundary verification. Root and hosted dependencies installed; hosted auth built. Typecheck and lint passed. The exact final source/engine candidate passed 233 files, 2,532 tests and one skip; four security and four relay checks also passed. The focused final review suite passed 73 tests. Engine source digest: `1174806aed093ad69b8b8e4d9651297ef18ba7ac7b18e5aebbd85618921a7aea`. A final host-only backfill fence preserves newer reviewed reservations and tombstones; its 13 routing tests, typecheck, focused lint and gateway dry run passed without changing that engine digest. Exact corrected PR-head CI/Security status is tracked in PR metadata; all checks must pass before release.

Web/demo/site builds and all six required Worker dry runs passed (gateway, lander, tenant, provisioner including template preparation, proxy scheduler and self-hosted worker). Wrangler wrote only local dry-run outputs; it did not deploy. Builds and engine mutations were kept separate from integrity-test runs.

Behavioral evidence includes market-only private preparation with exact decimal money and no ownership grant; stale-tab/revision conflicts; source fingerprints; lost reservation responses; standalone/bulk/composite writers; canonical/legacy routes; conflicts, explicit fresh-control transfer, withdrawal/tombstones, bounded backfill; 500 admitted accounts with two selected-tenant reads despite an unrelated outage; approved-source preservation across draft edits; expiry/discount/sale/control suppression and non-reactivation; exact decimal shop ranges; seller reports without booked revenue; explicit transaction matching and no duplicate sold event; distinct deduplicated verification/evidence counters; backward-compatible paused backup restoration; maintenance sleep with historical counters.

A loopback-only synthetic browser fixture was prepared with the pinned engine, one invented market observation and synthetic control admission. Browser execution is currently blocked: no connected browser is available, and Computer Use reports that the Mac is locked and automatic unlock failed. The user has been asked to unlock it while independent checks continue. No browser-flow pass, real provider checkout qualification, customer acceptance, conversion improvement or production readiness is claimed from synthetic/API checks.
