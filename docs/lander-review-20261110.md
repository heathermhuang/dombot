# Bulk lander connection pre-deployment review

Reviewed PR #214 against main `1bc5c5f2f2b821f1aa82ce508f5a47d43f698f66`.
The user subsequently requested “Review and deploy”. This authorizes the code and
additive schema rollout while automatic DNS activation remains disabled; it does
not select arbitrary holdings or waive the provider/controlled-fixture gate.

## Corrected findings, in severity order

- **P1: Restore could discard an unknown forward-write outcome.** A timeout plus
  a read of the old record does not prove the submitted change will never arrive.
  Restore now holds an unobserved forward intent, preserves conflicts and only
  reverses an exact observed application. A regression delivers the late write
  after restore was requested and verifies cutback without forward replay.
- **P1: Dependencies could change after review.** An apex-dependent MX/SPF record
  added after preparation could survive while its service was broken by cutover.
  Every routing step now repeats dependency analysis on the current complete
  snapshot, allowing for this job's already-applied changes. The regression adds
  an apex MX after the proof writes and verifies that web routing stays unchanged.
- **P2: Control-loss refresh could advance the cleanup epoch.** Cleanup now
  validates the retained connection generation and the specific control-lost or
  detached transition, then detaches using its current epoch. Repeated cleanup
  remains idempotent; a newer generation is not adopted.
- **P2: Failed preparations could retain unrecoverable locks.** Recovery now
  schedules a preparation cleanup even without an executable plan. Only retained
  provider IDs or qualified correlation can authorize resource cleanup; unknown
  submissions remain held. Locks release after cleanup acknowledgment, allowing a
  fresh review. New manual hostname plans clear stale connection provenance, so
  an old cleanup cannot delete the newer setup.

The three focused Worker suites pass 39 tests. The complete suite, required CI,
engine boundary checks, root/Worker/hosted typechecks and lint must pass on the
updated head before merge. Existing unchanged presentation evidence remains
applicable; the recovery control remains available during preparation/review.

## Remaining release boundary

No further blocking findings were identified for the **disabled** code/schema
rollout after tracing tenant admission, publication review, provider intents,
lease/generation, backup and recovery paths. Actual DNS activation still requires
qualified service credentials, root/www endpoint and TLS evidence, and an exact
owner-authorized unused fixture. Current operator SaaS reads returned HTTP 403;
that is not proof of a specific missing entitlement. No paid plan is inferred.

The deployment must retain original accounts, credential/publication fingerprints,
active hostnames, all existing bindings and schedules, allocation policy and the
qualified future-template bindings. Take protected code/settings snapshots and
Cloudflare bookmarks before writes, deploy a code canary, and use the trusted
production-import QA lease and cleanup path for runtime qualification.
