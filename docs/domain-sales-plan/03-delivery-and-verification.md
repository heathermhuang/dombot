# Delivery and verification

## 1. Execution order and release boundary

Implement in an isolated branch from refreshed main, preserving the primary checkout and the research artifacts. These are proposed work packages, not created PRs or issued deployment commands. Package IDs below provide a concrete dependency graph.

Start the custom-hostname and sales-email feasibility checks early. A failed provider prerequisite must not cause us to advertise a canonical shared URL as an activated domain lander. It also need not block independent schema, editor or prototype work.

```text
A Contracts + fixtures ──> C Sales stores/projections ──> D Listings/editor/review
       │                            │                           │
       ├──> B Host/email feasibility ├──> E Inquiries/outbox ──> F Inbox/replies
       │                │           │                           │
       │                └──────────> G Public edge/domain setup │
       │                            │                           │
       └───────────────────────────> H Shop + bulk + health <────┘
                                             │
                           C + D ──> I Provider API adapter
                                             │
                          C/D/E/F/G/H ──> J Controlled release
```

I is optional for the first complete release when reviewed manual links work. Domain activation in G and reliable inquiry handling in E/F are part of the first coherent sales beta. H's core bulk publication, shop selection and operational health are required; advanced reporting can follow.

## 2. Work packages

### A. Contracts, fixtures and feature capabilities

Create `src/shared/sales.ts`, `sales-review.ts`, `sales-events.ts` and fixtures. Reuse existing domain/money validation. Add explicit `supportsSales()` host capability and flags rather than inferring support from the old publishing editor.

Fixtures: no domains; imported/unverified name; fresh registrar ownership; conflicting registrar accounts; inquiry-only; offer with/without minimum; BIN manual/verified/mismatched/expired checkout; explicit public-price override; IDN and maximum-length name; pending TLS; paused/sold/lost-control; two revisions from separate tabs; duplicate inquiry; failed/unknown mail delivery; empty/large shop. Fixtures use `.example`, example email addresses and unmistakable sample labels.

Acceptance: strict schema tests reject private fields in public objects, invalid currencies/amounts and conflicting terms. Public projection tests include a private floor, credential and note sentinel and prove none reaches HTML, JSON, metadata, shop search or export. Existing v1/v2 parsing stays unchanged.

### B. Hostname and email feasibility, without broad onboarding

Inspect current Cloudflare entitlement and existing account configuration read-only. Document supported apex approach, customer DNS prerequisite, Worker-as-origin routing, certificate setup, any incremental cost and whether ownership checks can be completed before switching traffic. Name a controlled test domain before any DNS write; reserve it for the later explicit activation stage.

Check a separate sales sender/binding, limits, suppression/bounce visibility and provider idempotency support. Reuse current login/auth delivery receipts only as evidence for that auth channel; qualify sales verification, seller alerts and buyer replies separately. No new provider, paid upgrade or automatic recipient enrolment is implied by this planning task.

Deliverables: capability matrix, precise DNS before/after example, rollback plan, sales-mail envelope/receipt schema, and unresolved access/cost decisions. Acceptance: no unsupported universal-apex claim, no reliance on the auth-mail budget, no assumption that a configuration file proves live readiness.

### C. Sales settings, publication and backup

Add `src/worker/sales-store.ts`, `sales-routes.ts`, `public-sales.ts` and `src/core/publication/sales.ts`, plus additive migrations. Mount narrow public reads before private boot and authenticated routes behind existing controls. Implement review manifests, source-price/destination fingerprints, immutable public snapshots, idempotency and pause/unpublish. Add proposed proof claims without weakening legacy routes.

Implement export/restore and key rotation in this package, before production data exists. Do not postpone them to cleanup. Reconcile publication, availability and existing sold/departed history idempotently. Keep a previous public-content revision for explicit rollback without reviving a sold/closed listing.

Acceptance: stale review cannot publish across two isolates; zero-row CAS does not produce a successful dependent write; private settings never publish implicitly; old public-site payloads remain byte-identical unless explicitly edited; restore is private and silent; close/disable workspace denies sales paths.

### D. Seller listings, editor and buyer lander

Add `src/renderer/pages/sales/{Listings,ListingEditor,PublicationReview}.tsx`, shared sales components and a renderer client using existing path/API helpers. Add the Sales tab without replacing Domains or Renewals. Implement the four sale modes, source-price display, override choice, preview, exact review, row and batch receipts. Add `src/shared/render-sales-lander.ts` using the strict public type and existing escaped/server-rendered conventions.

Acceptance: keyboard and mobile can complete create → edit → preview → review → publish; publishing a shared page never says the customer domain is live; missing/invalid checkout blocks Buy Now; a question can still be sent when an offer is below minimum; external links have a named destination and no open redirect endpoint. All visible controls work or are explicitly unavailable with a reason.

### E. Inquiry intake, verification and outbox

Add `src/worker/sales-inquiry-routes.ts`, `sales-inquiry-store.ts`, shared inquiry schemas and `src/hosted/sales-notifications.ts`. Implement Turnstile validation, scoped abuse limits, duplicate-submission handling, pending/verified states, scanner-safe confirmation and durable notification intents.

Extend the gateway's scheduled dispatcher with a separate bounded sales job, preserving existing hourly cleanup. Use durable due-work indexes and per-tenant checkpoints; skip unchanged/no-work tenants, apply retry-after, and cap total items each run. No model inference is used to poll an outbox. Fast dispatch is a best-effort acceleration; scheduled recovery is deterministic.

Acceptance: a persisted inquiry survives process failure before sending; network retry creates one inquiry; two concurrent workers cannot lease the same item; old/new lease ACK cannot collide; mail failures remain visible; duplicate/expired Turnstile refresh preserves input; scanner GET cannot confirm; auth email continues to function when sales quota is exhausted.

### F. Inbox, replies and outcomes

Add `src/renderer/pages/sales/{Inbox,Conversation}.tsx`, inbox components and buyer-thread rendering. Separate replies from private notes in types, UI and storage. Implement follow-ups, status changes, verified-recipient replies, controlled capability resends, draft preservation, export and deletion.

Record agreed price separately from actual settlement. Support manual provider handoff and clearly labelled seller-entered sale/transfer receipts. Integrate existing sale/history records through an idempotent bridge. No browser event or checkout click can mark a sale paid automatically.

Acceptance: buyer cannot see private notes or unrelated conversations; anonymous token cannot access seller APIs; failed reply is recoverable; token rotation revokes the old capability; changing a seller recipient requires verification; no message leak in logs/referrers; seller-entered outcome and provider-confirmed outcome are distinguishable.

### G. Public edge and customer-domain setup

Add `src/hosted/lander-edge.ts`, `sales-hostnames.ts`, a dedicated Wrangler config and control migrations. Bind only qualified public operations to tenants. Implement claims, DNS plan, hostname/TLS observation, binding epochs, workspace suspension, detachment, and exact public-route matching.

First qualification uses one named owner-controlled apex and, if separately supported, its `www` alias; each is explicitly configured. Verify HTTP/HTTPS, both hostnames, canonical behavior, certificate chain, submitted inquiry, notification and detach/rollback. Do not infer apex support from a subdomain test. Preserve MX/TXT/CAA and old registrar state through snapshot comparisons. Registrar automatic DNS edits remain disabled until that exact provider/account/write operation has its own qualification receipt.

Acceptance: forged Host/proof/workspace headers fail; another tenant cannot claim an active hostname; changing binding epoch invalidates old admission; closed account returns no actionable page; CAA/TLS pending/error states remain honest; no session cookie or private API is reachable on customer hosts; rollback restores the recorded route/records without reverting unrelated DNS edits.

### H. Shop, bulk operation and health

Add a selected public shop schema/store/renderer and Sales → Shop editor. Offer an explicit copy of compatible old site presentation/collections without mutating or converting that site. Public results recheck listing availability. Add bulk review manifests, resumable jobs, channel-specific CSV exports and per-item results. Exports exclude private floors, costs and buyer PII unless the user explicitly selects a private export.

Add bounded health observations: published revision served, active hostname/TLS, destination status, stale ownership, sold-but-listed mismatch, notification backlog and renewal visibility from existing sources. Compare against the last checkpoint before deeper work. Report state changes, not repeated full audits. Do not scrape provider dashboards or frequently poll thousands of pages.

Acceptance: private/unpublished/sold names cannot appear in search, schema metadata or shop export; a partial bulk job resumes only unfinished valid items; all-matching selection cannot expand after review; stale external prices are marked observed/unknown rather than silently overwritten; a broken public path is visible to its seller.

### I. First provider API: Spaceship

Add a capability-based adapter, optional tenant-encrypted credentials, read-only connection test, paginated listing reads and checkout-link creation only after official request/response behavior is qualified. Include a fake adapter for timeout, rate limit, partial success, unsupported TLD/currency and uncertain result cases.

Read and show observed state before offering writes. A provider write requires reviewed exact changes, qualified authorization and idempotent recovery. Do not change a marketplace price merely because the portfolio price changed. Track manual links and CSV exchanges as such. Later Atom/Afternic/Efty/Sedo adapters are separate work packages based on actual access, terms and capabilities.

Acceptance: no secret in logs/public payloads/CSV, no overbroad default write access, uncertain create reconciles before retry, provider/channel restrictions remain explicit, and provider refusal does not corrupt the canonical private price or public snapshot.

### J. Release and controlled end-to-end verification

Run required project checks, repack the engine if consumed runtime source changed, verify its manifest/archive and source hash, and qualify the exact candidate in the controlled tenant. Gateway/edge/control migrations and tenant/schema/engine releases are distinct tracked operations. Prepare a per-tenant migration/feature/backup ledger; do not assume deploying the gateway updates tenant runtimes.

Acceptance: one full controlled buyer journey from custom-domain visit through inquiry, verification, seller reply and provider handoff; one failed-delivery recovery; one pause/unpublish and restored private-backup check; existing login/passkeys/registrar inventory/renewals/public publications unchanged. A real payment/transfer is a separate named controlled transaction and is not required to claim handoff only.

## 3. Verification matrix

| Layer | Required meaningful checks |
| --- | --- |
| Shared schemas | Money/domain normalization, IDN display, mode constraints, strict public projections, forbidden-field sentinels |
| D1/coordination | Revision race, publication CAS, conditional transaction rollback, duplicate inquiry, outbox lease/fencing, partial bulk resume |
| Tenant isolation | Foreign workspace/session/host/token, body/path/proof tampering, owner-null escalation, closed workspace, direct tenant access |
| Privacy | Private notes/floors/costs absent from public surfaces, token/PII redaction, sealed storage, deletion/closure/export/rotation coverage |
| Abuse/delivery | CSRF/Origin, size limits, token expiry, rate/recipient budgets, honeypot, mail scanner GET, quota exhaustion, timeout/unknown/bounce behavior |
| Hostnames | Apex + alias, TXT control, TLS pending/failure, wrong DNS, changed epoch, stale/lost control, conflicting claim, detached host |
| Provider | Allowed destination host/path, domain/currency/price mismatch, expired checkout, rate limits, timeout reconciliation, no false paid event |
| Browser | 320/390/768/1280 widths, 200% zoom, keyboard focus/order, screen-reader labels, light/dark seller theme, reduced motion, slow/offline/error recovery |
| Regression | Auth/email/passkey protections, registrar account targeting, manual prices and CSVs, existing public site, MCP admission and source offer |

Run the existing required commands for implementation changes: root dependency install with scripts suppressed and esbuild rebuild, hosted dependency install, `node hosted/build-auth.mjs`, `npm run typecheck`, `npm run lint`, `npm test`, security-regression Vitest configuration, `npm run engine:verify`, renderer/demo/site builds and gateway/tenant/self-hosted Worker dry runs. Add a public-edge dry run. Use exact commands from current CI, not copied version numbers in this plan. Browser checks are needed in addition to unit tests; no new tests are needed merely to assert this prose exists.

## 4. Flags, migration and compatibility

Proposed independent flags: `DOMBOT_SALES_V1`, `SALES_INQUIRIES_ENABLED`, `SALES_MAIL_ENABLED`, `SALES_CUSTOM_HOSTS_ENABLED`, `SALES_PROVIDER_WRITES_ENABLED`. Hosted-only flags live in hosted configuration; tenant capabilities are passed only through explicit engine contracts. Keep old `DOMBOT_OWNER_SITE_V2` independent. Reads/export/pause/unpublish/revocation remain available after disabling new writes where compatible.

Sequence: backup → additive migration → compatible reader runtime → disabled feature smoke → pilot writer enablement → exact public and recovery receipts → cohort enablement. New data must never be read by an incompatible old runtime. Record schema version, engine source/archive, gateway/edge source, feature settings, migration receipt and data-preservation fingerprint per instance.

Do not auto-migrate old portfolio/owner-site publications into sales listings. Offer an explicit private draft import/copy with ownership and price review. The earlier v1/v2 public renderer remains unchanged. No migration publishes content, activates DNS, changes a registrar, starts email or creates a checkout transaction.

## 5. Rollout and recovery

Stage 0: local contract fixtures and prototype. Stage 1: controlled tenant and canonical shared links with real controlled inbox receipts. Stage 2: named controlled apex and alias with full inquiry/reply/handoff proof. Stage 3: opt-in sellers with known portfolio-size and hostname bounds. Expand only after the operational and privacy checks pass for the consumed candidate. Customer usefulness is a separate evidence milestone from CI and deployment.

Recovery is action-specific:

- Broken renderer: restore the previous compatible content/runtime revision while retaining operational sold/pause/closure status. Never resurrect sale controls by restoring old HTML.
- Mail incident: disable sending, keep accepted inquiries durable and visible, preserve unknown receipts, drain only reconciled due work after recovery. Do not interfere with login mail.
- Provider incident: disable affected purchase handoffs, retain inquiry path where enabled, and show destination unavailable. Never redirect buyers to a different provider silently.
- Hostname incident: suspend affected binding/epoch, preserve DNS snapshot and explicit manual rollback instructions. Do not restore records over unrelated later edits.
- Migration incident: disable new writers, preserve data/backups, deploy a compatible repair. Do not drop new tables or restore the entire tenant database as a routine rollback.
- Root-key incident: keep private routes closed until qualified recovery; public availability changes remain actionable. Verify the backup/key-rotation runbook with controlled data before rollout.

## 6. Operational measures and targets

Initial operational targets are proposals to measure in the pilot, not existing guarantees: normal verified inquiries visible in the inbox immediately after confirmation; p95 first dispatch attempt within two minutes when sending is enabled; no inquiry loss across tested process failures; zero private-field disclosure; no paid-sale claim from a handoff; published revision visible on the next uncached read; accessible buyer LCP target 2.5 seconds at the measured mobile profile. Set final capacity and latency bars using the first qualified baseline rather than inventing platform limits.

Track: publication success/failure by reason, domain activation states, verified inquiry count, pending verification aging, seller first reply, provider handoffs, explicitly sourced sales/transfer outcomes, net proceeds with known fees, and outbox oldest-due age. Report small samples honestly. A two-week pilot is useful for workflow friction and reliability; it is insufficient to establish sell-through for rarely selling inventory.

Run lightweight deterministic health and delivery checks against changed/due records. Alert on a meaningful state transition or persistent actionable failure with a domain/listing and recovery action. Avoid repeated full-portfolio browser crawls, constant unchanged alerts, or using a model as the scheduler.

## 7. External prerequisites and selected decisions

The implementation defaults in README and the UI/architecture documents are selected recommendations, not open preference questions. The following require evidence before enabling the related external capability:

1. A supported and affordable apex-hosting route for the actual account and chosen DNS setup.
2. A separately onboarded sales sender, qualified recipient delivery, quotas and suppression behavior.
3. A named owner-controlled DNS fixture and a precise activation authorization before live DNS writes.
4. Operator review of new buyer-data retention/privacy copy before external collection; this is not a claim that existing site terms cover every new workflow.
5. Provider API access, permitted use, actual response behavior and fee conditions before enabling each connector/write capability.

These are capability gates, not reasons to stop independent authorized work or ask the user to reapprove routine reversible implementation. No product pricing change, paid infrastructure commitment, customer-domain migration or actual purchase/transfer is authorized merely by completing this plan.

## 8. Planning review disposition

The plan corrects the earlier profile-first sequence, prevents a canonical-link prototype from being mistaken for a custom-domain launch, preserves canonical private prices with explicit overrides, and keeps inquiry verification separate from seller authentication. It includes transactional/publication races, outbox ambiguity, hostname reassignment, backup/rotation and existing-engine consumption as implementation work.

This is a source-informed planning pass. It is not formal CSO clearance, independent adversarial review, live registrar-write qualification, provider certification or customer validation. The prototype demonstrates selected interactions only; the verification matrix defines what the implementation still has to prove.
