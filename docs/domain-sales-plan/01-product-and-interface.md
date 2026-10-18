# Product and interface specification

## 1. Audience and outcome

An active investor wants to price and publish selected names, negotiate personally, and use a trusted payment/transfer provider. A hands-off owner wants to route buyers to a marketplace or broker. A large-portfolio operator wants bulk consistency, reliable notifications and renewal visibility. A builder needs to keep some holdings private or explicitly unavailable.

The primary seller action is **give a selected domain a working sales path**. The primary buyer action is **buy the domain or contact its seller with clear expectations**. Success requires a real inquiry or provider handoff and a usable operational record, rather than a visually complete page alone.

The initial data range is 0–20,000 inventory names, 0–500 selected names in the first pilot, up to 100 rows per table page, and lead threads with up to 100 messages loaded in pages. These are product/design bounds, not claims about current platform capacity. Qualify larger publication cohorts before enabling them.

## 2. Information architecture

Retain the existing app's top navigation and add one Sales tab. Do not rebuild account navigation for this feature.

```text
Domains         Existing inventory, accounts, private prices and registrar actions
Sales
  Listings      Selling view of the same holdings; drafts, live pages and issues
  Inbox         Verified and pending inquiries; follow-ups and conversations
  Shop          Selected inventory, shop appearance and publication review
  Channels      Checkout destinations, CSV exchange, later connected APIs
Renewals        Existing expiration and renewal economics
Activity        Existing events plus sales and delivery events
Settings        Existing account/security; new sales preferences and retention
```

Proposed app-relative routes: `/sales`, `/sales/listings/:id`, `/sales/listings/:id/review`, `/sales/inbox`, `/sales/inbox/:id`, `/sales/shop`, `/sales/channels`. The hosted router continues to supply `/w/:workspace` through existing path helpers. Keep `/public-page` and old public URLs working. Call the existing area “Public site” until a separately reviewed navigation change consolidates it with Shop; do not silently move or republish its content.

There are three publication controls: domain lander, shop inclusion, and existing public-site inclusion. Selecting one does not implicitly select the others. A public lander may be omitted from the shop. A historical domain may appear in a portfolio history but cannot have an actionable sales lander.

## 3. Visual system

Brand voice: precise, composed, practical. Preserve the full `domains.domains` wordmark, Archivo, forest accents, current UI primitives and theme preferences. No new monogram or rebranding. Seller pages inherit existing CSS tokens; the standalone prototype is a design expression, not permission to replace the global design system.

Seller pages use clear table hierarchy, quiet separators and compact operational text. The domain name is the anchor; status, price and next action are adjacent. Avoid a dashboard filled with large numerical cards. Use small counts in filters, a concise attention strip, and a real ledger. Buyer pages use more space, a large readable domain and a single dominant transaction panel.

Proposed component tokens: 4/8/12/16/24/32/48 spacing; 14–16px body, 12–13px metadata, 20–28px seller headings, 40–72px buyer domain heading that wraps safely. Tabular numerals for prices/dates. Standard controls are at least 44px touch targets, including expanded hit areas around compact table checkboxes. Focus is visible and independent of hover. Motion is limited to 120–180ms opacity/transform feedback and respects reduced motion.

Use status words with color as reinforcement: Draft, Changes pending, Live, Needs setup, Paused, Ownership uncertain. Never use a green dot as the only explanation. “Published” means an explicit snapshot exists; “Domain active” additionally means hostname, TLS and observed page checks passed. A configured provider is not a verified purchase link.

## 4. Listings workspace

Desktop: page title and one Create sales page action; a short attention strip only when actionable; filter tabs All / Live / Drafts / Needs attention / Paused; text search; filter controls for mode, channel and registrar account; table; pagination. A selection toolbar replaces the normal toolbar when names are selected.

Default columns: select, domain, sale mode, public price/currency, sales page status, destination, latest inquiry, actions. Registrar, expiration and renewal estimate are selectable columns. The underlying Domains screen retains its own immediately visible registrar-critical information. The Sales screen does not force owners to re-enter it.

Row click opens the listing editor. A separately labelled Open public page link opens the published version. Prices show `USD 14,800`, `Request price`, or `Not set`, never an ambiguous dollar symbol or zero. A smaller pending marker shows when private settings differ from the last public snapshot.

Bulk actions: create private sales drafts, set mode, choose destination, copy default prices, include/exclude shop, review publication, pause, export selected settings. Show exact selected names and a filtered-selection/all-matching distinction. Initial server jobs accept up to 100 items per reviewed batch; larger selections become resumable jobs with individual receipts. Never label a partially completed job Published. Any DNS action remains separate from editing or publishing content.

Empty inventory: “Add domains to start selling” with Connect registrar and Import CSV. Inventory without sale drafts: show selectable existing names and “Create a sales page for selected domains.” Empty filter: preserve filters and offer Clear filters. Loading retains column geometry. Failed fetch retains the last rendered data with a visible stale/error notice and Retry.

## 5. Domain editor and publication review

Use a full page with the form on the left and buyer preview on the right at wide widths. At narrow widths use Settings / Preview tabs; preserve form state when switching. Avoid a long modal. Header: domain, draft/public status, Save draft, Preview, Review changes.

Sections in order:

1. **Sales path.** Inquiry, Make Offer, Buy Now, or Send to marketplace. Explain the consequence in one sentence. Paused/private is an availability control, not an artificial sale price.
2. **Price and terms.** Use portfolio asking price by default. Display that source, its update time and private floor label. An override explicitly reads “Public/channel price override” and is stored as a private draft until published. Minimum offer is separate from the private floor. Use existing whole-amount/currency validation for asking prices. Require a positive BIN and valid checkout for Buy Now. Inquiry may omit price. Make Offer may omit a minimum. No automatic currency conversion.
3. **Checkout or contact.** Provider selection and an exact link, inspection state, provider/domain/price match when verifiable, and last check time. Explain that payment and transfer happen with that provider. Direct inquiry destination is a verified account recipient; do not publish their raw email by default.
4. **Buyer copy.** Display capitalization, optional description up to 400 characters, optional categories, seller display name. Domain canonicalization still uses ASCII for authority; an IDN shows Unicode and its ASCII form. Descriptions cannot imply trademark clearance, revenue, traffic or ownership proof that has not been established.
5. **Visibility.** Lander publication and shop inclusion have independent checkboxes. Public-site references are shown as existing references, not auto-edited here.
6. **Domain setup.** Shareable URL, customer-domain connection state, exact DNS plan, and checks. It is possible to publish a shareable page while customer-domain setup remains pending; the UI must say so.

Save draft does not publish, update registrar DNS, overwrite an external listing, or change private floors. If the source portfolio price changed after review, require a new review. On a revision conflict retain the unsaved form and show Compare saved version / Reload; never silently overwrite another tab.

Review is a dedicated route with a before/after diff of domain, public price, sale mode, description, displayed seller name, provider link and shop inclusion. A “Kept private” summary names floor, costs, notes, credentials and buyer records without displaying their values. The review identifies the source-price fingerprint, ownership observation time and draft revision used by the commit.

Publication button: `Publish this sales page` or `Publish 24 reviewed changes`. A new route without domain activation returns “Page published. Domain setup still needed.” A live domain with a newly committed snapshot returns “Sales page updated” only after a read confirms the new revision. DNS activation is a separate action with an exact before/after plan and rollback instructions.

## 6. Buyer lander

Desktop layout: a restrained seller/brand header; two columns with the domain and concise purpose copy on the left, and a purchase/inquiry panel on the right. Under the main area, explain payment and transfer in three short steps using factual provider-specific copy. A small link to More domains is optional. Avoid unrelated names, advertising, a required biography, invented testimonials or decorative charts in the primary decision area.

Buy Now: “This domain is for sale”, domain, optional description, full currency/price, dominant `Continue to [provider]`, secondary Ask a question, clear “Payment and transfer handled by [provider]. Terms and any additional charges are shown there.” Do not call a provider “licensed escrow” without confirming it. Provider logos/trademarks need permitted assets; plain provider names work initially.

Make Offer: domain, optional asking price and clearly disclosed minimum, form fields Name, Email, Offer with fixed currency, optional Message. Inquiry: Name, Email, Message; no required phone, company, budget questionnaire or buyer account. Name 1–100 characters, email up to 254, message up to 4,000. Do not require a message when making a valid monetary offer. Exact validation rules belong in shared schemas, not only HTML inputs.

After submitting: “Check your email to confirm this inquiry.” Preserve a reference number. After confirmation: “Your inquiry has been confirmed. The seller can now reply.” Do not promise a response time unless that owner deliberately sets one. Buyer retry with the same idempotency key returns the same receipt.

If BIN and inquiries coexist, the price and checkout remain primary. Minimum offers must not block a question. Any deposit/qualification flow is deferred until supported by evidence and a transaction provider; it is not a default barrier.

Paused/sold/lost-control states remove actionable sale controls immediately. A neutral unavailable page may offer the shop link if previously authorized, but cannot imply another owner still wants to sell. Unpublished names return a generic missing page. Invalid or failed checkout checks keep Ask a question available if enabled and show no false purchase guarantee.

## 7. Inbox and conversation

Desktop: list pane approximately 340px wide, conversation in the remaining area. List filters New / Following up / Awaiting buyer / Closed, with separate Pending verification and Spam views. Each entry shows domain, offered amount/currency when present, sender display name, verification marker and last activity. These labels refer to email verification, not identity or financial qualification.

Conversation header shows domain and current public asking price; the original inquiry records the snapshot/price the buyer saw. Timeline distinguishes Buyer message, Seller reply, Private note, Notification event and Sale status. Notes never enter buyer responses. Seller composer has explicit Reply / Private note modes and a reviewable recipient. Sending a reply requires an enabled notification path; failed send retains the draft. The interface distinguishes Saved, Sending, Accepted by email service, Delivery unknown, Bounced and Failed.

Actions: set follow-up date, change conversation status, mark spam/block, create provider checkout handoff, record a sale, export thread, delete under retention policy. There is no automatic financial commitment when a seller marks an offer accepted; use “Price agreed” and a provider checkout handoff. Record paid/transfer-complete manually with evidence when no qualified provider event exists.

Buyer portal uses an inquiry-scoped expiring capability link and requires no seller account. Expired link offers a bounded resend to the already associated address without disclosing it. Forwarded links can disclose that conversation until revoked; the UI and security design treat them as capabilities. Phase 1 may use a verified inquiry plus seller-initiated email reply, but the full inbox/reply milestone requires the durable conversation and delivery states above. Do not present a mailto click as a recorded successful send.

## 8. Shop and channels

Shop: selected live listings, search, price range, TLD, category and sale-mode filters. A text/list view is the default; optional logo tiles are secondary. The buyer can see domain, clear currency/price or Make Offer, and open its lander. Private names, historical names and unpublished drafts never become search results. A zero-result state preserves the buyer's filters and offers Reset. No compulsory projects/profile section.

Shop configuration reuses owner-site profile/collections where compatible via explicit import/copy. It does not convert v1/v2 documents automatically. Before publishing show added/removed names, price differences and public contact changes. A shop-specific landing configuration is versioned independently of old public sites until a migration is separately chosen.

Channels: show each provider as one of Manual link / CSV exchange / API connected, plus capabilities and last verified interaction. “Connected” requires a successful authenticated check; “Syncing” requires a job. CSV export is labelled Export for upload, with a named provider schema and exclusions. No broad “synced everywhere” claim.

Each external listing record distinguishes desired, submitted and observed price/currency/state. Show an intentional markup as such. Atom Premium restrictions cannot be represented by one global discount/markup rule. Installment options are shown only from a supported provider configuration, with the total price, term and fees; we do not synthesize a monthly payment by dividing a BIN price.

## 9. Responsive, accessibility and content acceptance

At 320–639px: app navigation remains reachable via the existing mobile pattern; Sales subnavigation scrolls within its own region. Listings become compact structured rows showing domain, mode, price and status; an accessible details action reveals the remaining fields. Bulk selection stays available. Inbox is list → conversation with Back to inquiries. The editor uses tabs. The buyer's price and CTA precede supporting copy; no fixed footer covers a keyboard or form error.

At 640–1023px: retain a table in a labelled horizontal scroll region when useful; no page-level horizontal overflow. At 1024px and above: full ledger/editor and split inbox. Buyer line breaks must handle a 63-character label and a 253-character full domain without hiding text. 200% zoom, keyboard-only operation and reduced motion are first-class states. Preserve semantic table headers, labels, field errors, heading order, live save/status announcements and focus after navigation. Meet WCAG AA contrast using measured colors; automated checks supplement manual keyboard testing.

Representative error copy:

| Condition | Copy and recovery |
| --- | --- |
| Missing checkout | “Add a checkout link before publishing Buy Now.” Focus the link field. |
| Price conflict | “The portfolio price changed after this review. Review the latest price before publishing.” Preserve edits. |
| Offer below minimum | “The seller considers offers from USD 5,000. You can still ask a question.” |
| Uncertain ownership | “We could not confirm current control. The sales page is paused.” Explain the next verification step privately. |
| Pending TLS | “DNS is connected. The security certificate is still being issued.” No Live badge. |
| Email unavailable | “We saved your message, but could not send its email yet.” Show retry/resend status and reference. |
| Provider mismatch | “This link appears to refer to another domain. Check it before publishing.” Block verified Buy Now. |
| Partial bulk result | “18 updated · 2 need review.” Link to the exact two failures. |

The design is accepted only after all four sale modes, empty/error/conflict states, seller mobile flows and buyer form/handoff behavior are inspectable. The prototype illustrates selected paths; implementation must cover the full state inventory.
