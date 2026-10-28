# Public-profile read timeout — 28 October 2026

The public-profile editor could time out while optional renewal-price or registrar work held the engine request lock. The hosted maintenance scheduler can add a second queue in front of that lock. The browser's existing 15-second read deadline then expired before the publication handler ran.

The repair keeps a detached inventory/account view after complete hydration and successful persistence. Authenticated publication GETs use that view for reconciliation and continue reading the saved draft and published snapshot directly from D1. They bypass both provider queues once the inventory view exists. Each review recalculates ownership freshness using the current time. Cold reads still hydrate under the original lock.

Every write, conversion, publish and unpublish retains the serialized hydrate/handle/flush path. Publishing uses current service state and the existing revision and ownership checks. The cached view is replaced rather than mutated, is detached from provider mutations, and is cleared when boot configuration changes. It contains plain data, never request-owned promises or responses. The existing read deadline and authentication/origin controls are retained.

The displayed live-profile URL also resolves absolute and relative links correctly, preventing a repeated origin prefix.

## Evidence

- The forced held-queue regression failed on the previous publication route and passes with the repair.
- Tests cover the actual Worker route under a held engine lock, both publication read endpoints, the hosted maintenance queue, queued writes, unauthenticated access, detached cache replacement/reset, and ownership aging.
- The existing publication D1 integration suite passes all 19 tests.
- Typecheck, lint, engine integrity, four security regressions, and four relay checks pass.
- The `.21` engine contains the Worker and matching UI assets. No database migration is required.

The full local suite was attempted and stopped after a platform fixture exceeded its unchanged ten-second setup deadline. The identical fixture also fails at the identical hook on the unchanged `.20` release in this environment. The full suite is therefore not locally qualified; CI remains required. No timeout, assertion or test exclusion was changed.

This is a prepared source repair, not a production acceptance record. Production remains on the previous release until an authorized rollout verifies the serving engine, data preservation, profile loading during pricing, and the displayed/copyable public link.
