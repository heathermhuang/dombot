# On-demand portfolio provisioning

Production signup uses on-demand provisioning as of 29 October 2026. The conference
reserve is no longer a capacity target. Reserve retirement is a separate, guarded
operation with its own manifest, backups and completion receipts.

## Account lifecycle

With `ON_DEMAND_ENABLED=true`, a qualified template digest, the private provisioner
binding and the existing legal/mail gates, signup creates a user, session and an
immutable control-database portfolio identity. It creates no customer Worker,
customer D1 database, encryption root or registry allocation. Password signup and
email signup use the same transaction/cap rules. The default total-account cap is
500; this is an admission ceiling, not a request to pre-create 500 resources.

The gateway serves onboarding directly. Reading that page, choosing a registrar,
opening account settings and signing in again do not allocate a tenant. The first
submission with the required registrar credential fields, or an explicit CSV
import action, requests provisioning. The credentials remain in the browser and
the original connection request; they never enter setup RPC or control metadata.
After qualification, the original request uses the normal tenant connection path.
Registrar credentials are saved only after that connection succeeds.

Allocation starts on the connection **attempt**, since the isolated engine must
exist to execute the provider connection test. A rejected connection can leave an
allocated empty tenant; it sleeps and retries reuse the same resources. Import-only
portfolios remain supported. This change does not reclaim existing customer
workspaces, including customers who have not connected a registrar.

## Provisioning and recovery

`Provisioner` is a service-binding RPC entrypoint. HTTP serves only renderer assets;
it cannot invoke provisioning or read private template files. Neither Workers.dev
nor preview URLs are enabled. The provisioner holds its own scoped infrastructure
token, not the gateway auth pepper or customer registrar credentials.

One `PortfolioSetup` Durable Object serializes each portfolio's setup. It durably
records the immutable owner/template and independently generated root/gateway keys
before provider writes. Those setup keys remain in its private storage for recovery;
they must not be logged or exported into public artifacts. Unknown database-create
and Worker-upload outcomes are reconciled by deterministic names, source digests
and bindings. Existing resources with conflicting identities are never overwritten.
Template changes during an incomplete setup stop for operator reconciliation.

The new tenant applies all schema statements and the bootstrap receipt in one D1
batch. The receipt uses the existing migration metadata table so strict empty
classification still works. An existing non-bootstrap database is refused.
Qualification checks actual engine/source headers, workspace identity and an empty
maintenance state with no alarm. Only then does the gateway atomically add the
encrypted registry key and activate the portfolio. A concurrent closure prevents
admission. Failed setup retains resources for recovery; it never deletes them.

Unstarted portfolios appear as “Not started” in administration and are excluded
from registrar monitoring. Pausing on-demand signup leaves their onboarding and
account access available, but permits no new allocation or reserve-pool fallback.

## Build and activation

1. Install locked root/hosted dependencies and run `node hosted/build-auth.mjs`.
2. Run `npm run engine:verify`, then `node scripts/prepare-on-demand.mjs BINDINGS_JSON`.
   The optional input contains operator-reviewed non-secret host/service bindings.
   The output includes a pinned module, schema and renderer, with a template digest.
3. Use the exact currently qualified live engine/features when preparing production
   artifacts. Mainline's pinned engine is not evidence that unrelated gated features
   may be deployed. Preserve the current live source and all existing bindings.
4. Configure the provisioner with the actual control DB, existing dispatch namespace,
   account ID, asset-service name and printed `TEMPLATE_SHA256`. The checked-in DB ID
   is a placeholder; the production namespace must be read from the live dispatcher.
   Set `CF_PROVISIONING_TOKEN` as a secret with the required account-level D1 create/read
   and dispatch-script read/write permissions. Set `TENANT_SECRETS_JSON` as a secret
   containing only approved managed-proxy secrets (`{}` when none are required).
   Preserve the selected live relay/scheduler and managed egress configuration.
5. Apply only `0017_on_demand_workspaces.sql` to the control DB when unrelated
   migrations remain gated. Deploy the provisioner before adding its gateway binding.
   Keep `ON_DEMAND_ENABLED=false` until controlled live qualification passes.
6. Configure the gateway's `PROVISIONER` service binding with entrypoint `Provisioner`,
   and set `ON_DEMAND_TEMPLATE_SHA256` to the exact qualified digest. Prove a controlled
   signup creates no provider resources; repeated visits and invalid/foreign requests
   create none; connection/import creates one isolated pair; retries reuse that pair.
   Existing customer runtimes, keys, grants, access and stored records must remain
   unchanged. Source/unit/CI checks are separate from these live release receipts.
7. Enable on-demand signup only after those receipts pass. Retain the template digest
   if pausing signup later; this keeps unstarted users' onboarding accessible.

## Conference reserve retirement

`scripts/plan-reserve-retirement.mjs ACCOUNT OUTPUT` is read-only and takes an
existing token from `CLOUDFLARE_API_TOKEN`. It identifies qualified, unowned,
uninvited, unclosed candidates, checks other control records, verifies exact DB/
workspace/coordinator bindings and inspects all stored-table presence. Unknown
schemas, stored records and unavailable reads retain the resource. The proposal
contains no delete operation or automatic account reclamation.

The planner saves checkpoints every 20 resources. A restart reuses completed
receipts for the same gateway source for at most 30 minutes. It stops immediately
on a real rate limit or after three consecutive provider failures. Unavailable
readings are retained, not converted to empty state. Initialization records in an
unowned reserve still require classification; an unowned database is not proved
customer-data-free merely by having no user row.

Before any eventual deletion: qualify the replacement signup path, produce an exact
resource manifest and backup/preservation receipt, then atomically remove eligible
slots from allocation while rechecking ownership, invitations, closures and records.
Revalidate the manifest against current provider bindings and stored state. Keep
every claimed, changed, unknown or data-bearing resource. Resource deletion needs
explicit authorization for that concrete manifest and is irreversible; this source
change does not authorize it. Reconcile uncertain deletes before retrying.

## 28 October read-only checkpoint

The live registry contained 513 platform rows, 46 users and 42 enabled users;
477 enabled unowned/uninvited/unclosed rows were candidates. The checkpoint retained
260 checked candidates because stored records were present. It issued no safe-delete
proposal. Cloudflare returned HTTP 429/code 7429, and inventory requests stopped.
The remaining candidates and the stored initialization records are unqualified.
No customer Worker/database was created, deleted or migrated during this inspection.

## 29 October production activation

The gateway at domains.domains runs source
`6992a3bd5b71804ec79dc2c86be75428a984320e`, built from the previous production
revision plus the qualified provisioning changes. The existing tenant engine
remains `1.5.2-hosted.24-queue`; activation does not deploy unrelated mainline
features to existing customers. The private production provisioner uses the
existing control database and dispatch namespace, with its approved infrastructure
token and host secrets installed as Worker secrets. Temporary token files are removed.

Controlled production qualification proved that signup, repeated onboarding visits
and rejected connection requests create no customer resources. The first explicit
import action created one isolated Worker/database pair, and import preview passed.
The QA account was closed through the ordinary account flow and keeps normal
retention. The isolated canary separately exercised credential-submission forwarding
against a fixed fixture. No real registrar connection or external email was sent
by these qualification checks.

The exact retirement manifest qualifies 476 unused reserves. The bulk classification
decrypted initialization-only records to schema version 4 using original key custody.
Ten older reserves instead passed the existing signed runtime's strict empty-state
inspection, with matching trusted runtime code; their backup records explicitly
disclose that the original encryption roots were not exported. Unknown or
customer-bearing resources remain excluded.

Migration 0018 records retirement custody in `retired_platform_workspaces`. The
operator freezes still-unreferenced identities, archives their encrypted platform
registry mappings, then removes them from `platform_workspaces` before deleting
provider resources. Disabled workspace identities and the audit remain, so fleet
updates cannot recreate retired slots. Deletion results and final customer
preservation checks belong in the private operation receipt; this documentation
does not replace those checks or authorize another retirement.
