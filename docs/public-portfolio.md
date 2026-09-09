# Public portfolio publishing

This is the first hosted-product milestone: reconcile connected registrar
inventory against a curated collection, edit a private draft, and publish only
explicitly selected public fields. It is a **single-owner, self-hosted instance**
feature. It does not add SaaS signup, multi-tenancy, billing, or new MCP grants.

## Use

Open **Public portfolio** in the web application. New inventory is private.
Import an existing collection as CSV, TSV, JSON, or a list of domain names.
Supported columns are `domain`, `collection`, `description`, `askingPrice`, and
`currency`. Separate multiple collection names with semicolons in `collection`.
Repeated names retain existing edits. Incoming visibility flags are
ignored; imports cannot authorize publication. Invalid rows reject the import
without adding partial results.

For each name choose Private, Showcase, Accept inquiries, or Previously owned.
Active public listings require a fresh, successful sync of the matching connected
account. Duplicate ownership across accounts requires review. A missing or stale
record is never classified automatically as sold or expired. Previously owned
is an explicit owner assertion, displayed as history without an inquiry action.

Save the draft, open the private preview, and confirm publication. The public
address is `/p/<handle>`. Draft edits do not change that page until publication.
Changing the handle on publication removes the old address. Unpublish removes
the page while retaining the private draft and inventory. Publishing an empty
selection is rejected; use Unpublish instead.

The public page has server-rendered search, collection filters, and pagination.
It contains no JavaScript, third-party analytics, remote fonts, or tracking SDKs.
Renewal prices and asking prices are separate fields; renewal prices never enter
the public projection.

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
