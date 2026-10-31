# Public publishing integration: implementation and review

Date: 31 October 2026. Status: reviewed implementation plan; application changes and deployment are not part of this task.

## 1. Outcome and baseline

An owner can select domains from the existing inventory, prepare their public presentation and inquiry path, review exactly what each public surface will expose, and publish without rebuilding the same selection in several editors. A visitor can move from an owner or collection page to the correct domain inquiry page. An owner can subsequently understand price changes and withdraw a domain from every platform-hosted public surface.

Inspected implementation: hosted fork commit `d272034` in `/private/tmp/dombot-pricing-repair-20261031`; the previous live inspection observed engine `1.5.2-hosted.28` with that gateway source. This is a planning baseline, not a new deployment observation. Refresh the target branch and live feature flags before implementation. The primary checkout contains unrelated modifications and older application source; preserve it and implement in an isolated checkout.

This plan integrates the implemented owner-site and Sales features. It supersedes their separate-editor UX where specified, while preserving their publication, authentication, inquiry, hostname and recovery constraints. Existing plans are historical context, not evidence that their old activation gates are still current.

Product direction: one owner workflow over explicitly selected public surfaces. Profile, collection, standalone domain page and shop remain distinct visitor experiences. A profile can contain zero domains; a domain inquiry page does not require a profile or shop. Existing shop-only owners retain that workflow.

Success is measured first by task completion and maintenance effort. This work does not promise traffic, sales, provider checkout qualification or conversion lift.

## 2. Decisions and scope

| Decision | Implementation choice |
| --- | --- |
| Private inventory | Remains the existing inventory, including imported and historical records. Selecting a record never establishes ownership or publication authority. |
| Public website | Make the existing Public profile workspace the primary content editor. Use Profile, Collections, Domain pages and Settings as task sections; link to the existing shop as an optional published surface. Preserve old route aliases. |
| Inquiry management | Keep Sales inbox and operational controls; avoid a wholesale top-level navigation rename in this release. Add contextual links between the site workspace and Sales. |
| Domain selection | One reusable inventory picker and selection model; explicit destinations: collection/catalogue, domain page, optional shop. No implicit selection of all current or future names. |
| Public prices | Existing portfolio price remains the default source for Sales, with visible deliberate overrides. Private edits never update published terms automatically. Linked profile entries display a reviewed Sales projection; independent email entries retain their existing values. |
| Publication | Exact review and revision-bound commit. A combined commit is atomic within one tenant D1 database, not across Cloudflare, DNS or email providers. |
| Profile compatibility | Keep v1/v2 documents and URLs readable. Introduce an opt-in v3 profile format only for explicit Sales links; no automatic conversion or republishing. |
| External destinations | Reuse the existing provider validation and handoff. No new marketplace integrations, payment custody, automatic provider writes or DNS writes. |
| Discovery | Preserve current indexing policy in the integration release. Review public SEO separately after the integrated experience is qualified. Private conversations always remain excluded. |
| Visual system | Preserve `.impeccable.md`: Archivo, full domains.domains wordmark, forest/neutral palette, existing themes, accessible controls and original source/legal attribution. |

Deferred: a generic site builder, new themes/logos, recommendations, buyer accounts, paid plans, private deal rooms, new analytics vendors, native checkout, automatic repricing, new custom-domain provisioning and automatic migration of the separate legacy portfolio.

## 3. Current evidence and reuse

| Current source | Relevant behavior / planned change |
| --- | --- |
| `src/renderer/pages/DomainWorkspace.tsx` | Legacy inventory/profile editor, selection, draft/live statuses and review. Reuse inventory transitions; replace ambiguous Add domains / Choose profile domains labels. |
| `src/renderer/pages/YourSite.tsx`, `components/owner-site/*` | Existing v2 profile, collection, project, preview and domain editing. Reorganize rather than rebuilding these capabilities. |
| `src/renderer/pages/sales/Listings.tsx` | Inventory API supplies a cursor, but creation UI stops at 100 and clears selected names on search. Fix client pagination and retain selections. |
| `src/renderer/pages/sales/Shop.tsx` | Shop independently selects listing IDs; title/intro copy is manual. Keep membership explicit, expose it in the common workflow, preserve existing shop branding. |
| `src/renderer/pages/sales/ListingEditor.tsx` | Existing buyer modes, portfolio/override pricing, saved preview and review. Reuse the editor and draft session. |
| `src/shared/render-portfolio.ts`, `render-owner-site.ts` | Current profile inquiry links are mailto. Add opt-in linked-domain rendering; improve existing focus treatment. |
| `src/shared/render-sales-lander.ts` | Existing inquiry/offer/provider paths and common page renderer. Correct mode-specific instructions; add explicitly public owner/collection navigation. |
| `src/core/publication/*`, `src/worker/publication-store.ts` | Strict projections, encrypted drafts and revision checks. Extend version support and expose prepared writes for the combined transaction. |
| `src/worker/sales-store.ts`, `sales-jobs.ts` | Existing review manifests, operational revisions, guarded D1 batch, receipts and bounded jobs. Reuse guards and receipts; do not call several committing methods and call that atomic. |
| `src/worker/public-portfolio.ts`, `public-sales.ts`, `sales-shop.ts` | Public-only projection reads before private initialization; existing Sales operational suppression. Extend public resolution without reading encrypted drafts or triggering registrar calls. |
| `src/hosted/gateway.ts`, gateway proof, tenant/public-edge routes | Preserve exact owner/public admission, canonical origin, tenant binding and cookie isolation. Explicitly extend only required routes. |
| Publication/Sales backup code, `docs/dombot-engine.md` | Extend strict backup validators; preserve private restore and pinned engine packaging. |

## 4. Owner and visitor flows

### Owner content workspace

First screen: profile/site title; Draft / Published / Changes pending; View published site; Preview; primary Review changes action when applicable. Below it: Profile, Collections, Domain pages and Settings. Address and custom-domain setup move into Settings; a compact published-address link remains in the header.

Use three distinct labels: Import domains (inventory acquisition), Choose domains (content selection), Connect website address (routing). In legacy mode, Choose domains opens the existing inventory with the selected/public scope and a clear Add more action. The v2/v3 workspace opens the scoped picker without losing the originating collection.

The picker supports domain search, registrar/account and TLD filters, status filters, cursor/page navigation, select-visible and paste-exact-domain-list. Selections persist across filters/pages in a visible tray with a count and explicit Clear selection. Select visible never means all matching. Selecting all matching, if exposed, freezes an exact bounded manifest and uses existing bulk-job limits. Unknown names are reported; paste does not silently import them.

After choosing names, show a staged plan with per-domain exceptions:

1. Where should these appear? Collection/catalogue, standalone domain page, optional shop.
2. What can a visitor do? Display only, email the owner, or use a configured domain inquiry/provider page. Keep display-only as the safe default; do not infer sale intent from ownership.
3. Public terms: portfolio price, explicit override, or request price; preview any copied descriptions/contact fields. Do not copy private floors, acquisition costs, notes or registrar-account identity.
4. Review names, public fields, prices, actions, membership changes, target pages and removals. Group blockers by registrar/cause and separate them from unrelated private records.
5. Publish the exact reviewed operation; show its receipt and working public URLs. Saving/preparing drafts never publishes. Closing the wizard preserves successfully saved drafts and clearly reports unsaved work.

### Visitors

- Owner home: identity, concise introduction, explicitly featured collections/projects and optional catalogue. Profile-only output has no empty catalogue or zero-holdings warning.
- Collection: title, useful context, explicit owner order, domain actions and a route back to the owner. An unknown collection never broadens to a larger selection.
- Domain page: domain identity, accurate price/request mode, public contact identity, one primary action and mode-specific next steps. Owner/collection navigation appears only when that relationship is already published.
- Existing shop: retains its URL, selection and branding; selecting names for a profile does not silently add them to the shop. The common workflow can deliberately stage both memberships.

On 320/390px screens, place the domain and action before secondary context, use a sticky selected-count/action bar only where it does not obscure controls, preserve all capabilities, and avoid a horizontal table as the only management path. Reuse labelled keyboard ordering controls. Required fields use visible labels, 16px input text, visible focus and appropriate busy/error/status announcements.

## 5. Data and publication contracts

### 5.1 Read-only public-presence summary

Add an authenticated, paginated `/publishing/presence` read contract and a per-domain detail contract. Derive it from existing draft and public stores; do not create another inventory database or call providers during listing. Each result separates:

- inventory identity/control observation and its timestamp;
- saved draft selections versus actual published profile/collection/catalogue memberships;
- published domain page revision, operational actionability and shop membership;
- public price/mode per surface, pending differences and intentional overrides;
- reasons a new publication is blocked, separately from why a current action is suppressed;
- canonical public URLs and source revisions used to derive the summary.

Bind every lookup to the authenticated tenant. A domain name, listing UUID, account filter or public handle is never authority to select another tenant. Partial-store failures return unknown for the affected surface; never display private/not published as a substitute for a failed read. Do not include buyer PII, inquiry bodies, provider credentials or private financial values.

Return fixed response/page limits, cursor validation and cancellation support. Render an initial page without loading/decrypting all Sales drafts or performing per-row network requests. Include imported-only, historical, duplicate registrar-account and IDN fixtures. Registrar mutation authority stays tied to the exact account; publication identity can use canonical domain names within the tenant.

### 5.2 Versioned profile-to-listing links

Do not add optional fields to strict v1/v2 documents. Define a version-3 owner-site schema that reuses v2 presentation and section fields and adds explicit `salesLinks`:

```text
Draft link: presentationId, listingId, expectedPublishedRevision
Published link: presentationId, listingId, publishedRevision,
                reviewed public mode, public price and public minimum offer
```

Links must be unique per presentation, refer to an explicitly selected current domain, and match the tenant's exact canonical listing domain. Historical/display-only records cannot have a Sales action. For linked entries, the legacy per-presentation askingPrice is null and the public action/price comes exclusively from the reviewed Sales projection. Do not invent a second editable commercial price. Unlinked email entries retain existing amount/currency semantics; do not round fractional legacy prices to fit Sales whole-amount money. Changing between paths is an explicit reviewed choice.

The public projection never contains a draft listing, private contact, arbitrary redirect URL or unpublished membership. Derive links through one trusted URL helper from canonical configured origin/base paths and public snapshot relationships. Preserve long gateway paths and existing handle routes; portfolio custom hosts link to canonical public Sales URLs when they cannot serve that route themselves. Never use an untrusted Host header or return URL.

V3 draft conversion is explicit, deterministic, previewed and reversible before publication. A converted draft without Sales links preserves all existing selected names, prices, descriptions, order, email, historical assertions and excluded draft sections. Do not truncate oversized input. Existing v1/v2 pages use their existing renderer until an explicit v3 publication.

Update all format dispatch together: draft/public schema unions, `isOwnerSite` or its replacement, editor sessions, projections, diff/review helpers, anonymous routes, backup validators and root-key rotation checks. Do not broaden the existing version-2 type guard while leaving downstream code typed as v2. A linked inquiry uses Sales recipient verification and must not require publishing the owner's account email; only the independent email action requires a public contact email. Conversion alone never creates a link or changes the inquiry recipient.

### 5.3 Linked public reads and changed terms

Anonymous readers load only the published profile, referenced published Sales projections and the minimal existing allowlisted operational eligibility metadata. They do not decrypt drafts, inspect private inventory, initialize private state or request fresh registrar/provider data. Fetch link eligibility in a bounded batch, not one query per row. Validate domain, listing ID and public revision equality.

If the linked Sales revision changes, is unpublished, paused, sold, control-lost or control-expired, suppress the linked action and linked price. Show a neutral unavailable state; never fall back to a stale mailto inquiry, another domain or unreviewed current terms. The existing profile display selection is not silently expanded or rewritten. Clearly distinguish continuing to display a name from continuing to accept inquiries.

Normal price edits stay private. Publishing changed linked Sales terms shows affected profile/collection surfaces and offers a combined rebind/publication. A standalone Sales publication remains possible, but its review must explain that old profile links will become temporarily non-actionable until explicitly updated. Old site binaries cannot edit a v3 draft; compatible public readers remain available when new writes are disabled.

Backlinks are computed only from current published relationships and revalidated at request time; unpublishing/removing a collection removes the backlink immediately. Never expose private collection titles or draft profile identity on a standalone domain page. Use public headings such as Selected domains rather than claiming an old snapshot is a live ownership feed.

### 5.4 Combined review and commit

Add proposed `publication-change-set.ts` shared contracts, a worker change-set store/coordinator, and an additive tenant migration for encrypted review manifests and idempotent receipts. Assign the next migration number after refreshing the branch. Default the new orchestration flag off. Preserve existing independent endpoints and flags.

Review preparation reuses existing projectors and validators, verifies recipient readiness for inquiry paths, and freezes the complete exact operation. Bind the manifest to tenant, operation/request key, affected site draft and published revisions, listing draft/operational/public revisions, destination revisions, shop draft/public membership state, price/control fingerprints, expected absence for new objects, feature capabilities, expiry and resulting public payload hashes. Unrelated private names are absent from the manifest. A preview is not commit authority.

Define operation scope explicitly. An add/update wizard applies a field- and membership-scoped patch to the currently published site/shop baseline; it does not publish the complete saved draft as a side effect. Keep unrelated saved changes pending in the draft. The review labels any additional dependent field that must change, such as the identity required for a new profile. Owners can separately choose the existing full-page Review all changes flow. Bind both draft and public baseline revisions, produce exact resulting draft/public hashes, and fail if an affected field conflicts. Never silently discard, rebase or publish unrelated pending work. Give every new public snapshot its own revision; do not treat a shared draft revision as proof that two different scoped publications are identical.

For scoped publication, distinguish exact unchanged public fragments from newly approved disclosure. Reuse an unchanged fragment only on the same already-published surface and membership, prove equality against the bound public baseline, and retain operational action suppression. Require fresh applicable ownership/control checks for new names, new memberships, inquiry activation and changed commercial terms. Moving a name into a newly shared collection is new exposure. Full-page publication and format conversion retain their existing complete-selection qualification; the scoped path is not a bypass for publishing an otherwise invalid full draft. Cover this distinction explicitly in security regressions and the change review.

The final authenticated same-origin commit accepts only the stored review identity and matching operation key. Reobserve control/price/destination through existing bounded observer logic, validate capability/recipient readiness again, then build one guarded D1 batch for the changed public profile, Sales projections, shop membership, operational revisions, events, one-use review consumption and receipt. All guards and their mutations participate in the same transaction. A conditional update affecting zero rows must fail the entire operation, not produce partial success. Extract prepared statements/validators from current stores rather than calling several methods that each commit independently.

Audit every existing writer that can change these dependencies, including standalone publication, pause/unpublish, restoration, source-price changes, recipient readiness and control renewal. Reuse authoritative persisted revisions/fingerprints where they already exist; add a durable dependency generation where a mutable input is otherwise unfenced. Check it inside the batch. Preserve existing stateful coordination, but an in-memory mutex or a successful preflight read alone is insufficient. The timestamped ownership observation proves the bounded observation used for publication, not continuous external ownership after commit.

Do not perform DNS/provider/mail writes inside this transaction. Existing notification journeys are unchanged. If an existing listing is to be linked, do not create another one; private draft preparation is idempotent per canonical domain. New saved drafts may remain after abandonment, but no public mutation occurs before the final commit.

Start with the existing 100-name review ceiling, also enforcing measured SQL statement, payload and runtime budgets before mutation. Preserve existing larger standalone Sales jobs (up to their existing 500-item limit). Oversized composite operations are explicitly split into exact reviewed batches with per-batch receipts, or rejected before mutation; no truncation and no claim that multiple batches are globally atomic. Freeze later batch expectations and stop on conflicts rather than silently rebasing. A timeout is reconciled by fetching the stored receipt; never blindly issue a new publication.

An optional shop can receive only explicitly selected currently published/committing listings. Do not create or publish a shop merely because a listing is published. Shop identity/title changes remain explicit. Composite publication must also retain the existing rule that isolated Sales listing changes cannot race a shop membership edit.

### 5.5 Maintenance and withdrawal

The presence inspector shows all public surfaces before changing a price, path or selection. Support a reviewed Withdraw from all public pages operation: remove the name from the published site projection and its selected collection/catalogue/project references, unpublish its Sales page, remove shop membership, suppress actions and return one receipt. Retain private holdings, descriptions, conversations and audit history. Do not assert that withdrawal proves sale or transfer.

The operation is atomic across this tenant's public D1 projections. Hostname bindings can remain reserved and resolve an unavailable page; no DNS detach/provider mutation is included. Any separate hostname detach is labelled and uses its existing flow. External marketplace listings and cached/indexed copies are outside the receipt's scope.

Preserve unrelated unsaved drafts and unrelated domain changes. Withdrawal is a narrow operation on latest persisted documents with exact revision checks; the UI must flush its own unsaved draft or explicitly cancel before review. Another tab changing a draft causes a conflict. Removing a sole member must omit the now-empty public collection, preserve it as an excluded draft, and keep a valid profile-only page. Legacy v1 with no remaining names becomes unpublished with its draft retained; do not fabricate a valid zero-domain v1 page. Historical conversion is a separate choice.

### 5.6 Backup, flags and recovery

Extend existing publication backup validators with the v3 inner document and retain the existing version-9 host envelope: no new portable top-level store is needed. New change-set reviews/receipts are operational state, are excluded from portable backups, and are invalidated on restore along with existing reviews. Validate cross-object Sales-link identity before any restore mutation. Restore must reject unsupported v3 before any mutation, restore drafts privately, and revoke live public projections, reviews and capabilities as the current recovery flow requires. Saved link intent cannot point to an actionable old public revision after restore; the UI must require rebinding/review before republishing. Root-key rotation must support v3 or reject safely before rotation.

Compatible public readers are deployed unconditionally. Proposed `DOMBOT_OWNER_SITE_V3` gates v3 creation/conversion/content writes and `DOMBOT_COMPOSITE_PUBLISH` gates content-adding combined commits; existing v2/Sales/inquiry flags retain their original scope and are not automatically enabled. Both new write flags default off. Feature disablement retains compatible public reads, inspection, export, pause, narrowly scoped withdrawal and unpublish, with the same authentication, same-origin, tenant and revision checks. Recovery bypasses write-feature flags, never access controls. Rollback after the first v3 write requires a v3-compatible reader/backup runtime; do not roll back to the old v2-only package. No forced content conversion, handle reassignment, shop reset or DNS change is part of rollout.

## 6. Delivery sequence and exit checks

Each row is a reviewable implementation unit; split further when a diff spans unrelated concerns. Dependencies are strict. All application work uses an isolated current fork checkout.

| Unit | Scope and key files | Dependencies | Exit check |
| --- | --- | --- | --- |
| P1 | Presence read API/contract and inspector in inventory/site; reuse existing stores and signed owner dispatch. | None | Every fixture's draft/live/unknown states are accurate; no provider calls, cross-tenant access or public changes. |
| P2 | Shared selection controller/picker; fix Sales search reset and consume its existing cursor; exact-list paste; count/tray; batch intent. | P1 for presence labels | Select across three searches and multiple pages; IDs remain exact; duplicates/unknowns reported; no network write until explicit draft preparation. |
| P3 | Site workspace hierarchy; contextual Sales/shop navigation; compact address settings; grouped verification; mode-specific lander copy and focus correction. | P1/P2 | Legacy and v2 flows remain usable; profile-only, phone, keyboard and error states work; disabled features stay disabled. |
| P4 | V3 strict schemas, conversion, projections, backup support, trusted public URL helper and public link reader, behind flags. | P1 | v1/v2 bytes/semantics preserved, selected v3 fixtures render safely, stale links suppress actions/prices, unsupported restores fail before mutation. Deploy compatible readers before any v3 writes. |
| P5 | Combined review/atomic commit, receipts and explicit optional shop membership; wire the wizard and linked terms update. | P2/P4 | Inject every relevant conflict and a mid-batch failure: zero partial public mutations. Lost responses recover original receipts. Only exact reviewed fields appear publicly. |
| P6 | Cross-surface withdrawal and maintenance inspector actions; removal of empty sections; release documentation and full qualification. | P1/P4/P5 | Remove current/last/historical/linked/unlinked names without erasing unrelated drafts, inquiry history or private holdings; affected public URLs become appropriately unavailable. |

P1-P3 can ship as an independently useful usability release. The integrated-publishing milestone is P1-P6 with controlled qualification, not a claim that P3 completes the objective. Keep existing shop settings and URLs; do not remove the standalone Sales path until evidence shows the common workflow covers it.

## 7. Required verification

### Behavioral and security regressions

1. Select names across query/page/filter changes; selected tray remains exact; Clear is explicit; refresh during saved preparation recovers or reports unsaved selection honestly. Define persistence as tab-local selection plus saved draft recovery; do not promise cross-device unsaved selection.
2. Private import/sync never changes any publication. Duplicate registrar accounts and imported names cannot bypass control checks; historical names never gain a Sales action.
3. V1, v2 and v3 zero/many-domain cases, excluded sections, collection ordering, valid IDN display and canonical identity; no silent amount/currency conversion.
4. Repeated prepare/review/commit requests, expired review, altered manifest, stale tab, changed price/destination/control/shop membership/recipient readiness, concurrent unpublish/withdraw and a dropped commit response. Mutate dependencies through the existing standalone paths as well as the new coordinator.
5. SQL fault after an earlier statement, zero-row CAS and timeout receipt recovery. Assert all public projections and receipts before/after, not only HTTP responses.
6. Profile link references an unpublished/different-tenant/different-domain listing; hidden project or collection backlink; stale revision; paused/sold/expired control; verify no stale inquiry fallback or private-field exposure.
7. Unrelated draft edits survive preparation, scoped publication and withdrawal without becoming public; last-domain v1 unpublishes, last-domain v3 becomes profile-only; empty selected sections cannot invalidate the resulting publication. Two scoped publications from one saved draft receive distinct public revisions.
8. Anonymous reads use published-only projections and allowed operational eligibility metadata; no decryption/private initialization/provider requests; bounded query counts independent of rendered row count, and no widened gateway/public-edge routes.
9. V3 backup/export/import/root-key rotation, mismatched link identities, missing schema/flag and rollback floor; restore never republishes or sends email. Disabling either new write flag still permits authenticated, revision-safe withdrawal and unpublish.
10. Listing-price changes update only explicitly committed surfaces. Standalone Sales updates show their impact; stale profile links suppress price/action until rebound. Existing independent email listings remain independent.

Use existing Vitest/Miniflare and security fixtures; extend them for new contracts and transactions. Do not add snapshots that merely mirror markup or repeat unchanged tests without a new uncertainty.

### Browser and performance acceptance

Exercise 320, 390, 768 and 1280 CSS-pixel widths, actual 200% browser zoom, both themes, keyboard-only selection/reordering/review, focus after errors and status announcements. Compare normal, long-domain, empty, loading, error and more-than-one-page fixtures. Selection and primary actions remain reachable without horizontal body scrolling. Preview uses the same projection/renderer as live and disables submission/external actions.

Before/after record initial page requests, D1 query count, payload size and render timings using the same 1,000-name fixture and a 20,000-name schema-limit fixture. Presence loads are paginated; public-link resolution is batched. No new provider calls, per-row round trips or whole-Sales-draft decryption. Require no more than 20% median regression over five controlled runs for the changed journeys; record environment and investigate variance rather than claiming synthetic timings are customer performance. Determine the safe composite batch limit from actual maximum-size SQL/payload/runtime qualification and enforce it before writes.

### Required repository checks

Use the refreshed repository CI as authoritative. At the inspected baseline: install root dependencies with scripts disabled and rebuild esbuild; install hosted dependencies and run `node hosted/build-auth.mjs`; repack, reinstall and verify the pinned engine for engine-source changes. Run typecheck, lint, unit tests with the CI worker bound, security-review Vitest checks, fixed-source relay checks, web/demo/site builds, and the self-hosted/gateway/tenant/lander/provisioner/proxy-scheduler dry runs required by CI. Required CI and CodeQL must be green on the exact candidate. Do not count the root package version as the deployed hosted engine version.

## 8. Rollout and evidence

1. Refresh source, tenant/gateway versions and current flags; reconcile concurrent changes. Read existing deployment configuration and capture owner-only backups and semantic fingerprints of inventory, credentials, public/draft content, shop/listings, conversations, grants, hosts, routing, schedules and keys. Record only sanitized hashes/counts in ordinary receipts.
2. Release compatible schema/readers with new writes off. Use live-derived configs and the pinned engine/UI pair. No placeholder DB IDs, blanket feature enabling, handle reclamation or personal-portfolio cutover.
3. Enable only an existing controlled synthetic QA tenant. Verify preparation, exact publication, stale-link suppression, idempotent recovery and withdrawal through canonical public URLs. Use approved fixtures; do not publish customer domains or send real messages merely to test layout.
4. Qualify actual routing/version headers for the serving coordinator, not just the outer Worker badge. Preserve all existing hostname authentication/verification boundaries. This release must not require new DNS/provider changes.
5. After controlled checks, enable an owner-selected consenting pilot with explicit content publication. Independently check anonymous output and authenticated draft state. Any real inquiry/mail test needs the existing authorized controlled-mailbox workflow and fresh receipts; synthetic tests do not establish delivery.
6. Observe a seven-day pilot and review a minimum of five completed owner workflows, including price maintenance and withdrawal. At day seven, insufficient workflows leave broader enablement held; they do not start an automatic unbounded audit/retry cycle. Proceed to broader opt-in enablement only after the acceptance tasks below and preservation checks pass. Stop on a data/privacy/incorrect-publication defect; turn off new writes and retain compatible reads and withdrawal. This observation is a release procedure to implement, not a newly scheduled automation.

Report source/CI, deployed engine, synthetic browser qualification, actual controlled publication/routing, actual inquiry delivery and independent customer usefulness as separate states. No launch claim follows from merging these changes.

## 9. Product acceptance and operating measurements

Controlled task targets, to be verified rather than claimed in advance:

- An unfamiliar consenting owner selects ten names across three searches, assigns a collection and inquiry path, and reaches an accurate review without assistance in five minutes; record draft preparation versus publication separately.
- The owner correctly identifies every public surface for one domain, changes a price and explains which pages will change, without manually rebuilding membership.
- A visitor reaches the correct domain action from a shared collection in at most two deliberate activations after finding the name; an email-only owner remains usable without Sales.
- The owner withdraws a name in one reviewed operation and verifies every platform-hosted public URL; receipts explicitly exclude external marketplaces and downloaded copies.
- No accidental disclosures, silent selection loss, incorrect-price publication or partial composite commit. These are release blockers, not average-rate targets.

Record task time, navigation reversals, selection losses, draft/review abandonment and unexpected publication corrections in the existing controlled qualification receipt. Do not add a visitor-tracking provider. Ask pilots whether they returned voluntarily to publish/maintain another selection; five assisted tasks are usability evidence, not retention or willingness-to-pay proof. Contact no outside participants as part of this planning task.

## 10. Plan review

Review method: a sequential product, UX, architecture, privacy/concurrency, compatibility and release-feasibility challenge against the inspected source and the written draft. This is a planning review, not an independent assessment, security certification or implementation verification.

| Priority | Finding in the initial approach | Resolution incorporated in this plan |
| --- | --- | --- |
| P1 | Publishing a complete saved site while adding a few names could expose unrelated pending edits. | Scoped patches use published baselines; unrelated draft work stays pending; distinct public revisions and explicit dependency review are required. |
| P1 | Calling existing publication methods sequentially could leave a profile linked to an unpublished listing or partially change shop membership. | One tenant-local guarded transaction, prepared statements, durable idempotent receipt and fault injection; larger jobs explicitly report separate batches. |
| P1 | A linked listing could change after review, or silently reveal a newer price through a dynamic reference. | Pin reviewed Sales revision/terms; fence existing and new writers; suppress stale price/action; explicitly rebind after review. |
| P1 | A generalized v2 type guard or v2-only rollback could corrupt/reject v3 data; linked inquiries might accidentally require exposing owner email. | Strict v3 format dispatch across all consumers, compatible rollback floor, updated backup validation, and separate email versus Sales-recipient rules. |
| P1 | Feature rollback could remove recovery actions; removal of a last name could create an invalid publication. | Write flags exclude authenticated recovery; empty collections are omitted; last-name v1 unpublishes and v3 becomes profile-only. |
| P2 | A full store rewrite, new DNS setup or SEO activation would inflate scope and create unrelated gates. | Reuse current inventory, stores, inquiry transport and URLs; keep address setup optional and discovery-policy changes separate. |
| P2 | Selection persistence and large-batch success could be overstated. | State tab-local versus saved behavior, consume existing cursors, freeze exact manifests, enforce measured budgets and show per-batch receipts. |
| P2 | Pilot qualification could continue indefinitely without evidence. | Fixed seven-day observation; insufficient usage holds broader enablement without an automatic retry loop. |

### Review result

No blocking findings remain in the reviewed plan after these revisions. Product scope and the publication rules are decided. Implementation still must prove the composite transaction envelope, durable fencing of existing writers, v3 recovery compatibility and anonymous routing under the exact deployed candidate. Those are explicit engineering/release acceptance gates, not completed checks.

Recommended execution order: P1, P2, P3, P4, P5, P6. Release P1-P3 when their checks pass; enable v3/combined writes only after P4-P6 and controlled qualification. The next action is an isolated implementation branch from the refreshed hosted fork, beginning with the presence contract and fixtures. No application code, migration, deployment, public content or external message was changed by this planning task.
