# Administration and product health

## Outcome and scope

Give the operator a trustworthy answer to three questions: is the service working,
which users are affected, and what should be done next? The first release adds
read-only administration at `/admin`, linked from the account security page only
for an explicitly authorized operator. It adds no customer impersonation, registrar
writes, account suspension, payments, or deletion controls.

The UI follows the existing Archivo, forest and neutral account design. It works
without client JavaScript and preserves search and pagination on refresh. All
timestamps are labelled UTC; all unobserved readings say Unknown.

## Implemented first release

| Area | Behavior | Evidence boundary |
| --- | --- | --- |
| Health | `/health` checks the gateway control database; returns 503 on failure | Does not certify tenant, provider, email, proxy or backup health |
| Overview | User count, enabled users, unclaimed qualified capacity, observed domain totals, stale/unknown readings, portfolios needing attention | Inventory comes from stored tenant state, not live registrar requests |
| Users | Search email or immutable user/portfolio ID; paginate 25 at a time; creation date, access, domain count and observation time | Includes operator, QA and other test accounts; no inferred customer cohorts |
| User detail | Owned/imported/archived counts, each configured registrar account's state/count/last success, bounded operation history | No domain names, credentials, private notes or raw provider messages leave the tenant |
| Refresh | Observe up to 25 displayed users, at most four concurrently, eight seconds per tenant wait, rate limited | Retains last observation on failure; persists per-user attempt time and unavailable state; does not start a registrar sync |
| History | Last 100 sync/request/scheduled outcomes retained in each coordinator, with duration and safe failure category | Begins with this release; not a historical error-rate denominator or uptime measure |
| Authorization | Operator-maintained immutable user-ID allowlist; existing valid session plus five-minute fresh authentication; passkey required when configured | Empty/malformed allowlist denies all access; customer session never grants admin authority |
| Audit | Successful admin view and refresh actions record actor, action and time | Additional action-specific auditing belongs with future write controls |

### Counting contract

Owned names are deduplicated by ASCII domain name **within each user**, using the
same import and ownership rules as the portfolio. Connected-account inventory and
unmatched imports contribute; archived names do not. The aggregate sums enabled
users' observed holdings, so a name appearing in two users contributes twice.
This is not a globally unique-domain count. Disabled users are excluded from
aggregate holdings. Registrar account counts are cached rows, not unique owned
names; the labels intentionally distinguish them.

Snapshot coverage is separate from inventory freshness. A snapshot older than
15 minutes is stale. A configured active account with no successful sync is
Never; one whose last sync failed remains Failed even with cached holdings.
Registrar success becomes stale after the greater of 48 hours or twice the
configured automatic interval. The view is conservative and does not infer
that an empty portfolio is broken. Unknown portfolios never count as zero.

### Deployment and operator access

1. Run root and hosted locked installs, build hosted authentication, and pass
   typecheck, lint, engine verification, tests, security regression and Worker
   bundle checks.
2. Apply control migration `0012_admin_observability.sql`. It only adds metrics
   and audit tables; tenant portfolio schema and pinned engine are unchanged.
3. Deploy the tenant wrapper/coordinator to a controlled pilot and verify signed
   observation, direct/foreign/owner-proof denial and unchanged owner behavior.
   Gradually update the legacy and platform fleet using the existing release
   procedure. Preserve bindings, secrets, disabled slots and runtime provenance.
4. Deploy the gateway with `ADMIN_USER_IDS` still `[]`. It accepts a JSON array
   of existing immutable `users.id` values. Resolve the operator through an
   established account; never select by “first user”, sign-up order or email domain.
   Set only the verified operator ID in private deployment configuration. Do not
   commit the live ID or configure a public self-grant endpoint.
5. Sign in freshly and open Account security → System administration. Refresh
   both pages for the current 40-user population and reconcile the overview with
   the per-user readings. Verify ordinary users receive 403 on every admin route.
6. A tenant still running the old wrapper returns unavailable. Do not turn
   missing fleet coverage into a healthy result. Keep the feature disabled if
   operator identity or migration state is uncertain.

Rollback: empty `ADMIN_USER_IDS` immediately removes admin authority, including
existing sessions. Revert gateway/coordinator code using the release process;
retain the additive metrics tables. Do not delete customer data to roll back UI.

## Complete admin roadmap

### Priority 0 — Incident diagnosis and reliable monitoring

* Capture failed sync attempts at the actual registrar boundary, including MCP,
  initial connection and scheduled work. Store attempt ID, user/workspace,
  registrar/account opaque identity, trigger, start/end, classified outcome,
  last-good time and retry eligibility. Preserve failures across later success.
  Current wrapper history covers browser API sync and scheduled state; it does
  not claim complete MCP or connection-attempt capture.
* Use a deterministic scheduled observer, checkpointed by workspace and release,
  to update metrics in small batches. Only check active users; avoid probing
  hundreds of unused capacity slots or repeatedly decrypting unchanged data.
  Use the persisted attempt/unavailable state and last success to drive alerts.
* Measure HTTP errors separately from registrar/business failures returned with
  HTTP 200. Add denominators, latency percentiles, request correlation IDs,
  deployment markers, proxy queue/wait time and scheduler failures. Redact before
  persistence, including query strings and account labels.
* Component health: gateway, control D1, tenant storage/coordinator, proxy relay,
  proxy scheduler, registrar adapters, auth delivery, inquiry delivery, queue
  age, scheduled execution and backup age. Report unknown/stale/degraded/down
  independently; no fixed all-green endpoint.
* Define initial objectives from measured baselines: login success and latency,
  portfolio loading, sync completion by registrar, data freshness and recovery.
  Alert only on actionable threshold transitions; include runbook and affected
  user count. Add acknowledge/resolve and maintenance windows.

Acceptance: inject provider 429, auth rejection, network timeout, D1 failure,
tenant unavailability and a gateway exception. Each appears under the correct
component/user, survives a subsequent successful sync, and resolves through the
documented recovery. Ordinary users cannot discover other users or logs.

### Priority 1 — Support and user operations

* Add operator/support/read-only roles with explicit permissions and audited
  grants/revocations. Require strong authentication for all operators; require
  fresh authentication for every privileged action. Separate customer and admin
  sessions if access grows beyond a single trusted operator.
* User lifecycle: verified email/legal state, creation and last activity,
  registrar connections, onboarding funnel, storage/capacity use, sessions and
  grants. Keep QA/operator cohort tags explicit and auditable.
* Support timeline with sanitized incidents, previous recovery actions and
  contact status. Provide read-only diagnostics bundles and tightly scoped
  downloads with expiry, access audit and PII controls.
* Add narrowly scoped, idempotent retry controls only after read-only monitoring
  is reliable. Respect per-registrar/proxy quotas and distinguish retrying an
  inventory read from a registrar purchase, renewal, transfer or DNS mutation.
* Session/MCP revocation, account pause/resume and recovery: show affected
  identity and consequences, require fresh auth and reason, audit before/after,
  use concurrency guards and verify actual resulting state. Never reveal a
  password, registrar API key or backup secret to support staff.

Acceptance: role-denial matrix, revoked operator/session tests, stale-auth tests,
concurrent lifecycle requests, replayed retry and provider-quota tests. No silent
impersonation; any future support session needs explicit scope, expiry and audit.

### Priority 2 — Fleet, usage and delivery operations

* Fleet release inventory with actual coordinator engine/source, drift,
  migration status, capacity qualification, canary cohorts and rollback status.
* Domain/registrar counts over time, active-user cohorts, import vs connected
  inventory, onboarding and freshness trends. Define all windows and population
  filters before publishing KPIs; never treat reserved slots as customers.
* Email/inquiry delivery attempts, backlog, retries, bounces and provider budgets;
  proxy/provider request and cost attribution with capacity headroom.
* Backup manifests, retention and scheduled restore drills in an isolated
  workspace. A backup file or recent job alone is not recovery proof.
* CSV exports with authorization, formula-injection protection, retention limits
  and audit. Defer global domain search until there is a justified support use
  case and a separate privacy/permission design.

### Priority 3 — Governed business and destructive administration

* If paid plans are introduced: entitlements, subscription/payment webhooks,
  reconciliation and usage budgets. The current free product has no invented
  revenue or billing state.
* Account closure, retention and purge tooling with legal/operator policy,
  preview, fresh auth, explicit final confirmation, audit, idempotency and
  post-action verification. Preserve the existing 30-day accidental-closure
  recovery policy until deliberately changed.
* Feature flags, maintenance controls and provider kill switches with audience,
  reason, expiry, staged rollout and rollback. Avoid arbitrary configuration
  editors or shell/SQL consoles in the web admin.

## Remaining implementation limits

The first release stores 100 events per workspace and current snapshots, not
long-term analytics. Refresh is operator initiated and bounded, not a periodic
fleet health certification. Whole-user list queries are appropriate for the
current small population; use indexed server pagination and SQL aggregates
before expanding substantially. A failed refresh retains the prior
reading and marks the latest attempt unavailable. Set explicit audit retention/export policy
before wider staff access. No production rollout is implied by passing local tests.
