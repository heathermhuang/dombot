# Empty workspace scheduling implementation plan

Date: 27 October 2026 (Asia/Singapore)

Status: proposed implementation; no application or production changes made.

## Outcome and scope

An account that only signs up and browses an empty portfolio must not acquire a
permanent five-minute maintenance loop. Existing customer isolation, account IDs,
databases, keys, browser sessions and MCP grants remain intact. A customer with
useful background work keeps receiving it even if they never sign in again.

The first release removes avoidable scheduling. It retains allocation from the
qualified workspace pool. Separating account creation from workspace allocation,
shrinking the existing reserve fleet and deleting resources are separate changes:
this release must not imply that it eliminates per-tenant deployment overhead.

## Evidence and implementation baseline

Plan against the hosted fork, initially inspected at `f55f9fd` (#105), rather than
the older primary checkout. Refresh the implementation base before coding and
preserve unrelated changes. Relevant owning sources:

- `src/hosted/workspace-coordinator.ts`: any admitted owner request starts an
  alarm; `alarm()` unconditionally rearms after five minutes in `finally`.
- `src/worker/index.ts`: scheduled execution hydrates state and performs inquiry
  reconciliation/cleanup before checking whether auto-sync is disabled.
- `src/worker/engine-contract.ts`, `src/worker/engine.ts`: the supported pinned
  engine interface. Hosted wrappers must not import engine internals directly.
- `src/hosted/tenant.ts`: signed private operator endpoints and legacy cron entry.
- `src/worker/sync-monitor.ts`: diagnostics reads fetch one encrypted row without
  portfolio hydration or registrar calls.
- `src/hosted/sync-monitor.ts`: a separate fleet monitor still periodically reads
  diagnostics for enabled users. Removing tenant alarms does not remove this cost.
- `docs/dombot-engine.md`, `.github/workflows/ci.yml`: artifact and release checks.

Earlier production inspection found 513 platform Workers and 40 enabled accounts.
Stored snapshots covered 38 accounts; 37 had no configured registrar. These are
dated observations, not a current empty-workspace classification. Snapshot absence,
zero domains and a failed registrar request must never be interpreted as empty.

## Release-one scheduling policy

Use three maintenance states, independent of account access:

| State | Evidence | Scheduling behavior |
| --- | --- | --- |
| Empty | Complete authoritative inspection confirms no maintenance-bearing customer state | No platform alarm |
| Work present | At least one relevant account, holding, publication or outstanding task exists | Preserve current maintenance cadence |
| Unknown | Read/decrypt failure, unsupported version, incomplete inspection or uncertain task state | Preserve existing cadence; bounded diagnostic, never classify as empty |

For this first release, classify conservatively. Any configured registrar account,
including a disabled or currently failing account, retains existing behavior.
Any imported or cached holding, archive/history requiring reconciliation,
publication, inquiry record with retention work, queued/leased/retryable outbox
item, or persisted background job excludes the workspace from the empty group.
Inspect actual records and task state, not whether a migrated table exists.

Settings, empty folders, sessions, passkeys and an OAuth grant alone do not imply
registrar maintenance. Inventory all current scheduled responsibilities before
implementing the predicate; any unaccounted responsibility produces Unknown.
Do not change existing expiry enforcement or introduce new cleanup promises.

This deliberately leaves optimization of import-only portfolios, disabled
registrars and exact next-due scheduling for a subsequent measured change.

## Work package 1: authoritative engine contract

Add a narrow typed maintenance-state export to the engine contract. It returns
only the classification, schema version, sanitized reason categories and a
state revision. It does not return credentials, domain names or private content.

Compute the result inside the engine's established root lease and request lock,
from persisted state after successful writes have flushed. Cover both encrypted
document storage and publication/inquiry SQL tables. Do not combine several
independent UI/admin reads and treat that as an atomic emptiness decision.

Make the current scheduling responsibilities explicit in a reviewed policy
module, with tests for each reason to retain maintenance. Ensure all persisted
mutations that can introduce or remove work invalidate the maintenance result,
including browser API, MCP, import/restore, publishing and internal inquiry/mail
paths. A small explicit mutation classification must default unknown operations
to requiring re-evaluation; do not silently rely on a short route allowlist.

Pack and verify a new pinned engine artifact following `docs/dombot-engine.md`.
The hosted wrapper uses only the supported export. Preserve self-hosted and
desktop behavior in this release.

## Work package 2: coordinator lifecycle

Replace alarm creation on every owner request with maintenance reconciliation:

1. On initial upgrade/first authoritative inspection, classify the workspace.
2. Reads, static assets, login, health checks, admin snapshots and diagnostics
   must not independently start an alarm or mark the workspace activated.
3. Before delegating a request that may create background work, durably record
   that maintenance is dirty and establish a recovery alarm. This covers a
   crash after the engine commits but before the wrapper reconciles scheduling.
4. After the mutation, await reconciliation against current persisted state.
   Empty deletes the platform alarm; Work present/Unknown retains it. Failed
   mutations also reconcile, because a failure does not prove nothing committed.
5. Before a platform alarm executes the engine's scheduled handler, classify:
   Empty clears the alarm and exits without scheduled hydration/bookkeeping;
   Work present/Unknown preserves the established execution behavior.
6. After scheduled execution, reconcile again. Remove unconditional rearming.

Serialize scheduling decisions through one coordinator queue. A delayed decision
must never clear a newer mutation's recovery alarm: use a durable generation and
compare the generation when committing alarm changes. Do not hold a storage
transaction open while fetching engine state. Re-read when a generation changes.
The durable dirty marker and alarm provide recovery across eviction/restart.

Use a per-tenant rollout flag with the old behavior as its default. Explicit
operator pause must survive this reconciliation, or be clearly defined as a
separate maintenance control; a concurrent alarm must not silently undo it.
Keep account disablement/closure distinct from an empty but accessible account.

## Work package 3: observability and migration

Extend the signed private health/status surface with maintenance state, reason,
observed revision/time and next alarm. Expose sanitized summaries in the existing
operator console. Empty/sleeping is intentional and must not look like an outage
or a successful registrar sync. Preserve existing access and reauthentication.

Leave the separate Dynadot diagnostics monitor unchanged in release one. Its
reads must not set maintenance alarms. Report its requests separately so measured
savings are not overstated. Reducing that polling requires its own freshness and
retained-event delivery design; do not suppress pending incidents using an old
empty snapshot.

Existing platform alarms self-classify on their next firing. Use one bounded,
resumable operator reconciliation for already-paused accounts if needed; inspect
current state at execution time, with a checkpoint, rather than running a recurring
full-fleet audit. Never start alarms on unused reserve slots to classify them.
Legacy tenant cron configuration remains unchanged for this release and must be
reported separately from platform alarm savings.

## Verification and acceptance

Add meaningful engine policy and real coordinator integration tests:

- Signup/empty browsing creates no recurring platform alarm. Repeated reads,
  diagnostics, public requests and MCP discovery do not restart it.
- Connecting a registrar starts maintenance; a configured registrar with zero
  domains, failed credentials or sync disabled retains conservative behavior.
- Imports, publication, inquiry/outbox/retention and persisted jobs never disappear
  from the policy just because the account has no registrar or recent login.
- Removing the last work source sleeps only after durable state confirms Empty.
- Empty existing alarms stop; active accounts continue with their existing sync
  interval and inquiry behavior. Legacy schedules remain compatible.
- Crash after commit/before reconciliation, restart, concurrent connect/delete,
  a late alarm, explicit pause and read/decryption failures cannot lose required
  work or let an old Empty decision overwrite newer activity.
- Foreign-workspace, ordinary-owner and anonymous proofs cannot operate the
  private maintenance controls. No state/secret leakage through public responses.

Run required engine integrity verification, typecheck, lint, full tests, separate
security regressions, relay checks and the existing CI Worker/UI build matrix.
Update the integration test that currently requires `getSettings` to start an
alarm; do not preserve that assertion as the desired behavior.

Production canary acceptance requires both functional and resource evidence:

- For a controlled empty account, confirm no alarm and no scheduled-operation
  growth for 20 minutes, including repeated foreground and diagnostic reads.
- For a controlled account with work, observe at least one actual due maintenance
  cycle and verify cached outcomes; a wakeup or HTTP 200 alone is insufficient.
- Use existing authorized fixtures or local registrar stubs. New real registrar
  connections, external mail and real inquiry sends require their own authorization.
- Compare alarm invocations, coordinator storage operations, D1 reads/writes and
  monitor requests over matched before/after windows. Publish observed reductions;
  do not turn avoided wakeups into an unverified invoice saving.

## Rollout and rollback

Ship one cohesive engine/wrapper change with the flag disabled. Qualify a
disposable empty tenant and a controlled active tenant first, including the
activate-after-sleep path. Preserve current live bindings, encryption roots,
account mappings, grant state and publication/holding fingerprints.

Enable only the tested empty canary, then a small cohort of currently confirmed
empty platform accounts. Observe the acceptance windows before expanding. Roll
the compatible artifact to reserve slots without waking their coordinators.
Only advance when runtime engine/source provenance matches the intended release.

Rollback turns off the new policy and uses a checkpointed signed operator action
to rearm affected admitted accounts. A flag change alone cannot wake an account
whose last alarm was deleted. Keep the additive state readable across versions;
do not delete customer resources or change credentials to roll back scheduling.

## Follow-up decision after measurement

Reassess reserve capacity and provisioning only after recording signup rate,
first useful action, actual provision/qualification latency, failure recovery and
fleet rollout costs. Account-only signup requires explicit support for users with
no workspace in authentication, sessions, routing, MCP discovery and onboarding,
plus transactional allocation/retry behavior. It must be planned as that complete
change rather than hidden inside a scheduler patch. Existing workspace identities
must remain stable, and any resource retirement requires a separate exact plan.
