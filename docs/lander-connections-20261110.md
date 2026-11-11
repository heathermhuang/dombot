# Bulk lander connections: source candidate and release qualification

This implements the reviewed [execution plan](one-click-lander-implementation-20261110.md).
Update 11 November: the reviewed code/schema is deployed with automatic DNS
disabled. See [the release record](bulk-lander-release-20261111.md). This is not
evidence of a production DNS cutover.
The dirty primary checkout is preserved; implementation is isolated on
`codex/bulk-lander-connection`.

## Seller interaction

Select domains across pages, or choose all matching Sales listings, then **Use our
lander**. The server freezes the exact set into an immutable parent manifest,
prepares eligible items in bounded slices, and presents one combined publication
and DNS confirmation. The exact count includes held names. Standard new drafts
contain only the domain and a neutral inquiry path, with no inferred price.
Existing custom drafts and published content are retained. Shop publication is
held for its separate control. Once admitted, background work needs no open tab
or additional approval for internal batches. Recent jobs support recovery and
paginated per-domain receipts.

The existing Sales draft/publication jobs retain their separate 500-item limit.
This connection workflow has an explicit 20,000-name manifest limit and 100-item
result pages. It never truncates all-matching selection to the browser page.

## Authority and preservation

The initial native adapter is Cloudflare DNS, which may differ from the domain's
registrar. It requires an exact active full zone, an exact configured provider
account ID, current nonempty matching authoritative NS evidence, complete
paginated record reads, DNSSEC state and forwarding/routing inspection. Missing
permissions are holds. Provider snapshots are encrypted with tenant Sales keys;
owner responses expose only the relevant diff and approved public projection.
The explicit encrypted snapshot ceiling is 500,000 encoded record bytes; an
oversized zone is held without truncation or mutation.

Record-level PATCH/POST/DELETE operations preserve unrelated records, record IDs
on updates, TTL, proxy state, comments, tags and settings. No call uses
`setDnsRecords`. Wildcards, multiple web address records, existing proxied/O2O
routing, HTTPS/SVCB at changed owners, relevant subdelegations, provider forwarding,
MX/SRV/alias dependencies and SPF a/mx or external includes produce conservative
holds. Independent DKIM, DMARC, CAA, DNSSEC and unrelated records remain intact.
DNSSEC/delegation is never changed by this mode. Providers without qualified
native operations are held, rather than advertised as automatic.

The service target is trusted operator configuration. Cloudflare apex flattening
and its actual root-domain endpoint require controlled qualification. Resolved
edge IP addresses are never copied into routing records. Both root and www have
separate ownership/certificate proofs, exact edge routes and ordinary HTTPS
receipts. A signed probe alone cannot mark a connection live.

## Jobs and lifecycle

Tenant migration `0012_lander_connections.sql` stores encrypted manifests,
snapshots, intents, generations, finite leases and recovery archives. Control
migration `0026_lander_connections.sql` adds a fair workspace drain index and
hostname lifecycle provenance. New purpose-bound signed admission is restricted
to `/sales-internal/lander`; owner/public proofs cannot use it. Owner actions keep
existing origin, account, fresh-authentication, closure/suspension and rate limits.

The gateway's existing deterministic maintenance schedule advances up to four
workspaces and four steps per workspace per invocation. It keeps the other
maintenance tasks and budgets. Exact-account DNS/control preflight precedes
hosting resource preparation. Hosting preparation does not write DNS or publish
pages; retained provider IDs and exact routes precede the read-only final
DNS plan. Custom metadata correlation is used only when its existing entitlement
is explicitly qualified; the default does not request this restricted feature.
With that correlation, unknown creation is reconciled only to the same generation.
Uncorrelated unknown creates are held for operator reconciliation; unrelated
resources are never adopted. Ambiguous route creation is held for
operator reconciliation. No paid entitlement is accepted automatically.

Before each DNS write, the controller rechecks the account/zone/authority,
publication, complete parent and internal digest, generation, lease and prior
verified mutations. It persists intent before submission. A timeout which is
already observable reconciles without another write. A submission not yet
observable is held rather than blindly replayed. Certificate proofs precede web
cutover, and web routing waits for TLS. Provider APIs lack global conditional
atomicity: an external edit between the last read and submission remains a race;
record-level diffs and post-write readback limit and expose it.

Cancel stops future work and retains unknown outcomes for inspection. Restore
checks every reverse diff against the current exact record, preserves unrelated
later edits and stops on conflicts. Previous web routing is restored before
service detachment; final route/certificate cleanup requires exact retained
resource identities. An ambiguous cleanup remains a recovery hold. Existing
published pages are not silently removed by DNS restoration.

Backup format 17/Sales v5 exports complete private recovery payloads through the
existing protected backup path. Import reseals them into a private recovery
archive, clears execution locks/jobs and imports no publication, host bindings,
resumed work or DNS authority. Older formats remain supported. A compatible
reader must remain available after new recovery records are accepted.

## Actual live gate, corrected 11 November 2026

The gateway already contained a complete portfolio-hosting service configuration
and the Sales edge-key secret binding. The earlier missing-key inference used a
plaintext-value check on a secret binding and was incorrect. PR #216 now reuses
the complete existing provider without mixing partial credentials. Its private,
fixed-path service inspection returned HTTP 200 and an active fallback origin.
The earlier HTTP 403 used the distinct CLI OAuth credential and did not prove
the service secret lacked access. Automatic DNS remains disabled. The owner has
selected `015.io` and authorized a one-time Park.io-to-Dynadot DNS move; live DNS,
root/www TLS, ordinary HTTPS and restoration remain unqualified. See the
[current candidate and qualification record](dynadot-lander-qualification-20261111.md).
No paid plan was enabled or support outreach initiated.

Before enabling this release, qualify the exact hosting zone, fallback target,
edge admission, provider capacity and endpoint without a new paid commitment;
configure purpose-scoped service credentials through the existing secret path;
and obtain an exact owner-authorized unused root/www fixture and its DNS account.
Record its original complete zone, conduct the reviewed reversible cutover,
verify ordinary public HTTPS and restoration, then expand only the qualified
scope. Do not substitute arbitrary existing holdings or old sample names.

Shared Domains.Domains authoritative NS remains a follow-on mode under the same
controller. It requires real assigned nameservers, complete isolated zones,
DNSSEC/DS migration, entitlement/cost qualification and explicit separate consent.
This release neither provisions a shared DNS service nor changes delegation.

## Verification

The new DNS/controller/hosting fixtures cover pagination and metadata, dependency
holds, a 521-name multi-page selection, exact combined approval, durable controller
recreation, bounded scheduled progress without a browser, wrong-purpose and
cross-tenant admission, unknown submissions, publication races, stale generations,
finite leases, TLS-before-cutover, ordinary root/www HTTPS, provider identity,
conflict-aware cutback, cleanup and private backup restore. Browser qualification
uses the repository's disposable local account fixture and intercepted synthetic
connection replies; it is presentation evidence, not provider qualification.

Run hosted auth install/build first, then the repository CI checks and pinned
engine verification. Source, CI, deployment and real provider/live observations
must be reported separately. No traffic, inquiry or sale uplift follows from
synthetic connection tests.

Provider contracts were checked against Cloudflare's current
[Worker origin/routing guide](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/worker-as-origin/),
[hostname routing and proxy-mode matrix](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/hostname-routing/),
and [restricted custom-metadata feature](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/custom-metadata/).
Documentation compatibility is separate from the missing live provider fixture.
