# Park.io inventory connection

Park.io is a read-only inventory source. It adds the domains and ISO expiry dates
reported by the authenticated Active export to the private Domains.Domains
portfolio and cached MCP queries. It does not provide renew, transfer, DNS,
privacy, lock or auto-renew operations. Those controls remain in Park.io.

## Connect and recover

In Settings → Registrars, choose **Connect Park.io**. The same native input form
works on phones and desktop; no extension, cookie copying or device selector is
required. Username/password and supported verification codes travel directly to
an isolated, temporary Browser Run tab. The password is not saved. Unsupported
provider verification has an explicit secure provider step.

After authentication, the server captures the qualified session, verifies browser
closure and its portable export read, then transfers the candidate privately to
the user's Worker. That Worker independently checks account identity and reads
the Active CSV before activating an encrypted inventory snapshot. Refreshing or
returning to the page resumes the same operation; it cannot import twice.

The owner-only feasibility pilot may be promoted with **Add domains and enable
updates**, after explicit consent to the connection's retention policy. This
reuses its already verified sign-in. The original pilot's 24-hour retention is
not extended by qualification reads. Only a consented transfer creates a normal
connection, which keeps the session for at most 30 days from capture, or its
shorter provider expiry. The original bounded follow-up due time is carried into
the first connector schedule when still applicable.

After success, source cards show saved count, last successful check, nominal next
check, pause/resume, manual update, disconnect and review controls. Manual checks
are at least an hour apart; automatic checks are about daily. The existing global
auto-sync Off setting stops scheduled reads. Status refresh only reads receipts.
Disconnect removes session material and retains the last saved inventory.
Session expiry, an auth redirect, a challenge or an account mismatch preserves
that inventory and asks for another sign-in.

## Qualified provider contract

The authenticated Orders page is `GET /orders/index`. Its account navigation
contains `/users/edit/{accountId}`. The Active export discovered in the signed-in
Active view is `/orders/export/active/{accountId}.csv`. The numeric identifiers
must agree. An account-edit request is not required and is never part of the
production refresh. The Orders page may show the All export; the server-captured
Active URL remains the exact account-scoped target.

Each refresh performs only the fixed Orders read and that Active CSV read over
HTTPS. Redirects are manual and are not followed. App credentials are never
forwarded. The known cookie profile is `parkio_user_signin` and `flashId`, scoped
to Park.io with path/expiry handling. Known rotations/deletions are persisted
separately from snapshot validation. Foreign, partitioned and unsafe cookie
contracts stop reuse. HTTP success containing a login HTML page is not an empty
portfolio.

The observed CSV columns, in order, are `Order ID`, `Domain`, `Created Date`,
`Paid Date`, `Amount (USD)`, `Expiration Date`, `On park.io`. Positive on-platform
rows require a populated paid field. Only canonical domain, validated numeric
order ID, available ISO expiry and observation/missing timestamps are retained.
Purchase dates, amounts and unknown fields are not imported. Unknown flags,
conflicting duplicates, invalid dates, broken quoting or schema drift reject the
whole response. Responses are bounded to 2 MiB and 10,000 rows.

These are provider-reported observations. They do not establish registry title,
publication control or permanent session lifetime. API registrar facts win on
overlap. Park.io observations remain separate from user-entered imported records,
notes, folders, prices, history and publication data. No sales or departure events
are inferred. If multiple Park.io sources report a name, the display selects its
freshest positive observation while keeping every source's health visible.

## Persistence and concurrency

Tenant migration `0010_parkio.sql` adds private source, credential and immutable
snapshot-chunk tables. Account metadata, inventory and session material use
separate purpose-derived encryption keys and authenticated row scopes. A fourth
key creates the account index; numeric provider IDs are not stored as plaintext
indexes. One provider account cannot be connected twice in a workspace.

Each source has a revision, lifecycle epoch, credential pointer and active
snapshot generation. A durable operation/lease precedes network access. Snapshot
chunks are staged before a conditional pointer swap, so partial files never
become visible. Pause/disconnect/reconnect fence stale completions. Interrupted
reads are held rather than silently replayed. An idempotent activation identifier
allows a lost response to be reconciled from the stored result.

Missing names remain saved and get a missing-from-latest-export flag. New missing
names or an expiry regression require a revision-bound review. Review pages show
the affected names and dates, 100 at a time. Accepting a review never deletes a
missing name; rejecting it keeps the previous snapshot. Reviews expire after
24 hours. Active, previous and reviewed generations are retained; bounded cleanup
removes unreferenced stages. Limits are ten sources and 20,000 retained
observations across the workspace.

Source operations use independent SQL state, rather than the registrar namespace
request lock. Status and lifecycle controls remain responsive during provider
I/O. Concurrent maintenance markers keep recovery alarms armed while an
independent write is in flight. An unresolved marker conservatively retains
maintenance until its outcome is reconciled; it is not treated as empty work.
The existing maintenance cadence executes due checks without a model or open tab.

Backup format 13 adds the Park.io extension. Ordinary backups contain saved
observations and metadata, never Park.io cookies. Restore fences old operations
and requires reconnection. Older runtimes must reject the newer format rather
than silently omit these observations.

## Temporary browser admission

Gateway migration `0024_parkio_login_slots.sql` and the `ParkioLogin` Durable
Object limit active browser admission globally to two. Each owner/workspace has
one active sign-in, a ten-minute absolute login window, three-minute browser idle
limit and three acquisitions per UTC day. Captured candidates expire after
15 minutes. The browser must be verified closed before a portability pass or
handoff. Unknown acquisitions/closure retain their slot; elapsed time alone never
proves closure. Cleanup failure holds further acquisition for reconciliation.

An intent is bound to workspace, user, consenting SaaS session hash and operation
identifier. A replaced tab cannot acquire a controller or activate its successor.
Logout triggers cleanup; the broker also checks session/workspace validity on
bounded alarms, covering revocation while the page is absent. No recording,
password persistence, raw provider errors or credential-returning browser API is
introduced. Keep invocation/body tracing disabled on these paths.

## Deployment and qualification

`DOMBOT_PARKIO_ENABLED` controls the tenant capability; its absence is closed for
new reads. Saved inventory remains readable if updates are disabled. Gateway
`PARKIO_CONNECTOR_ENABLED`, `PARKIO_CONNECTOR_WORKSPACES`, `PARKIO_LOGIN`,
`PARKIO_BROWSER` and `PARKIO_LOGIN_SECRET` control interactive admission. The
committed defaults are disabled. The login secret must not rotate while a browser
or cleanup obligation exists. It is separate from tenant encryption roots and
the temporary owner pilot's key.

Release the reviewed engine/UI, tenant migration and gateway class migration
before enabling admission. Preserve qualified managed bindings, assets, secrets,
original accounts and existing schedules. Confirm maintenance alarms are enabled
for the target deployment. Update the future template with its qualified bindings;
do not replace it with the generic minimal template.

First qualify the actual receiving Worker with the private one-shot
`qualifyTenant` operation. It checks the owner baseline and identity without
writing inventory or extending pilot retention; any permitted rotation returns
only through the private service boundary to the encrypted pilot. Return only
aggregate receipts to the operator. Customer import requires its own consent.
Fresh production import tests use the repository's trusted QA-run lease and
cleanup workflow. Source/CI, gateway deployment, receiving-worker reads, actual
customer import and longer session durability are separate evidence planes.
