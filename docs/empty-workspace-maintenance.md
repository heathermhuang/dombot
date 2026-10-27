# Sleeping empty portfolios

Platform tenants may opt in to `DOMBOT_EMPTY_SLEEP=true` alongside
`DOMBOT_PLATFORM_ALARMS=true`. Both are operator-controlled deployment variables.
The default retains previous behavior. Legacy cron tenants keep their schedules.

The engine strictly inspects persisted documents and publication/inquiry tables
under its request lock. Confirmed empty accounts have no platform alarm. Saved
registrars (including disabled or failing ones), holdings, imports, publications,
retention records and background jobs preserve existing maintenance. Unsupported
or unreadable state retains scheduling. Login age is never an eligibility rule.

Browser reads and the separate diagnostics monitor do not activate maintenance.
Potential mutations establish a durable recovery alarm before entering the engine,
then reconcile after the result, including failures. Coordinator operations are
serialized; a durable generation prevents a stale inspection from deleting a
newer alarm. Crashes between application commit and reconciliation retain a dirty
marker and recovery alarm. Each alarm rechecks current work before execution and
after completion. No five-minute successful-sync record is added for sleeping.

The signed private health and admin-snapshot responses include the policy,
classification, observation time, dirty state, generation and next alarm. Only
operator proofs (no ordinary owner, MCP delegation or anonymous lander authority)
may use `/platform-internal/health`, `/pause`, `/reconcile` and `/resume`.
The gateway rejects this entire internal prefix on public/customer routes.

- `POST /platform-internal/reconcile` applies current policy to current state.
- `POST /platform-internal/pause` records an explicit operator pause. Requests
  and late alarms preserve it.
- `POST /platform-internal/resume` clears that pause and reconciles. With the
  new policy off, it explicitly rearms the old schedule for rollback.

Do not use an explicit pause merely to make an unused qualified reserve idle.
For the new policy, reconcile an empty reserve after qualification instead; it
can activate normally when its owner introduces work. Existing reserve slots
paused before this change have no persistent pause marker and remain compatible.
Do not wake all reserve coordinators as a routine audit.

Rollout starts with controlled empty and work-bearing tenants, then currently
confirmed empty customer cohorts. Verify 20 minutes of no empty-account scheduled
activity and actual completion of a due controlled maintenance task. Compare
provider resource counters over matched windows. The separate Dynadot monitor
still reads diagnostics; sleeping does not mean zero requests or zero cost.

Rollback requires both restoring the old policy and an explicit signed resume
for affected admitted accounts. Changing a flag cannot wake an account whose
last alarm has been deleted. Preserve immutable identities, bindings, credentials,
grant state and database contents throughout rollback.

The qualified reserve pool and one runtime/database per workspace remain. This
release does not implement account-only signup, on-demand fleet provisioning,
automatic account deletion or resource reclamation.
