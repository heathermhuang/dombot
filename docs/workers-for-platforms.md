# Hosted platform capacity

The conference expansion uses a hybrid registry. Existing accounts retain their
immutable workspace IDs, static service bindings, D1 databases, keys, deployed
engines and schedules. Only new accounts use the dedicated untrusted Workers for
Platforms dispatch namespace. No inventory or publication is migrated.

Each platform workspace has its own Worker, D1 database, encryption root, gateway
key and WorkspaceCoordinator namespace. The gateway resolves an authenticated
account to an operator-owned qualified registry row. Script names derive from the
immutable UUID; HTTP callers cannot select scripts, databases or service bindings.
Legacy mappings take precedence. Disabling a workspace stops gateway admission.

`0009_platform_workspaces.sql` is additive. Gateway keys in the registry use
AES-GCM with a domain-separated key derived from the existing auth pepper and the
workspace UUID as authenticated data. Back up the registry together with the
existing pepper under the established private custody procedure. Moving an
encrypted key to another workspace or changing the pepper fails authentication.
Do not rotate the auth pepper without re-encrypting the platform registry.

`PLATFORM_ENABLED=true` and a `DISPATCHER` binding enable registry resolution.
Qualification and public eligibility are separate: `qualified_at` records a
successful provider/runtime qualification, while `signup_enabled=1` opens an
unused slot. Disabled, invited, closed and already-owned workspaces are excluded
from the same transactional allocation used by email and legacy password signup.
The SQL selection uses a fixed-size JSON binding and a registry subquery, rather
than hundreds of D1 placeholders or environment service bindings. Unique account
and email constraints serialize concurrent claims. Provisioning alone never opens
registration.

New platform deployments set `DOMBOT_PLATFORM_ALARMS=true`. The first admitted
owner request starts a five-minute Durable Object alarm. Scheduled sync uses the
same coordinator and request lock as API/MCP traffic; the account's configured
sync interval still determines when registrar synchronization runs. Old tenants
keep their existing cron schedules. The signed `/platform-internal/health` and
POST `/platform-internal/pause` endpoints support private provisioning probes;
the public gateway rejects both prefixes. Pause alarms after reserve qualification
so unused slots stay idle until first owner use. Never expose a namespace directly
or forward an owner signing key to a public lander.

Before enabling each batch, retain private resumable receipts for database and
script creation, migrations, exact bundle hash, unique DB/coordinator bindings,
pinned engine headers, signed workspace identity and alarm start/pause. Reconcile
uncertain mutations before retrying. Qualify two disposable tenants, then batches
of ten, fifty and the remaining capacity. Check foreign-key rejection and encrypted
state isolation on the disposable pair. Public slot counts must come from fresh
eligibility queries, with QA accounts excluded. A 500-person allocation test is
separate from physical provider capacity and actual inbox delivery.

The approved plan is US$25/month. Included script/request/CPU allowances are shared
with other projects in the same Cloudflare account; those projects must explicitly
use their own dispatch namespaces to benefit. D1, Durable Objects and overages are
separate usage charges. The application email campaign cap remains non-resetting:
10,000 attempted sends and 1,000/day shared by auth and inquiry notifications. At
US$0.35/1,000, the cap represents US$3.50 before tax without free allowance, below
the authorized US$10 campaign budget. Never reset the campaign ID or counter to
work around exhaustion. Real inbox and network receipts remain separate from
local captured-message tests and provider acceptance.

## Empty workspace maintenance

On-demand signup and post-conference reserve retirement are separate from sleeping
existing workspaces. See [On-demand portfolio provisioning](on-demand-provisioning.md)
for the gated replacement path, qualification and read-only retirement planning.

The opt-in empty-workspace policy replaces first-visit alarm activation with
strict work-based scheduling. See [Sleeping empty portfolios](empty-workspace-maintenance.md)
for rollout flags, reserve qualification, operator pause and explicit rollback rearming.
