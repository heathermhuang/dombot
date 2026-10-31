# Owner sites

An owner can introduce themselves, describe their interests and welcome conversations
without displaying any domains. Collections explain a deliberate selection; projects
show what the owner is building. This improves presentation and contact. It does not
claim to acquire buyers, verify project ownership or increase sales.

## Owner workflow

Open **Your site**, choose a name and address, and create a private draft. The address
is fixed after creation. Add profile text, optional public email and HTTPS links.
A profile with no domains is a complete site and requires no registrar connection.

Collections and projects start excluded. Choose their domains, order the selection
with the accessible move buttons, then explicitly include the section on your site.
A selected empty collection cannot publish. Incomplete excluded sections can remain
in the draft. Catalogue browsing is optional, starts off, and uses only checked names.
Adding inventory never adds a name to any public selection.

Domain details have one availability and asking price across all sections. New
selections start **Not for sale**. **Open to inquiries** requires a public email;
a price is optional. Current holdings require a fresh, unambiguous ownership check.
Previously owned names require the owner's explicit assertion, do not imply a sale,
and cannot accept inquiries. Projects' domain references use the same checks.

Preview uses the public renderer with contact and external navigation disabled.
Review lists the precise before/after disclosures, including removals, section order,
links, contact, descriptions, names and prices. Only **Publish changes** updates the
public snapshot. Publication returns a live link and dated receipt. Unpublish removes
public access and retains the private draft; downloaded/indexed copies cannot be recalled.

## Compatibility and storage

The existing encrypted draft and public snapshot tables hold strict versioned JSON;
no database migration is required. v1 documents have no `version`; owner sites use
`version: 2`. Unknown versions and extra fields fail closed. Anonymous routes read
only the published snapshot, before private initialization, without registrar calls.
All responses remain `no-store`. Owner endpoints and previews remain `noindex`.

Existing v1 pages retain their original renderer and content. **Update your site**
previews a deterministic draft conversion and requires an explicit save, followed by
review and publication. It preserves selections, descriptions, collections, email,
prices and historical assertions. Private entries stay unselected. The converted
catalogue contains exactly the old public selection. Conversion never republishes.
Oversized legacy content reports validation errors instead of truncating it.

`/p/:handle` remains stable. Collections use `/p/:handle/c/:slug`; old
`?collection=Title` bookmarks resolve only a known published collection. Unknown
selections return a scoped not-found result, never the wider inventory. Legacy search
and history bookmarks use the explicit converted catalogue. Disabled catalogue queries
cannot disclose anything else. The gateway permits only these exact public paths;
editor, draft, preview and other workspace routes keep their existing owner checks.

The editor reuses the existing serialized autosave, bounded reads, revision conflicts,
retry and reload protocol through `DraftSession`. Its domain picker reads private
inventory without creating a second inventory. Existing registrar management remains
available independently of site publication.

## Operator rollout and recovery

`DOMBOT_OWNER_SITE_V2=true` enables v2 creation, conversion, draft writes and publishing
for one instance. Missing/other values keep it off. Only an operator binding enables
it; request parameters cannot. Off retains compatible public reads, preview, export and
explicit unpublish. A legacy editor cannot overwrite a v2 draft. Backup imports of v2
drafts also require the flag; the root-key rotation script checks it before rotating.

Deploy compatible readers before enabling writes for that instance. Rebuild the pinned
engine with `npm run engine:pack`, update its npm integrity from the resulting engine
lock, reinstall that exact archive, and run `npm run engine:verify`. Do not bypass the
engine export boundary or deploy source with an old packaged renderer/runtime.

Inspect live bindings, ingress, schedules and routing; do not deploy placeholder
configs. Preserve all existing vars/secrets and tenant IDs. Save owner-only database
backups plus semantic pre/post receipts. Start with an existing controlled synthetic
QA account; keep ordinary accounts off. Deploy the gateway only when its public-route
allowlist changes. Feature deployment does not publish or convert owner content, alter
DNS, cut over the legacy personal portfolio, or update the product homepage.

Export/import includes the versioned draft. Invalid/future versions fail before mutation.
Restore creates a new revision and leaves the site unpublished, including after root-key
rotation. Enable the compatible v2 flag before restoring/rotating v2 content. Do not use
a v1-only binary for v2 import, rotation or rollback.

Emergency recovery: disable v2 writes while retaining a dual-reader runtime. Export the
draft and explicitly unpublish if content must stop being served. Retain this compatible
release as the rollback floor after any v2 write; earlier v1-only engines cannot read it.

## Validation boundary

Synthetic browser checks and automated regressions demonstrate software behavior.
They are not customer interviews, sales lift, independent review or formal CSO clearance.
The consenting owner/visitor study in [the plan](owner-site-plan.md) remains the gate
for broad enablement. No external participants are contacted by this implementation.

## Integrated publishing runtime

The owner-only presence inspector uses existing inventory and bounded reads. It
never calls providers or publishes holdings. Searches and pages preserve exact
tab-local selections; saved drafts recover separately. Profile-only, standalone
Sales and shop-only workflows remain available. Address setup is optional in
Settings.

Install tenant migration `0008_publication_change_sets.sql` before combined review
or withdrawal. `DOMBOT_OWNER_SITE_V3` gates explicit v3 conversion/content writes;
`DOMBOT_COMPOSITE_PUBLISH` gates content-adding combined commits. Both default off.
Existing v2, Sales and inquiry flags retain their scope.

Combined review freezes exact domain fields and memberships over the published
baseline. Unrelated saved edits stay pending. Profile, Sales, explicit shop
membership, events, review consumption and receipt commit in one guarded D1 batch.
Persisted generations fence standalone dependency writers. Reviews expire after
15 minutes. Retry the same operation key or fetch its receipt after response loss.
The initial limits are 100 exact names, 800 statements and a 750,000-byte review
payload. Oversized operations are rejected without truncation; separate batches
never imply global atomicity. Concurrent unrelated dependency writes can require
review again. DNS, provider and mail writes are outside this transaction.

V3 links bind to reviewed Sales revisions/terms. Changed, paused, sold or expired
pages suppress linked prices and actions, without an email fallback. Standalone
Sales reviews identify affected profile links. Independent email prices retain
legacy fractional amounts. A linked inquiry does not expose the account email.

Withdrawal removes exact names from tenant public references, Sales and shop
membership. It preserves holdings, private descriptions, conversations, hostname
reservations and unrelated drafts. Empty collections become excluded drafts;
v2/v3 retain profile-only output. The final legacy name unpublishes the legacy
page. Receipts exclude external marketplaces, DNS and cached copies. Inspection,
export, pause, withdrawal and unpublish retain access/revision checks with writes
disabled.

V3 stays inside backup envelope version 9. Validate cross-object link identities
before restore; restore privately, revoke public projections, invalidate reviews
and receipts, and require rebinding. After any v3 write, rollback must retain a
v3-compatible reader/backup runtime. Root rotation either qualifies compatibility
before changing the key or safely rejects before mutation.

Release compatible readers with new writes off, then qualify only an existing
controlled QA tenant. Broader opt-in enablement remains held until a consenting,
owner-selected pilot completes seven days and at least five owner workflows,
including price maintenance and withdrawal. Insufficient workflows retain the
hold without an automatic retry loop. This is a manual release gate, not a new
automation. Real inquiry delivery needs the existing controlled-mailbox workflow
and fresh receipts; synthetic tests establish neither delivery nor usefulness.
