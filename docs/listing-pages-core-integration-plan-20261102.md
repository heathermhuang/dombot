# Listing pages as the public face of the domain workspace

Date: 2 November 2026. Status: product and engineering proposal, not implemented or approved for release. Source inspection: `0fae67feba34661eab0644e4d850c595ec5ac3e9`, including the full upstream integration. This document is separate from the clean-URL implementation in draft PR #138. No production state or marketplace listings were changed to prepare it.

## Recommendation

Make one canonical domain identity connect private holdings, marketplace listings, public offers, conversations and eventual sale records. Keep each system's authority distinct. The core app manages the domain and external accounts; the published page presents an explicitly approved buyer offer. The public page should help a buyer take the next step, while the private workspace explains prices, sources, discrepancies and tasks.

Do not build a second inventory or another marketplace settings area. Do not make every connected marketplace listing public. A marketplace record is an observation of an external listing, not proof of domain control, a current checkout quote or consent to publish it on our site.

## What the current source establishes

| Area | Existing implementation | Integration implication |
| --- | --- | --- |
| Core market records | `src/shared/markets.ts`, `src/core/services/markets/*`: Afternic, Atom and Sedo listing state, prices, buy-now semantics, public minimums, private floors, discounts, installment availability, sales and capabilities. | Reuse this normalization and these connections. Do not build another set of adapters or credential forms. |
| Core owner workflow | Domains Owned/Listings/Archive, per-market columns, price discrepancy indicators and listing writes/jobs; upstream Sales shows transactions and next steps. | Public-page preparation belongs alongside these domains. Preserve Sales as the transaction workspace. |
| Hosted public offers | `hosted-sales.ts`, `core/publication/sales.ts`: inquiry/offer/provider modes, portfolio asking price or explicit override, one saved provider destination and revision-bound publication. | This is a useful publication boundary, but has no marketplace source binding yet. |
| Hosted channels | `pages/sales/Channels.tsx` says automatic marketplace connections are unavailable; `sales-provider.ts` describes manual link capabilities. | The copy describes the older hosted subsystem, not the full app. Show connected market data separately from whether a checkout link can be created or verified. |
| Draft selection | `salesInventoryNames` currently unions registrar inventory, imported names and saved site selections. It does not directly include synced market listing names; registrar-only `getCachedPortfolio()` can be null for market-only accounts. | A market-first owner needs a path from a synced listing into a private public-page draft. This must not bypass control checks at publication. |
| Money | Core market amounts are canonical decimal strings. Hosted `saleMoneySchema` currently accepts positive whole amounts only. | Integrating market prices requires a versioned, exact money contract. Never silently round external prices or reuse approximate reporting conversions for checkout. |
| Site integration | V3 site links, the presence inspector and scoped publication change sets already bind public pages to approved Sales revisions. | Extend these paths rather than reconstructing profiles, collections and shop membership again. |
| Outcomes | Core Sales reconciles market transactions and sold events. Hosted `sales-reconciliation.ts` also calls `markSold` for seller-entered payment/transfer/completion reports; `markSold` writes a user-sourced sold event without price or currency. | Audit this bridge before feeding more hosted outcomes into core reporting. A seller report, an agreed price and a completed provider sale must remain distinguishable and must not create duplicate sale records. |
| Routing | PR #138 implements canonical domain paths with bounded discovery across accounts. | Keep the URL contract. Replace fleet-wide discovery with an authoritative directory before broad rollout; a 64-account ceiling is not the product's intended capacity. |

These are static source observations, not fresh provider or customer qualification.

## The owner experience

Start in the existing Domains table. Add a compact **Public page** column showing private/draft/live/needs-review/paused state, with **Prepare page**, **Edit**, **Preview** and **Copy link** actions. Preserve existing market columns and their editors. The same actions should be reachable from a domain's detail panel and bulk selection.

The domain workspace should group the existing tasks:

1. **Overview:** domain control and holding state, public-page status and recent actionable events.
2. **Listings:** observed prices and state on each connected market, the owner's intended asking price, discrepancies, sync status and existing explicit write actions.
3. **Public page:** presentation, approved price source, primary buying path, optional inquiry/offer path, public preview and exact publication review.
4. **Inquiries:** existing hosted conversations, offer history and private notes for this domain.
5. **History / sale:** core ownership events, provider transactions, fees, transfer tasks and payout state.

These can be sections and contextual links over existing screens; this does not require a new top-level navigation system or replacement of upstream Sales. Keep public profiles and collections as optional merchandising surfaces. An individual domain page must not require creating a profile or shop.

**Prepare from marketplace** should prefill a private proposal from the selected account/listing. Show the source and observation time, eligibility problems and a preview. The owner chooses the public destination, terms and exposed surfaces, then reviews and publishes. Bulk preparation uses existing job limits and per-name results. Refreshing or importing data never publishes it.

Market-only and imported names may enter a private draft. Before publication, require the existing qualified registrar or DNS control path; do not label a market account connection as ownership verification.

## The buyer experience

The normal page contains the domain name, a concise owner-approved description, one clearly labelled price or inquiry state, and one primary action. Keep source reconciliation, commissions, private floors and sync errors inside the owner workspace.

| Approved situation | Primary action | Secondary path |
| --- | --- | --- |
| Selected active fixed-price marketplace offer with a qualified destination | **Buy through Afternic / Atom / Sedo** | Ask the owner, only when enabled and operational. |
| Provider offer-only listing | **Make an offer at [provider]**; label any displayed price as asking, not fixed. | An optional owner inquiry, with its separate minimum and recipient rules. |
| Direct negotiation | **Make an offer** or **Send inquiry** | Show the current confirmation-and-email workflow. |
| Valid provider destination but no supported current price observation | **View on [provider]** | Do not invent a fixed purchase price or verification badge. |
| Sold, on hold, withdrawn or control uncertain | Suppress purchase and new-offer actions. | Offer only explicitly appropriate navigation to other published names. |

A priced purchase should not require a lead form before the buyer can reach the selected provider. If the owner deliberately exposes more than one provider, put alternatives below the primary action and label each route's own currency, price and terms. Do not auto-rank by the lowest apparent price: fees, currency, discounts and financing may differ, and the owner may prefer a particular channel.

Reuse existing owner/collection navigation only for explicitly published references. A neutral inquiry page remains complete without those references. Keep the current design system. No new theme system or public search marketplace is necessary for this integration.

## Separate price intent, observed offers and published terms

There should not be one scalar price overwriting all other values. There are three different facts:

- **Owner asking price:** the intended price managed in the core app.
- **Observed market offer:** what a specific connected account last reported, with status, currency, buy-now semantics and freshness.
- **Published public offer:** the exact fields and buying path the owner approved for the page.

Add a marketplace source option beside existing portfolio/override sources. Keep the private source reference, selected account, normalized listing identity, observation time and dependency fingerprint in encrypted draft/review state. Publish only allowlisted buyer terms and a safe destination. Never publish account IDs, private floor prices, credentials, costs, net proceeds, raw `extra` payloads or negotiation-only links.

Use the core canonical decimal-money rules with currency minor units, explicit bounds and versioned migration of old whole-amount records. Comparison and publication must be exact. Currency conversion may help the owner compare data, but it cannot silently change a quoted transaction currency.

**Capability distinctions matter:** connected-market reads, listing writes, public URL resolution, live availability verification, checkout-link creation and full financing quotes are separate capabilities. Afternic/Sedo/Atom core connectivity does not establish all of them. Spaceship/Efty may remain manual destinations until supported data or qualification exists. Use the existing adapter capability framework rather than a universal true/false API label.

Installment availability and `maxPayments` alone are insufficient to calculate an exact monthly payment: down payments, fees and eligibility are missing. Initially link to provider payment options. Show a numerical plan only when an approved complete quote supplies its exact terms. Apply the same rule to discounts: require a known effective price and expiry; do not reconstruct time-sensitive terms from incomplete data. Fast Transfer eligibility is not a promise of immediate delivery.

A syntactically allowed provider URL is also not verified checkout availability. Add provider-specific, tested public URL resolution and identity checks where supported, retaining honest manual links elsewhere. Do not scrape or invent privileged checkout endpoints. Expiring, negotiated and access-bearing payment links should not become general public listing destinations by default.

## Maintenance and failure behavior

| Event | Owner sees | Public behavior |
| --- | --- | --- |
| Core asking price or selected market terms change | Before/after terms and affected public surfaces; **Review update**. | No silent new commercial terms. When the approved source fingerprint no longer matches, suppress the misleading numerical claim and use a neutral provider handoff or an independently approved inquiry path. |
| Market read fails | Last successful observation, failed attempt and a retry path. | Preserve unknown state as unknown. A failure is neither delisting nor a zero price. Do not claim a current price from an expired observation. |
| One market is pending, rejected, inactive, hidden or on hold | Exact channel problem and existing repair action. | Disable that channel's action; an independently qualified alternative may remain. |
| Confirmed sale or lost control | Transaction/control evidence and all affected public surfaces. | Stop selling through the platform promptly. Any external delisting remains a separate explicit provider write. |
| Payment reported, transfer reported or accepted offer | A pending/reported state with provenance and evidence. | Hold conflicting purchase paths as appropriate. Do not book completed revenue or create another completed sale automatically. |
| Withdrawal | Exact site/page/shop impact and one receipt. | Reuse the existing scoped withdrawal behavior. Retain private history and conversations. |
| Market sale cancelled or domain reacquired | New evidence and a review task. | No automatic reactivation of a previously approved offer. |

Default publication remains reviewed and versioned. Safety suppression may happen automatically under the product's existing loss/sale/expiry rules because it removes an unsupported action. Publishing a new price, destination, description or collection exposure remains an explicit owner action. Optional automatic following of selected market prices would be a later product policy requiring bounded opt-in, not an implicit consequence of connecting an account.

Freshness belongs to the selected field/source, not just the last generic sync. Record a successful complete listing observation separately from the provider's own `updatedAt`, partial reads and account errors. Define a bounded validity policy per source before exposing live-price claims; do not invent one universal freshness duration in the UI.

## Conversations, transactions and measurement

Keep the existing hosted inquiry store for messages, verification, private notes and email delivery. Link it to the canonical domain and, when available, the actual core transaction. An accepted offer does not establish payment, transfer, payout or completed sale.

Use provider/account/transaction identity to join imported market sales to existing events. When a seller-entered deal later appears in market sync, reconcile it through an explicit match rather than creating a second sale. Preserve amount, currency, fees, evidence source, installment state and payout date. Core Sales remains the place for transfers, profit and realized proceeds.

Measure the hosted journey with distinct events: page rendered, selected provider opened, verified inquiry created, sale evidence linked. Provider-reported traffic/leads remain their own measurements; do not add them to hosted counts as unique people. A click or similarly dated sale is not proof that the page generated the sale. Use existing reporting and local/aggregate collection where appropriate; this does not authorize another analytics provider or visitor profiling.

Read-only MCP can inspect a domain's public presence and return a suggested page draft using the same source model. Saving that draft requires the appropriate existing management authority; publication retains its separate explicit review and commit. A read grant cannot save, publish or synchronize commercial terms. Registrar DNS changes, marketplace writes, paid actions and messages retain their existing explicit scopes and confirmations.

## Scalable canonical routing

Keep `domains.domains/<domain>` stable, but use a domain-to-tenant publication directory in the control plane. Lookup should use a directory row plus the selected tenant's published eligibility read, rather than contacting every tenant. Do not store credentials or private inventory in the directory.

Claim/reserve a domain route before a publication can introduce a new page; bind the reservation to canonical domain, tenant, listing and route generation. Cover standalone publication, bulk jobs, combined publication and recovery paths. A reservation never publishes content. The tenant's exact reviewed commit remains the only content-publication authority. Treat a failed/unknown cross-database outcome as pending reconciliation; do not claim atomicity across the control and tenant databases.

Duplicate or conflicting current owners remain held. Route transitions must require fresh control evidence and an explicit reviewed transfer; neither last-writer-wins nor a permanently stale former-owner claim is acceptable. Unpublish must immediately make the tenant reader unavailable even if a directory row remains. The directory is a locator, not authority to serve an expired or withdrawn snapshot.

Backfill existing publications through a one-time bounded, paginated published-only migration with a conflict manifest and resumable checkpoint. Qualify all existing writers and future tenant templates before turning on directory-only reads. Preserve old UUID redirects and do not guess a migration destination from a private draft. Load-test the existing 500-account qualification scale; one unrelated tenant outage must not disable every listing page.

## Alternatives considered

1. **Mirror connected marketplace records directly onto public pages.** Least owner effort, but connecting an account would disclose inventory and changing remote terms could rewrite public promises without review. Reject as the default.
2. **Keep manually maintained public pages forever.** Safest small change, but duplicates data, leaves known pricing drift and makes the new core integrations feel disconnected. Keep as a fallback, not the primary workflow.
3. **Prepare source-backed public offers, then publish an approved snapshot.** Reuses core data and existing publication controls while retaining a simple buyer experience. Recommended.

This proposal recommends the third approach. It does not record user approval of that implementation choice.

## Delivery order and acceptance

1. **Remove integration contradictions.** Correct the channel connection model/copy, expose existing market status beside page preparation, include market-only names in private draft selection and resolve the decimal-money boundary. Acceptance: an owner with only a connected market can prepare a correctly priced private draft; it stays unpublished without qualified control and explicit review.
2. **Qualify routing and source contracts.** Add the directory/reservation migration and typed market offer selection, fingerprints, exact monetary values and safe destinations. Acceptance: 500 accounts, duplicate claims, ownership transfers, interrupted publication, withdrawal and an unrelated tenant outage all resolve safely; no per-visitor fleet scan.
3. **Connect preparation and publication.** Add the source selector and provider handoff to the existing domain/editor/change-set flow. Acceptance: prepare from one market record without retyping its price or destination; review exactly the selected fields/surfaces; publish once and reach the correct buying path from the canonical page.
4. **Close maintenance and transaction loops.** Handle stale terms, pending/completed sale states, cross-surface withdrawal, outcome deduplication and honest source measurements. Acceptance: changed price, expired discount, lost control, sale in progress, completed sale, cancellation and reacquisition produce the right page and core Sales state without duplicate revenue or automatic external writes.

Keep phases reviewable. Reuse upstream provider adapters, domain selectors, listing writes/jobs, public projections, scoped changes, recipient verification, inquiry delivery and reporting. Extend versioned schemas, backups and negative tests rather than silently changing persisted `hosted-sales` meanings. Do not retire compatibility screens until the integrated journey covers their supported tasks.

Useful acceptance tasks are: prepare a page from a connected marketplace, explain a discrepancy before publishing, reach the selected provider from the shared link, reconcile an inquiry with a real sale, and withdraw the name everywhere on our platform. No task-time or conversion improvement is claimed until observed with independent users.

Deferred: native payment custody, guaranteed transfer promises, universal automatic repricing, buyer accounts, a public marketplace search engine, new marketplace adapters, automatic DNS changes, new analytics vendors and arbitrary design themes. Existing indexing policy remains unchanged; SEO activation is a separate decision after page correctness and explicit exposure are qualified.
