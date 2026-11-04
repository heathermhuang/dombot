# Full upstream DomBot integration

This integration merges all upstream main history through
`ccb918deed20f8d01009970064027fcb021bac97` (4 November 2026, DomBot 2.0.0).
It supersedes the selective 1.5.2-hosted.34 sync. The hosted engine records that
exact upstream revision; its additional code supplies hosted account, tenancy,
operations and compatibility capabilities.

The canonical application is upstream Domains with Owned/Listings/Archive,
Sales, Renewals, Activity and Settings. Settings includes Markets, Sync and
Import/Export. Afternic, Sedo and Atom adapters, listing writes/jobs, market
statistics, sale records/fees/profit, pending transfer actions, currency
conversion, demo fixtures and MCP tools are integrated. The Listings view follows
upstream and appears when a marketplace is connected. Owners supply their own
marketplace credentials; this release does not create provider accounts or
publish/list domains automatically.

`upstream-parity-20261104.json` pins the upstream inventory. Regression checks
require every one of its 91 core API methods and 73 named MCP tools, stock routes
and settings sections. All normal upstream and hosted behavioral suites remain
in scope. The merge ancestry must contain the pinned upstream head.

The 2.0.0 sync includes ownership-verification TXT tools and marketplace identifiers,
GoDaddy optional API settings and privacy-consent context, normalized nameservers,
cent-level currency formatting and upstream responsive action menus. New verification
writes retain hosted scopes and fresh authentication. Existing accounts, credentials
and public pages are preserved; integration itself does not perform registrar writes.

## Hosted adaptations

- Signed tenant admission, encrypted credential storage, fresh authentication,
  account isolation and existing gateway budgets remain authoritative. Market
  credential reads/changes and market writes have the same fresh-auth protection
  as registrar operations. Read-only OAuth cannot register market writes or
  transfer approvals. Paid registrar tools require an explicit newly approved
  `domains:spend` grant, with fresh identity and a charge warning. Legacy grants
  stay read-only, legacy workspace connections stay unable to spend, and token
  request parameters cannot expand permissions. No paid provider call is made
  during release qualification.
  Shared MCP supports explicit read/manage/paid consent, with existing grants migrated
  as read-only. Control migration 0021 persists the granted scopes; token parameters
  cannot upgrade them. `SHARED_MCP_MANAGEMENT_ENABLED` remains off during reader
  rollout and is enabled only after every serving tenant understands scoped proofs.
- The first connection can be a registrar or marketplace. Structural credential validation
  precedes on-demand allocation; provider acceptance is checked in the private tenant. Migration 0020 preserves pending identities and
  extends the connection reason to `market`. Credentials never enter the control
  database or provisioner metadata. Market-only accounts retain background work.
- Managed egress, Dynadot recovery/quote continuation and pinned registrar patches
  remain. Unknown or malformed Retry-After values use bounded finite recovery.
- Upstream storage schema 5 moves away from manual Archive/Hidden. Removed
  historical events and folder intent are retained in encrypted, exportable
  `hosted-legacy-events` and `hosted-legacy-folders`; they do not override current
  upstream ownership or expose domains publicly. Migration copies before deletion.
- Backup envelope 12 includes the complete upstream data plus hosted extensions
  and retained history. It imports upstream v9 and older supported bundles. Older
  hosted binaries must reject v12 before mutation instead of dropping data.
- Upstream's sale-record model owns `src/shared/sales.ts`. Existing hosted public
  selling terms/inquiries use `hosted-sales.ts`, without changing their persisted
  schema or existing anonymous URLs. Root `/sales` is upstream Sales. Old owner
  inquiry-page routes remain compatibility paths; their listing index is
  `/public-listings`. They do not replace or gate upstream navigation. Public
  profiles remain a hosted addition, with existing opt-in/review controls.
- Desktop installation/updating remains upstream; hosted About/update information
  identifies the managed engine and deployed source. Public brand/source/legal
  attribution follows project instructions.

## Release qualification

Validate migration and backup round trips, credential protection, scope coverage,
market-only onboarding/scheduling, pinned engine/UI integrity and browser flows
on synthetic marketplace data. Build all Worker adapters and require CI/CodeQL.
For release, coordinate production writers, capture private encrypted recovery
points, deploy compatible readers and control migrations, qualify a controlled
tenant, verify migration-preserved history and publication state, then promote
other tenants, the future template and registry. Restore the allocation policy
and verify actual serving coordinator provenance. Local/CI checks are not evidence
of customer marketplace credentials, live provider acceptance, sales or adoption.

After a schema-5/backup-12 write the rollback floor must understand that storage;
use the compatible source and a reviewed recovery/revert rather than installing
an older binary over migrated data.
