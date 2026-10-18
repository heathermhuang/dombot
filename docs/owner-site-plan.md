# Owner sites and curated collections

Date: 18 October 2026
Status: implementation plan; no application changes or deployment performed.
Source baseline: hosted fork `heathermhuang/dombot` main at
`7aed56b253d4fc387bcc6d135f43d3ec732ed0c2`, checked during planning.

## Outcome and product decision

Give a domain owner a useful public presence without requiring them to expose
their inventory. An owner site should explain who they are, what they invest in
or build, and which conversations they welcome. Selected collections and projects
can support that identity. A complete catalogue is optional.

The primary user is an investor/operator managing holdings across registrars,
including domains they intend to retain or develop. The first visitor is someone
checking the owner or following a shared collection link. This release improves
presentation, trust and contact; it does not promise to acquire buyers or increase
sales.

Decision: build the owner profile and curated collections first. Private buyer
shortlists remain a later, separately validated workflow. Publishing, domain
ownership, and willingness to sell must be separate concepts.

## Research and limits

- [Afternic](https://www.afternic.com/sales-landers) separates request-price,
  buy-now, lease-to-own and parking paths. Commercial intent varies by domain.
- [Atom](https://www.atom.com/connect/wlm) and
  [Efty](https://efty.com/blog/post/7676/the-new-standard-for-domain-shops-arctic/)
  already provide substantial branded storefronts. A cosmetic catalogue refresh
  offers little distinction on its own.
- A [2026 NamePros seller](https://www.namepros.com/threads/nargils-aged-seo-domains-and-websites-300-private-portfolio-link-300-10k-1000-clients.1376809/)
  withholds names and shares spreadsheet-based selections on request. This proves
  one workflow exists in a specific SEO-domain segment, not broad demand for deal
  rooms.
- [Efty](https://support.efty.com/article/105-verified-email-for-offers-and-inquiries)
  supports optional inquiry verification. [Afternic's reported experiments](https://blog.afternic.com/balancing-lead-quality-and-quantity/)
  caution against adding excessive qualification before the first inquiry.

These are desk-research inputs from this conversation. No customer interviews,
observed task completion, conversion lift or willingness to pay have been proved.

## Release scope

### First release

1. **Owner profile:** display name, short headline, introduction, investment
   interests, opportunities welcomed, optional public contact email and links.
   Do not derive identity or contact fields from registrar-account information.
2. **Curated collections:** title, introduction, stable link, manually selected
   domains and explicit order. A domain can appear in more than one collection.
3. **Projects:** a small structured list of project names, descriptions and
   external links, with optional explicitly selected domain references. No page
   builder, uploads, remote metadata fetching or generated logos.
4. **Availability:** each selected current domain is either **Not for sale** or
   **Open to inquiries**. An optional asking price is public only for the latter.
   Historical entries remain separately labelled, without purchase/inquiry actions.
5. **Optional catalogue:** an explicit selection for owners who want searchable
   holdings. New sites start with it off. Enabling it never means selecting all
   present or future inventory automatically.
6. **Existing publication controls:** private draft, autosave, preview, exact
   change review, explicit publication receipt and unpublish.

No public site is required to use private portfolio management. A profile-only
site with zero domain entries is a valid complete outcome.

### Deferred

- Recipient-restricted collections, expiring links and broker permissions:
  require a distinct access model and evidence of repeated real use.
- Standalone domain sales pages, custom-domain attachment and DNS automation:
  avoid coupling the first release to routing and registrar changes.
- Built-in checkout, escrow, leasing and negotiation CRM: use no implied payment
  or transaction capability in first-release copy.
- Lead forms, email delivery and spam scoring: begin with explicit email contact;
  a click is not proof an inquiry was sent or a transaction completed.
- AI descriptions, valuations, theme marketplaces and analytics dashboards:
  none is necessary to prove the core experience.
- Automatic import/publication of the legacy site or inferred sold history.

## Owner and visitor journeys

### Owner

The existing **Public page** navigation becomes **Your site**. Keep **Domains**
as the sole inventory; do not add another inventory editor.

```text
Private portfolio                         Your site
  Select specific domains  ------------>  Profile / Collections / Projects
                                           |
                                           v
                                      Private preview
                                           |
                                           v
                                  Review exactly what becomes public
                                           |
                                           v
                                 Publish -> dated receipt + live link
```

- First-time owners see **Create your site** and a clear **Keep portfolio private**
  explanation. Start with profile fields, not an invitation to publish all names.
- Adding a collection opens a scoped inventory picker. Confirm the selected names
  and their availability; save only to the draft. Synchronization adds nothing.
- A collection without selected entries remains a private draft. Publishing it as
  an empty public collection is invalid; it must be filled or omitted from the
  publication selection. A profile-only site remains valid.
- Review shows contact details, external links, project claims, collections,
  domain names, availability, public prices, removals and catalogue selection.
- Preview disables email and external navigation actions. Preview/live output
  uses the same renderer and projection semantics.

### Visitor

```text
/p/:handle
  Owner identity and introduction
  Interests and opportunities welcomed
  Featured collections (only if published)
  Selected projects (only if published)
  Contact owner (only if explicitly enabled)
  Browse selected holdings (only if catalogue enabled)

/p/:handle/c/:slug
  Collection title and context
  Selected domains in the owner's order
  Explicit availability / permitted asking prices
  Domain-specific email inquiry where enabled
  Back to owner
```

A profile with no domains must look intentional: no empty search box, zero-holdings
counter or error-style empty state. A domain marked Not for sale has no sales
action. General partnership contact does not change a domain's availability.

Catalogue sorting/filtering remains useful inside the optional catalogue; the
homepage must not default to the long alphabetical list. Collection links must
never fall back to revealing a larger set when a slug is missing or invalid.

## Design and language

Preserve `.impeccable.md`: full **domains.domains** wordmark, restrained
forest/neutral palette, readable typography and composed layouts. Never use the
rejected `d.d` mark. Preserve accessible labels, focus states, 44px touch targets,
and keyboard operation; reordering needs buttons as well as any drag affordance.

Use ordinary labels: Your site, Profile, Collections, Projects, Preview, Review
changes, Publish changes, Not for sale and Open to inquiries. Keep technical
schema/access terminology out of the visitor experience.

Use reserved `.example` names for synthetic test and preview fixtures, clearly
labelled as sample data. Production previews show only the signed-in owner's
chosen content. Preserve upstream credit, AGPL/source links and existing legal
operator distinctions; an owner profile must not imply platform endorsement.

## Existing implementation to reuse

| Component | Reuse and required change |
| --- | --- |
| `src/shared/publication.ts` | Strict schemas; add explicit v2 draft/public formats and a v1 decoder. |
| `src/core/publication/reconcile.ts` | Ownership/freshness reconciliation and allowlisted projection; project selected references rather than the whole inventory. |
| `src/worker/publication-store.ts` | Encrypted draft and atomic revision comparison; retain the single site per instance. |
| `src/worker/publication-routes.ts` | Auth, same-origin enforcement, body limits, review/publish/unpublish; replace the at-least-one-domain condition. |
| `src/worker/public-portfolio.ts` | Anonymous published-only reads before private initialization; support both formats and collection routes. |
| `src/shared/render-portfolio.ts` | Existing escaped HTML and catalogue behavior; preserve v1 rendering and add a focused v2 owner-site renderer. |
| `src/renderer/lib/publication-client.ts` and editor/session helpers | Serialized autosave, timeout/recovery and stale-tab handling; do not replace the protocol. |
| `src/renderer/pages/DomainWorkspace.tsx` and portfolio components | Keep inventory selection; extract only the site presentation editor into focused components rather than extending the large page with more branches. |
| `src/worker/publication-backup.ts` | Retain sealed export/import and root-key-rotation integration, extending format validation. |

Current code rejects publication with zero selected domains. Its one visibility
enum also combines private/display/inquiry/history, and collections are strings
on listings. These are the three specific behavior/model changes this plan needs.

## Data model and publication boundary

Use versioned JSON inside the existing encrypted-draft/public-snapshot tables.
No new D1 tables are necessary for the first release. Preserve existing revision
columns and transaction boundaries. Unknown schema versions fail closed.

Proposed v2 draft structure:

```text
OwnerSiteDraft v2
  handle
  profile: name, headline, intro, interests[], opportunities[], links[], contact
  domainPresentations[]:
    stable id, canonical domain, ownership assertion (current/historical)
    availability (not-for-sale/inquiries), description, optional asking price
  collections[]:
    stable id, slug, title, intro, ordered domain presentation ids
  projects[]:
    stable id, title, description, HTTPS URL, optional domain presentation ids
  homepage:
    explicitly included collection ids and project ids, in order
  catalogue:
    enabled, explicitly selected domain presentation ids
```

Collection/project creation does not itself publish anything. On publish, include
only the selected homepage collections/projects and selected catalogue entries.
Do not emit unused draft records or orphaned references. Public collection routes
resolve exclusively from the published snapshot. Hidden collections have no route.

The public projection contains only approved profile fields, selected content,
safe links and eligible domain presentation fields. It never includes inventory
totals, account labels/IDs, registrar metadata, costs, renewal dates, credentials,
private folders, unselected names or draft-only collection titles.

Availability belongs to the domain presentation rather than to each collection,
avoiding contradictory public prices/statuses across first-release collections.
Presence in inventory proves neither availability for sale nor external project
ownership. Public records never claim independent identity verification.

Maintain current fresh ownership checks for all selected current domain references,
including project references. Historical references require explicit owner
assertion and cannot accept inquiries. Profile-only publication needs no registrar
sync. Invalid private/unselected draft records must not block unrelated valid
content; errors identify the selected reference and offer remove or resolve.

One domain presentation may refer to a name seen across registrar accounts, but
conflicting ownership resolution still blocks that selected current reference.
Never resolve registrar actions by display label or silently choose an account.

### Storage and route flow

```text
Owner session -> validate draft -> encrypt -> compare revision -> save
Owner publish -> reload exact saved revision -> validate selected content
             -> reconcile current references -> explicit public projection
             -> atomic snapshot write with matching revision
Anonymous GET -> tenant route resolution -> published snapshot only
              -> strict v1/v2 parser -> matching renderer -> HTML
```

Preserve tenant binding checks, bounded GET reads, completed-initialization cache
semantics and background-work ownership. Public reads must never hydrate private
inventory or make registrar calls. No new MCP publishing or external write grants.

Retain escaped plain text and restrictive CSP. Validate link protocols; reject
`javascript:`, data URLs and control characters. Use HTTPS for external links;
email is a separately validated contact field. Do not fetch supplied URLs from
the Worker. Contact choices and links are explicitly reviewed disclosures.

Keep anonymous responses `no-store` in this release; no shared snapshot cache.
Include a site revision/publication date for support. Index only published content;
owner endpoints and previews remain `noindex`. Root/collection metadata uses
approved text and canonical URLs, never inferred private data.

## Compatibility and migration

1. Ship dual-format readers and version-aware backups before enabling v2 writes.
   Preserve the v1 renderer so deployment does not redesign or republish existing
   pages. Keep the existing `/p/:handle` address.
2. Provide an explicit **Update your site** draft conversion. Preview conversion
   before saving; use the existing expected-revision check. Preserve title,
   introduction, chosen names, descriptions, contact email, permitted prices and
   historical assertions. Use existing collection-token parsing, stable IDs and
   collision-safe slugs. Never infer sold status.
3. Map private -> unselected draft record, showcase -> Not for sale,
   inquiry -> Open to inquiries, historical -> historical/no inquiry. Imported
   legacy catalogue selection includes exactly its existing selected names. New
   sites default to catalogue off. Conversion is idempotent and never publishes.
4. The current v1 snapshot remains public while the v2 draft is edited. The owner
   reviews before replacing it with v2. Legacy UI bookmarks redirect to Your site
   while retaining preview/review intent where applicable.
5. Retain existing `/p/:handle?collection=...`, search and history bookmarks for v1.
   After conversion, map known collection bookmarks to the converted collection;
   unknown values return a scoped empty/not-found result, never a broader list.
6. Keep the handle immutable during the first v2 editor release. This avoids
   breaking existing public addresses while adding richer presentation. New sites
   still choose a handle before first publication.
7. Extend sealed backups to validate both formats before mutation. Restore leaves
   the site unpublished and generates a new revision. Unsupported versions fail
   with actionable errors rather than dropping fields. Verify root-key rotation
   and legacy backups; never use a v1-only binary to restore/rotate a v2 draft.

The public legacy collection at `alternative.domains`, the `domains.domains`
product homepage, their current redirects and the hosted account/login surface
are separate services. First-release deployment does not move or rewrite them.
Any later personal-site cutover needs a separate explicit content/routing plan.

## Failure handling and verification

Use existing Vitest and Miniflare/D1 coverage. Add tests for changed contracts,
not for component implementation details.

| Failure or regression | Required behavior and proof |
| --- | --- |
| Zero-domain site treated as invalid | Publish an authenticated profile-only site; anonymous read has profile/contact as chosen and no inventory counters/search. |
| Private names leak through collections, projects or metadata | Seed distinctive private names/fields and inspect every emitted HTML/JSON/route; none appears outside the selected projection. |
| Disabled catalogue still browsable | Query parameters and direct URLs cannot expand the snapshot or reveal hidden collections. |
| Collection/project reference missing or empty | Selected invalid references block publication with exact corrective errors; unselected drafts do not. |
| Availability contradicts actions | Not-for-sale/historical entries emit no price or inquiry; inquiry requires enabled contact; collection reuse has one consistent status. |
| Unsafe text or links | HTML escape all strings; reject dangerous protocols; preview disables navigation/contact; preserve CSP and headers. |
| Stale tab, save/publish/unpublish race | Real D1 tests through separate store instances prove atomic revision comparison, 409 conflict and no resurrection after unpublish. |
| v1 conversion loses content or exposes private records | Golden fixtures compare projections, prices, selection, history and links; repeated conversion is stable; live v1 snapshot is untouched until publish. |
| Corrupt or future-version draft/backup | Fail closed; preserve existing state on validation failure; no silent empty draft or automatic publication. |
| Snapshot exists but owner cannot save/load | Retain editor retry/recovery, bounded reads and unsaved-work warning; private management remains usable. |
| Tenant A can reach tenant B site/editor | Test anonymous routes, account paths, preview, draft mutation and direct collection URL isolation with distinct tenant fixtures. |
| Large portfolio slows public homepage | Public homepage reads one snapshot without private boot; render only selected sections with bounded previews, not all inventory rows. |

Browser acceptance at 390, 768 and 1280px: keyboard editing/reordering, zero-domain
publication, mixed availability, multiple collections, project links, preview,
review corrections, publication receipt, reload persistence, anonymous traversal,
v1 conversion and unpublish. No horizontal overflow or inaccessible controls.
Use synthetic fixtures; do not alter founder content to exercise test cases.

For performance, preserve the existing 4 MiB request ceiling and 20,000-entry
domain ceiling, with explicit nested limits (50 collections, 50 projects, 20
profile links, 20,000 total collection memberships). Homepage previews cap at six
collections with six entries each, followed by scoped links. Collection/catalogue
pages retain pagination at 60 entries. Build lookup maps once; no per-entry DB
queries or repeated full-array joins. Reject oversized selections before save.
These are proposed operational limits, not measured capacity claims; migrations
must report any existing content exceeding them rather than silently truncate.

## Implementation Tasks

Execute sequentially in a clean checkout of the hosted fork's latest main.
Preserve this checkout's unrelated `output/` files and damaged Git objects.
No parallel agents or overlapping worktrees are needed for these coupled schemas,
projection, editor and compatibility changes.

| Task | Work and files | Depends on | Completion proof |
| --- | --- | --- | --- |
| T1 | Define strict v2 schemas, selected-content validation and deterministic v1 conversion in shared publication modules. | — | Profile-only, availability, membership, limits and conversion tests. |
| T2 | Extend projection, store/route readers, publish validation and backup/import for both formats. Retain auth/revisions and v1 rendering. | T1 | Real D1 tests, anonymous/tenant boundaries, backup/restore and zero-domain publish. |
| T3 | Add owner-profile/collection/project renderer and public collection route; retain the optional catalogue and old links. | T1, T2 | Projection-leak fixtures, headers, route compatibility, bounded rendering. |
| T4 | Add focused Your site editor components; adapt inventory picker, autosave, preview and exact change review. | T1–T3 | Reload/stale-tab recovery; desktop/mobile authoring through publication. |
| T5 | Add explicit legacy draft upgrade, presentation receipts and compatibility documentation. | T2–T4 | Unchanged v1 live snapshot before owner publish; conversion and restore scenarios. |
| T6 | Rebuild and pin the engine artifact, then run root/hosted CI-equivalent checks. | T1–T5 | Source/artifact/UI hashes agree; required checks below pass. |
| T7 | Release a disabled-by-default v2 editor with dual readers, then enable for a controlled test tenant. | T6 | Pre/post preservation receipts, v1 anonymous reads and synthetic v2 journey. |
| T8 | Run the bounded owner/visitor validation below; enable broader availability only on observed results. | T7 | Task observations recorded separately from code/CI/deployment evidence. |

Touched engine sources fall under `scripts/dombot-engine.mjs` source hashing.
Changing source without repacking the pinned `@domains-domains/dombot-engine`
artifact would leave hosted runtime/UI stale or fail `engine:verify`. Include the
resulting artifact, lock and dependency integrity updates in the release review;
never weaken verification or bypass the exported engine boundary.

Required setup/check sequence, using current scripts on the implementation branch:

```sh
npm ci --ignore-scripts
npm rebuild esbuild
npm ci --prefix hosted --ignore-scripts
node hosted/build-auth.mjs
npm run engine:pack
npm run typecheck
npm run engine:verify
npm run lint
npm test
npx vitest run --config security-review/vitest.config.mts
npm run web:build
npx wrangler deploy --config hosted/wrangler.gateway.jsonc --dry-run --outdir dist/gateway
npx wrangler deploy --config hosted/wrangler.tenant.jsonc --dry-run --outdir dist/tenant
npx wrangler deploy --dry-run --outdir dist/worker
npm run demo:build
npm run site:build
```

Confirm `engine:pack` prerequisites in its current script; reinstall its newly
pinned artifact exactly as the script documents. These commands are a future
verification plan; none has been run for this document-only change.

## Rollout and recovery

- Separate dual-format-read deployment from enabling v2 writes. Do not enable v2
  publication until every instance that can serve that site's data supports it.
- Add one server-side per-instance v2-write/editor flag, initially off; clients
  cannot enable it. Off rejects conversion and v2 draft mutations and hides the
  new editor. It never discards a draft or changes anonymous published content.
  An existing v2 site retains read-only status, export and explicit unpublish
  access when editing is disabled; a v1 editor cannot overwrite a v2 draft.
- Before deployment, verify live topology/configuration rather than relying on
  historical tenant counts. Use configs derived from live bindings and preserve
  variables, secrets, immutable tenant IDs, schedules and host mappings.
- Take owner-only backups and compare semantic fingerprints of inventory,
  credentials, proxies, drafts, public snapshots and routing before/after the
  read-compatible deployment. Record that no content was published by deployment.
- Enable a synthetic pilot first. Check signed-in and anonymous routes and
  repeated cold/reload paths; expand to other controlled accounts before founder
  migration. Run a gateway deployment only if its routing actually changes.
- Emergency response: disable v2 writes/editor and retain a dual-format-capable
  runtime serving the latest approved snapshot. Unpublish explicitly when needed.
  Do not roll back to a v1-only binary after any v2 data has been written. Retain
  the preceding dual-reader release as the operational rollback candidate.
- Removing content stops future serving after unpublish/update; it cannot retract
  copies already downloaded or indexed. Do not claim otherwise.

## Validation and release acceptance

Use three consenting pilot owners: an investor selling names, an operator keeping
or developing domains, and an owner wanting a profile with no inventory visible.
Ask each to prepare a site without coaching. Each then has a visitor, unfamiliar
with the setup, inspect the result.

Proposed pass criteria for this small pilot:

1. All three publish the intended disclosure state with no accidentally exposed
   names, prices or contact information. Any disclosure error blocks expansion.
2. Each owner completes the task within ten minutes without intervention; record
   actual elapsed time and failure points rather than asserting this target met.
3. Each visitor can identify the owner, explain what is available, and find the
   intended contact or project action without being guided.
4. At least two owners voluntarily retain or reuse the site/collection within
   seven days. Otherwise revisit the value proposition before expanding scope.

This pilot tests usability and usefulness, not market size or sales lift. Do not
count page views, mailto clicks or favorable comments as completed inquiries or
sales. Use manual observation and explicit owner reports before adding analytics.

## Planning assessment

Architecture: retain one encrypted draft and one public snapshot, with versioned
payloads and explicit references. Addressed risks: zero-domain validity, disclosure
through inferred membership, public/private boundaries and incompatible rollback.

Code quality: reuse reconciliation, autosave and revisions. Keep the v1 renderer
stable, introduce focused site components, and avoid a generic CMS or rewrite of
registrar management. Engine artifact repacking is part of the change.

Tests: meaningful additions are listed above. Preserve current security and
publication regressions; update zero-domain expectations only for the explicit v2
profile contract. No tests are retired solely because they obstruct the redesign.

Performance: one published-snapshot read per public request, bounded output and
linear reference lookup. No measured speed or capacity improvement is claimed.

Independent Claude coverage is unavailable: the prior CLI attempt failed on
expired OAuth, and browser/desktop access was blocked by the locked Mac. The user
directed this agent to make the product decision. No substitute review or repeated
provider attempt is represented as a completed Claude opinion.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
| --- | --- | --- | --- | --- | --- |
| Product direction | Conversation | Optional owner presence and selective disclosure | 1 | DECIDED | Profile and collections first; restricted sharing deferred. |
| Engineering planning | Plan request | Architecture, compatibility, tests and release | 1 | PLANNED | Implementation and verification tasks T1–T8 remain. |
| Outside review | Requested Claude opinion | Independent challenge | 1 attempted | UNAVAILABLE | No completed external opinion. |
| Visual QA | Future implementation | Responsive and accessible authoring/visitor flows | 0 | PENDING | Browser acceptance specified above. |

OUTSIDE COVERAGE: Claude unavailable; no cross-model agreement claimed.

VERDICT: plan is ready for implementation; application tests, visual QA, CI,
deployment and customer validation remain unperformed for this change. This is
not a formal completed engineering-review or production-readiness clearance.

NO UNRESOLVED DECISIONS

## Implementation decisions, 18 October 2026

The owner job is to establish identity and invite a useful conversation while keeping
inventory private. The visitor job is to understand the owner and find the intended
contact, project or scoped collection. These jobs do not depend on a searchable list.
The first-use flow therefore starts with explicit name/address creation, followed by
profile editing; returning owners review changes against the actual public snapshot.

The implementation keeps one v2 domain presentation per name, explicit section order,
and an opt-in catalogue. It reuses encrypted storage, atomic revision comparisons,
sealed backups and the autosave protocol; no D1 migration or generic CMS is introduced.
Incomplete excluded sections remain private. Section IDs keep review stable when titles
repeat or sections move. The existing domain-management screen remains the inventory
for v2 accounts; the old public-listing editor cannot overwrite a converted draft.

The hosted gateway's existing anonymous-path allowlist required one narrow addition
for collection routes. This makes the gateway a release dependency alongside the pilot
tenant engine. All other private paths retain their existing authentication checks.

The server flag applies to backup imports as well as editor writes. Root-key rotation
checks the compatible v2 flag before changing a key. Disabling the editor retains read,
preview, export and unpublish; restoring v2 content requires enabling the compatible
runtime explicitly.

The initial rollout target is an existing controlled synthetic QA tenant, selected from
current live topology. Ordinary accounts keep v2 writes off; founder/legacy content is
not converted or republished. Technical verification and deployment receipts are
recorded separately from the later consenting owner/visitor usefulness study.
