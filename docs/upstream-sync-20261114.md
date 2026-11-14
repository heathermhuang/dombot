# Upstream synchronization, 14 November 2026

Candidate merges the complete upstream main at `c933ae929c147c97bf34e4fce2eef38d026d247c` (41 commits after the previous hosted base), including released v2.2.2 and subsequent folder ordering, filter controls, registrar default nameservers, Gandi unknown-outcome reconciliation and SellerHub documentation. The matching SDK is 1.3.0-hosted.1 and engine/UI is 2.2.2-hosted.1.

The cumulative hosted SDK safety patches apply to upstream SDK 1.3.0. SDK source, test patches and integrity metadata are retained in vendor. Hosted OAuth scopes and account restrictions also cover the two new MCP writes, `folder_order_set` and `domain_nameservers_reset`. Branding remains Domains.Domains. The optional upstream Claude review workflow is retained but restricted to the upstream repository; this sync does not enable a new integration.

Existing encrypted credentials, inquiry/publication boundaries, per-account routing, lander recovery and fresh-auth rules are retained. Folder ordering uses the existing persisted folder array; this source merge adds no namespace or migration. Removed unused folder settings are no longer editable, while existing stored objects are preserved by reorder and updates.

This document records a source candidate. Verification, checked PR, merge and managed fleet deployment are separate milestones. No provider writes or domain cutovers are part of source verification. The unfinished 015.io live connection, working-target restoration and reconnection qualification remains a separate task; its previous time-limited approval has expired.

## Verification

- Patched SDK: 711 offline tests, typecheck and ESM/CJS/declaration builds pass. The new Gandi reset path regression fails before the validator is applied.
- Application: 317 files / 3,434 tests pass with one existing skip. Security and relay suites each pass four tests. Root/Worker/hosted typechecks and lint pass.
- Web/demo/site builds and all six required Worker dry-run bundles pass. Final artifact boundary and affected-suite verification are recorded independently after the SDK path-validator addition; exact-head CI remains required.
- Existing hosted scope and account-policy regressions cover the two new upstream MCP writes. No provider write is used by these checks.
