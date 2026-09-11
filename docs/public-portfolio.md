# Public portfolio publishing

This is the first hosted-product milestone: reconcile connected registrar
inventory against a curated collection, edit a private draft, and publish only
explicitly selected public fields. It is a **single-owner, self-hosted instance**
feature. It does not add SaaS signup, multi-tenancy, billing, or new MCP grants.

## Unified Domains and Public page

The hosted application has one **Domains** catalog. Every row has a **Public page**
status with direct **Add to public page**, **Edit**, and **Remove** actions. Select
multiple inventory rows to use **Add N to public page**. Registrar and listing
column presets are available under **More domain options**.
Visiting **Public page** and returning also preserves that catalog context.
Changing filters clears selection; changing the account filter cannot silently
retarget a selected domain to another account.

The registrar columns reuse the existing controls for folders, renewal, auto-renew,
privacy, locks, nameservers, forwarding and transfer authorization. Each domain
must resolve to one exact, enabled registrar account before these controls appear.
Historical, unmatched, deleted, and unavailable-account records have no registrar
actions. Duplicate-account records require an explicit account filter. A mixed
selection with any unavailable target disables the entire registrar bulk action;
it never silently operates on a subset. CSV export explicitly names the count of
registered records included.

The listing columns show inquiry availability, collections and asking prices.
Adding a domain edits only the private draft. **Draft · ready to add**, **Live**,
and **Live · removal pending** distinguish draft selection from publication.
Removing a live name keeps it visible in the page list until publication;
**Keep on page** cancels that removal. A pending-changes banner links to review. Newly discovered domains
start private. Bulk inquiry changes apply only to current listings; history
requires an explicit ownership assertion and never accepts inquiries. Collections
support explicit Add, Remove and Replace operations. Undo is invalidated when
reloading or unpublishing so it cannot overwrite a newer saved draft.

The default **Inventory** scope shows registered domains. **Page list** includes
live names and draft additions, while **Not added** contains names neither live
nor selected. History, all records and verification filters live under More
domain options. The catalog retains
ownership, collection, account, TLD, expiration, private-folder and nameserver
filters. Hidden private folders remain hidden until selected explicitly.
Nameserver details are fetched on demand for the filter; reference records never
trigger provider reads. Unknown dates/prices sort last, and all account-dependent
filters and prices use the selected account consistently.

**Public page** contains presentation settings, preview and publication review,
not another domain list. Choose domains returns to the same catalog with listing
columns. The old `#/public-portfolio` bookmark redirects to `#/public-page`.

Preview is on demand and uses the existing escaped public-field renderer.
**Review changes** flushes autosave, refreshes ownership and compares the draft
with the actual published snapshot. Only **Publish changes** changes the public
page. Private unmatched candidates never block unrelated valid listings.

Serialized autosave, stale-tab conflict rejection, in-memory edit recovery and
explicit publication are unchanged. If publication metadata is unavailable,
registrar management remains accessible through the existing inventory view.
Closing the browser warns while unsaved edits remain; this is not an offline store.

This change needs no database migration, credential change, domain import or
publication reset. The original portfolio at domains.domains remains independent
of the product testing host. Electron retains its existing registrar interface.

## Deploy and recover

Apply `migrations/0002_publication.sql` before releasing this code. The normal
deployment command already applies pending migrations. Preserve the existing
instance database, encryption root, and host routing. This change does not move
any domain, change DNS, or publish an existing collection automatically.

Settings → Sync → Export includes the publication draft in the sealed backup.
Restore validates it before changing data, re-encrypts it under the destination
root key, and removes the current public page. **Restoring never publishes.**
An older backup without this extension clears the publication draft and page.
The normal root-secret rotation workflow uses the same export/import endpoints;
after rotation, review and republish the retained draft explicitly.

Do not deploy an older version and rotate the root key with it: it would not
know about the publication draft. Keep a backup made by a version that supports
the feature. Desktop imports do not currently retain this web-only extension.

## Data and authorization boundary

- `portfolio_drafts` holds one AES-GCM encrypted draft and a random revision.
- `published_portfolios` holds only the explicitly approved public projection.
- `/publishing` and `/publishing/preview` require the existing owner session.
  Mutations also require the same-origin check and reject oversized bodies.
- `/p/:handle` is mounted before private boot. It queries the published table
  directly, validates its narrow schema, and never hydrates or decrypts the
  private inventory or credentials. The reader still shares the instance's D1
  binding; it is an application boundary, not a separately permissioned database.
- Save and publish use database revision comparisons to reject stale tabs.
  Unpublish invalidates outstanding previews in the same D1 transaction.
- HTML escapes every user-controlled string. Public responses use restrictive
  CSP and `no-store`, so service caching does not delay removal. This cannot
  retract copies already downloaded by visitors or indexed by search engines.
- Publication is available in the owner UI only; no new agent publishing tool
  or ambient approval has been introduced.

A successful inventory sync can surface new discrepancies in the review screen.
It does not automatically modify the published snapshot. The owner must review
changes. Historical ownership is not independently verified by this feature.

## Local verification

Use an isolated checkout and local-only `.dev.vars`. Build the renderer, apply
local migrations, and start Wrangler on `127.0.0.1:8791`. Set the preview password
to `local-portfolio-preview` or pass `DOMBOT_DEMO_PASSWORD` when seeding.

```sh
npm run web:build
npx wrangler d1 migrations apply DB --local
npx wrangler dev --ip 127.0.0.1 --port 8791
# A separate terminal; replaces LOCAL data with synthetic, nonfunctional credentials:
node scripts/seed-publication-demo.mjs --replace-local-data
```

The seed script rejects remote origins. It disables scheduled sync and MCP and
does not create a public page. Run `npm test`, `npm run typecheck`, `npm run lint`,
and `npx wrangler deploy --dry-run` for the required checks. Publication tests
exercise actual local D1 SQL through Miniflare; they need permission to bind
loopback sockets. Browser-check desktop/mobile editing, imports, historical
selection, preview, explicit publication, filtering, and removal.

## Next milestones

1. Prepare the product homepage and preserve the existing owner's public URL
   through a reviewed migration. No automatic root redirect is installed here.
2. Build shared customer identity/provisioning with an isolated instance,
   database, and key per owner. Test negative tenant boundaries across UI, MCP,
   imports, jobs, exports, backups, and published pages before external signup.
3. Qualify registrar read and write operations independently, including fixed
   egress/proxy paths. Add scoped agent grants, approved spending limits,
   operation history, and paid-outcome reconciliation.
4. Add renewal reminders, customer-facing portfolio analytics, subscriptions,
   and a small paid pilot. Keep personal portfolios out of product telemetry.

Continue contributing reusable registrar/core improvements upstream. Pin reviewed
releases and publish the hosted edition's source and deployment differences under
the applicable AGPL terms; upstream attribution is not an independent security
audit or an endorsement of this hosting service.
