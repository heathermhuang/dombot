# Bulk lander connection pre-deployment review

Reviewed PR #214 against main `1bc5c5f2f2b821f1aa82ce508f5a47d43f698f66`.
The user subsequently requested “Review and deploy”. This authorizes the code and
additive schema rollout while automatic DNS activation remains disabled; it does
not select arbitrary holdings or waive the provider/controlled-fixture gate.

## Corrected blocking finding

**P1: Restore could discard an unknown forward-write outcome.** After a provider
timeout, a fresh read showing the old record does not prove the submitted change
will never arrive. The restore path previously advanced past that record and
could remove its hosting resources. `LanderJobs.step` now holds restore while the
forward intent is unobserved, preserves conflicts, and only reverses an exact
observed application. The regression test injects a timeout, requests restore,
then delivers the late write and verifies cutback without replaying the forward
operation.

The affected job suite passes 19 tests. The complete local suite passes 3,299
with one existing skip. The pinned engine/UI artifact was rebuilt and verified;
root, Worker and hosted typechecks and lint pass. Required CI must be green on the
updated head before merge. Existing unchanged browser and provider-contract
fixtures remain applicable.

## Remaining release boundary

No further blocking findings were identified for the **disabled** code/schema
rollout after tracing the tenant admission, publication review, provider intent,
lease/generation, backup and recovery paths. Actual DNS activation still requires
qualified service credentials, root/www endpoint and TLS evidence, and an exact
owner-authorized unused fixture. Current operator SaaS reads returned HTTP 403;
that is not proof of a specific missing entitlement. No paid plan is inferred.

The deployment must retain original accounts, credential/publication fingerprints,
active hostnames, all existing bindings and schedules, allocation policy and the
qualified future-template bindings. Take protected code/settings snapshots and
Cloudflare bookmarks before writes, deploy a code canary, and use the trusted
production-import QA lease and cleanup path for runtime qualification.
