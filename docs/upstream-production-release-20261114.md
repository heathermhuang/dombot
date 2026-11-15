# Upstream production release, 14 November 2026

Domains.Domains serves engine `2.2.2-hosted.1`, SDK `1.3.0-hosted.1` and gateway/application source `65d2beff448a20ee04a622f0073c6943c4f8a45f`. The public source offer was verified after release. Detailed operational evidence is retained privately.

The source merge is [PR #234](https://github.com/heathermhuang/dombot/pull/234), merge `22b1dd3d0c07b65dc6c03a3af75c2c82df849f61`. Engine source digest: `17e8ce727115781fe02d4033589ac058e8c8093b0ca3b91c72f32a362227429d`.

The complete upstream main through `c933ae929c147c97bf34e4fce2eef38d026d247c` is included: released v2.2.2, folder ordering, filter clearing, registrar default nameservers, Gandi unknown-outcome reconciliation and SellerHub documentation. Both new MCP writes preserve hosted OAuth scopes and exact-account restrictions. The cumulative SDK safety patches are retained, including path validation for the new Gandi reset operation.

## Source validation

Exact-head CI passed 3,434 application tests with one existing skip, four security regressions, four relay checks, root/Worker/hosted typechecks, lint, integrity, all six Worker dry-run bundles, web/demo/site builds and both CodeQL analyses. The SDK passed 711 offline tests and its typecheck/build. These counts describe source validation, separately from production observations.

## Source rebuild boundary

Use the full repository at the pinned release commit for source rebuilds. The private engine artifact's embedded source snapshot still carries the earlier SDK archive, while its package lock and runtime use SDK 1.3.0. The current SDK archive and cumulative source/test patches are included in the full repository and are integrity-pinned. Aligning that embedded snapshot with the active SDK is a packaging follow-up; standalone rebuild from that embedded snapshot is not qualified by this release.

The embedded-source packaging follow-up is addressed by corrected artifact `2.2.2-hosted.2`; see [the source-snapshot repair](engine-source-snapshot-20261115.md). The runtime release above remains the dated production record.

Controlled DNS-fixture qualification is separate and unfinished. This upstream release does not establish that acceptance.

[Public source/version receipt](upstream-production-release-20261114.json) · [Source qualification](upstream-sync-20261114.md)
