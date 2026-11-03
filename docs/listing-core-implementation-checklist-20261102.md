# Listing pages / core integration implementation

Authorized scope: implement all four phases and prepare dependency-ordered PRs. No merge, deployment, live content/provider/DNS writes, real messages or spend. Approved plan is copied alongside this checklist; its original proposal/release status is preserved.

Base verified 2 November 2026: fork main `760237ec`; draft #138 remains open at `0fae67fe`. Independent clone `/private/tmp/dombot-listing-core-20261102`, branch `codex/listing-core-foundation-20261102` based on #138. Primary dirty checkout and #138 branch preserved.

- [x] Phase 1: existing market connections, draft inventory, exact money v2 and backup compatibility.
- [ ] Phase 2: authoritative directory, reservation/fencing, reviewed transfers, resumable published-only backfill, 500-account isolation; typed source/destination contracts.
- [ ] Phase 3: Domains/editor preparation, selected source, existing review/publication and explicit optional surfaces.
- [ ] Phase 4: source freshness/suppression, outcomes/core Sales reconciliation, distinct measurements.
- [ ] Final checks: pinned engine/UI repack/reinstall/verify; typecheck/lint/tests/security/relay/builds/six dry runs; exact candidate CI/security; PR release order and evidence.

Money migration: legacy v1 payloads retain their original exact whole strings on read. Saving drafts and producing reviewed snapshots emit v2. No destructive rewrite of published records or previous payloads; legacy backups remain readable. Exported sales extension is v2 and bundle v11, so older readers reject new data rather than dropping it. Restore remains private/paused and does not recreate operational grants.

Phase 1 verification: targeted money/store/backup suite 59 passed; typecheck/lint passed. Full run: 229/231 files passed (2,511 tests passed, one skip); remaining two assertions expected bundle v10 and were updated to v11, to be rerun before commit. Pinned engine `.37`.
