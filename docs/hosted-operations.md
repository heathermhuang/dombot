# Managed early-access operations

The gateway maps operator-provisioned slots to private tenant Workers. Configuration
accepts up to 32 unique workspace IDs and `WORKSPACE_0`–`WORKSPACE_31` service bindings.
A missing service/key fails closed. New keys use `EXTRA_GATEWAY_KEYS`, which cannot
replace an existing `GATEWAY_KEYS` entry. Provision and verify the Worker, distinct D1,
root key, gateway key, coordinator and private ingress before enabling its control row.

Use the live gateway configuration, not the public templates, for every deployment.
Keep the engine artifact and its web assets together. Capture owner-only D1 exports,
namespace/publication fingerprints and live binding/schedule/ingress snapshots first.
For the first coordinator rollout, pause the workspace gateway row and cron schedule,
allow existing operations to drain, deploy, verify, then restore its schedule and enable
row. Roll pilot tenants before the founder. Preserve keys, data, sessions and public URLs.

## Capacity and invitations

`node scripts/hosted-account.mjs status --config <private-gateway.json>` reports ready
capacity without printing customer identities or credentials. The operator uses the
same Cloudflare authentication as Wrangler; no credentials are committed in this repo.

Create a private JSON request containing `email`, then run:

```sh
node scripts/hosted-account.mjs invite --config <private-gateway.json> --request <private-request.json> --output <private-invite-receipt.json>
```

The command atomically reserves an enabled, configured unclaimed slot. The private
receipt contains the invitation URL, valid for 24 hours. Deliver it only to that customer
through the agreed channel. The CLI does not send mail. Do not paste links into logs,
issues or shared documents. It never prints usable links to stdout.

A timeout leaves a pending receipt. Reconcile that exact receipt before retrying:

```sh
node scripts/hosted-account.mjs reconcile --config <private-gateway.json> --output <private-invite-receipt.json>
```

Reusing an existing receipt does not issue another credential. A stale or conflicting
receipt requires inspection and a deliberate new issuance. Do not advertise immediate
onboarding when ready capacity is zero. QA workspaces must remain separately identified
and disabled after their controlled test; they are not customer capacity.

## Account recovery

The account page shows the signed-in email and workspace label. Customers can
sign out the current browser or all browser sessions without changing their
password. All-browser sign-out derives the affected user from the current
session, requires the service's own Origin, and deletes that user's stored
sessions before clearing the cookie. Login throttling never blocks current-browser
sign-out. Paired MCP grants remain separate; revoke them in MCP settings when a
device or agent may be compromised. Password changes still revoke browser sessions
and pending recovery links.

Sign-in errors preserve the validated local return path and email, never passwords.
Recovery password-validation errors retain the existing link so a customer can
correct a mismatch without requesting another one; the atomic one-use/expiry check
still applies when the corrected form is submitted.

The customer can open `/recover` or the support link from sign-in. Identity verification
is operator-assisted during early access. Never issue a link solely because someone
supplies an account email. Verify through an established trusted channel or independently
confirmed domain/registrar ownership and record the support case. Never request their
password, registrar API keys, recovery backup or MCP bearer token.

After verification, create a private request with `email`, `identityVerified: true` and
`caseRef`, then run:

```sh
node scripts/hosted-account.mjs recovery --config <private-gateway.json> --request <private-request.json> --output <private-recovery-receipt.json>
```

The new link replaces any previous link for the account and expires in 15 minutes.
Only its hash is stored in D1. GET does not consume it. A successful POST consumes it
once and atomically changes the password and revokes all browser sessions. Concurrent
submissions cannot both succeed. Disabled workspaces cannot recover. The customer signs
in normally afterward. Paired agents remain a separate credential and can be revoked in
MCP settings after sign-in; escalate suspected agent-token compromise separately.

Reconcile an uncertain issuance using its receipt rather than generating another link.
Expired/used links return a recoverable error and a support contact. Test issuance,
expiry/reuse, session revocation and login only with controlled QA accounts.

## Recovery and release receipts

D1 exports and root keys form a recovery pair. Keep both in protected operator storage.
Restore a backup into a separately named QA database/Worker first; never overwrite a live
customer database as a drill. Compare semantic account/domain/draft/publication identity
and verify the restored private journey. Disable test routing afterward. A rollback must
retain the coordinator class/namespace and preserve current D1 data and secrets.

The current offer is invite-only managed early access. Public paid signup, automatic
fleet provisioning, billing and per-operation registrar spend approval are separate
features, not implied by a successful release or sync. Hostname cutover additionally
requires verified DNS/TLS, mail-record preservation and fresh OAuth resource pairing on
the new hostname.

## Restoring exports with large encrypted documents

A SQL export can contain a sealed cache/publication value larger than D1's SQL-text
limit. A plain SQL-file import can therefore fail even though the live value is valid.
Use the bounded restore tool with a dedicated database named
`domains-staging-restore-<drill-name>` and a private config binding that database as `DB`:

```sh
node scripts/hosted-backup.mjs --config <private-restore-config.json> --file <protected-tenant-export.sql> --receipt <protected-restore-receipt.json>
```

The tool parses the export in an isolated local SQLite memory database, disables
extension loading/filesystem attachment, and sends values as bound parameters with
bounded statement/parameter counts. It verifies target identity and exact table data.
It refuses any target row outside the selected backup and never deletes target data.
An uncertain result can be reconciled with the same source/target/receipt: matching
rows are retained, missing rows are inserted, and each completed table is checkpointed.
No credentials or document values are printed. Python 3 is required for local parsing.

After restoring the data, configure only the private drill Worker with the matching
backup encryption root, keep cron disabled, verify the authenticated inventory and
publication, then disable its routing and restore its original test bindings/keys.
Do not point this tool at a live customer database. Retain the backup, key and receipt
in protected operator storage.

## Free service limits and public access requests

The public `/signup` form accepts requests for review. It does not allocate infrastructure
or issue an account credential. Ready slots remain operator-qualified and invitation-only:
32 configured immutable workspace identities maximum; the existing pool is ten private
Workers/D1s, including separately disabled QA slots. Never recycle a customer identity or
database into the available pool. Expand capacity through the existing controlled provision,
backup, isolated deployment and qualification procedure before issuing more invitations.
Autonomous public fleet provisioning remains unavailable.

The queue holds at most 100 email addresses, expires requests after 30 days, accepts at
most 20 requests globally and three per source IP in ten minutes, and returns a capacity
error rather than silently discarding a full-queue request. The form gives the same response
for new and duplicate addresses and makes no immediate-access promise. Export pending
requests into a protected file for operator review:

```sh
node scripts/hosted-account.mjs requests --config <private-gateway.json> --output <new-private-request-export.json>
```

Use the existing `invite` flow after verification and available-capacity qualification.
The tool never emails an invitation automatically. Pending request exports contain private
contact information and must not appear in shared reports or source control.

Gateway allowances per workspace are 600 MCP POSTs and 3,000 authenticated API requests
per ten minutes. Provider-refresh API requests share 20 per ten minutes. Newly selected
auto-sync intervals must be disabled (`0`) or at least 60 minutes; existing settings are
preserved by deployment. These limits do not promise unlimited holdings, storage or provider
quota, and are not a guarantee against every denial-of-service attack.

All three paid MCP tools (register, transfer and renew) are denied at the gateway, even
when an existing OAuth grant includes `domains:spend`. The early-access agent budget is
zero. Browser actions retain their existing explicit controls and registrar charges.
No nonzero agent-spend approvals or budgets are advertised. Existing OAuth scopes still
apply; gateway policy can only reduce access.

Optional protected `MCP_POLICIES` JSON maps immutable workspace IDs to `allowedTools` and
`accountIds`. A selected account restriction requires explicit `accountId` for a tool that
actually supports it, rejects portfolio-wide aggregation, and denies tools outside the
allowlist. An empty account list leaves the selected tools workspace-wide. Configuration
is operator-managed during early access, separate from revoking a paired client in Settings.
Never put tokens, passwords or registrar keys in this configuration.

## Closing and erasing a workspace

`/account/close` requires the current browser session, same-origin POST, current password
and the exact confirmation `CLOSE MY WORKSPACE`. It first pauses auto-sync and MCP through
the existing tenant coordinator so earlier work drains, then atomically disables the owning
workspace, records a closure with a 30-day retention deadline, and removes its browser and
recovery sessions. The gateway denies all subsequent private, MCP and published-collection
requests for that workspace. Other owners remain enabled. Registrar registrations, account
credentials at the provider, and domain settings are not changed.

Closure suspends access; it is not a claim of completed physical erasure. Support can recover
an accidental closure within retention using independently verified identity. The operator
reviews closure receipts, stops the tenant cron, and purges the retired Worker/D1 and matching
backup/key material only after the retention deadline and documented custody/recovery checks.
Keep a tombstone of the immutable ID and never return a retired slot to the invitation pool.
Do not promise automatic physical deletion until its durable job and off-device retention
process have been qualified. A failed pause leaves the account accessible for retry; an
uncertain control transaction must be reconciled before repeating it.
