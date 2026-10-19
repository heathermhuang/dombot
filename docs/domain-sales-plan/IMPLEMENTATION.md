# Sales implementation and release ledger

## Inquiry and email UX follow-up

Engine `.12` adds the full original inquiry, buyer contact details, offer, public
price and relevant public message to both HTML and plain-text notifications. The
projection excludes private notes and private portfolio values. Owner alerts set
Reply-To to the confirmed inquiry email; buyer notifications do not expose the
owner account address. Legacy tenant mail envelopes remain readable during the
ordered rollout.

Public pages use “Get in touch” and “Send inquiry”, explicit inbox/confirmation
steps and a clearer conversation timeline. Submission announces progress and
focuses the resulting heading. Turnstile uses compact rendering on narrow screens
and flexible rendering elsewhere, with a fresh check after crossing the breakpoint.
The 320-pixel browser check has no horizontal overflow.

The operator subsequently selected the conversation relay on 19 October. Engine
`.14` implements role-scoped private reply addresses, atomic grant registration
and message recording through the existing opposite-party outbox. Native mailbox
reply qualification remains a separate live receipt; implementation and provider
setup do not establish delivered or recorded replies by themselves.

## Current controlled pilot — 19 October 2026

The operator-managed sample is live at `sales-pilot.alternative.domains` and
`www.sales-pilot.alternative.domains`. Both hostnames returned ordinary public
HTTPS 200 with active certificates and exact publication revision
`74e4eb08-bbb1-468b-8c3f-49a2c6df2e50`. This qualifies the explicitly approved
Workers Custom Domains path; ordinary customer apex hosting and Cloudflare for
SaaS entitlement remain separate.

The gateway runs commit `16a89538ffd3f81c3c67dff14966e4b912a666c9`; the owner
workspace runs engine `1.5.0-hosted.11`. PRs #54–#57 have green required CI and
CodeQL. The production source offer names the exact gateway commit. The approved
buyer policy is published. Other tenants retain their previous disabled Sales
configuration. The root portfolio, original published portfolio and 18 protected
DNS observations were preserved.

The controlled owner-mailbox journey used the production Turnstile widget with a
manual human check, the real public custom-domain form, normal email delivery,
and the authenticated owner UI. Opening the confirmation email link alone left
the inquiry pending; explicit confirmation enabled seller replies. The seller
reply reached the buyer mailbox, appeared in the private conversation, and the
buyer response appeared in the seller inbox. The owner-only note was absent
from buyer email and the conversation. Confirmation, reply and seller-alert
messages reached the inbox with SPF, DKIM and DMARC passing.

A temporary quota hold affected only this owner's Sales workspace budget. It
produced a known retryable seller alert, then restored the budget. The controlled
fixture's retry deadline was advanced after restoration; the ordinary scheduled
dispatcher retried it successfully, and the alert reached the inbox. No unknown
provider outcome was replayed. Global/auth budget settings and delivery history
were preserved. Earlier attempts that did not prove deferral remain in the
private operational journal.

Fresh-link recovery revoked the previous conversation link and retained delivery
history. Replacement-link delivery and access are recorded in the final pilot
receipt. This is a controlled sample qualification, not an independent customer
acceptance, purchase/transfer execution, provider-outage experiment or formal CSO
clearance. The managed observations are bounded to 24 hours and require fresh
operator qualification before expiry; this is not unattended permanent hosting.

See [the live pilot receipt](receipts/managed-pilot-20261019.json). The historical
sections below describe earlier candidates and gates, not current pilot state.

19 October 2026. Source candidate on `codex/domain-sales`, based on `e829d5edc6f72e3e5c4f3d7fcd4853fda5beaa7f`. This ledger distinguishes implemented behavior from live qualification. The primary checkout and earlier owner-site research checkout remain preserved.

## Implemented behavior

- Sales listings, private drafts, four buyer paths, source or override pricing, exact expiring publication reviews, pause/unpublish and copying earlier public terms into a private draft. Public schemas exclude floors, costs, registrar credentials and private notes. Source changes suppress stale control without silently republishing.
- Inbox with pending/verified buyers, scanner-safe explicit confirmation, purpose-bound hashed capabilities, chronological message pagination, private notes, follow-up/status and seller-entered outcome reconciliation. Outcomes are observations, not proof of provider payment or transfer.
- Encrypted inquiry/message/outbox storage, payload-bound idempotency, bounded intake and recovery, suppression, retention, fenced delivery leases and one-use final send claims. An expired or ambiguous send remains unknown; it is never automatically replayed. A successful send claim is the authorization boundary; a later block cannot recall a message already being submitted to the provider.
- Optional selected shop with independent exact review, filters, pagination and public allowlist CSV. Generic CSV is not provider-specific import or marketplace synchronization. Existing v1/v2 public-site selections and snapshots remain independent; the new writer does not enable Owner Site V2.
- Fixed selection bulk jobs up to 500 names, explicit page versus all-matching selection, reviews in batches of 100, approval bound to the complete manifest and resumable per-item receipts. Completed items are not replayed. Larger selections must be split explicitly.
- Separate gateway, tenant and public-edge admissions. The public edge has its own key, no owner authority, no seller cookies, a narrow route allowlist and fresh host/account/epoch checks. Hostname setup requires allowlisting, fresh owner authentication, TXT proof, DNS snapshot, provider/TLS observations and an exact served publication revision. No automatic DNS writes.
- Version 9 portable host backup with strict relationships and root-key re-encryption. Restore is private and silent: public pages, host bindings, reviews, capabilities, jobs and outbox grants are revoked; restored buyers require fresh confirmation, and restored registrar cache is stale until a connected sync. Desktop consumers refuse a host Sales extension rather than dropping it.
- Full domains.domains hosted wordmark, Archivo and existing light/dark primitives; additive Sales navigation. No pricing, commissions, checkout custody or financial transaction introduced. Manual provider links are seller configured; no SellerHub API sync/write is enabled.

## Verification evidence

The local harness uses disposable `.example` inventory, synthetic registrar observations, simulated Turnstile verification and a mail-intent viewer. It denies registrar/provider requests and has no email transport. Command: `node scripts/sales-local-qualification.mjs --large`; open the URL printed by the script. The large fixture supplies more than one page of results.

Reviewable synthetic screenshots: [listings](receipts/local-listings.png) and [saved editor/preview](receipts/local-editor.png).

Actual local browser receipts cover private save, saved preview, exact single publication and public lander; all-matching selection and 105 completed bulk publication receipts; inquiry persistence, explicit confirmation, seller private note and reply, and a buyer capability view containing the reply while excluding the private note. Private fields survive validation failures. Layout metrics show no body overflow at 320, 390, 768 and 1280 CSS pixels; light and dark themes were exercised. These are synthetic local browser receipts, not SMTP, registrar or DNS qualification. A later native Chrome check exercised genuine 200% browser zoom, keyboard traversal through Sales navigation and editor controls, and keyboard activation of the saved preview. Zoom was restored to 100% and the test tab closed. Independent-user acceptance remains unperformed.

Regression coverage includes atomic publication CAS, stale terms, encrypted PII, token purpose and scanner behavior, tenant/edge isolation, lease replay/expiry/spam/delete, restored buyer reconfirmation, bounded backup restore, global listing filters, shop visibility, source-price changes, multi-batch approval, hostname ownership/epochs/TLS and sender quotas/unknown delivery. A specialist read-only security review found a cached delivery lease race; the final tenant send claim and regression tests fix it. Recheck reported no blocking findings in that fix. This is engineering review, not formal CSO or customer acceptance.

The exact engine manifest is `hosted/dombot-engine.lock.json`; source edits must repack and reinstall the archive before `engine:verify`. Latest code checks passed: typecheck, lint, engine verification, 1,247 tests (one skipped), security regressions, web/demo/site builds, and gateway/tenant/public-edge/self-hosted dry runs; PRs #51 and #52 have green required CI/CodeQL. See [machine-readable local receipt](receipts/local-verification.json). Build warnings about the existing large renderer chunk and runtime-served Archivo URL do not establish performance qualification.

## Live observations and remaining gates

- Cloudflare identity, canonical gateway settings and ten existing tenant service bindings were read successfully. `mail.domains.domains` is enabled. Existing auth email delivery does not qualify the separate sales sender, budgets or recipient path.
- Custom-hostname and fallback-origin reads on the confirmed domains.domains zone return 403 Authentication error. Entitlement, apex routing, fallback origin, pricing, TLS and actual activation are unqualified. A named owner-controlled apex/www fixture is still required. Do not invent one or change customer domains.
- Operator review and publication of the proposed buyer privacy/retention copy are required before external collection. `SALES_PRIVACY_REVIEWED` remains off externally. The encrypted 90-day suppression address needed for key rotation is explicitly documented in the proposed copy.
- PR #51 merged as `f13b8728b7c8535001c35527e84237418fd32f6f` with green CI/CodeQL. The gateway and existing disabled QA 4 tenant received a controlled release; additive Sales migrations were applied to the control DB and that QA database only. Keys, ten service bindings, private tenant ingress and existing schedules were preserved. The subsequent compatible rollout updated all ten tenant engines/schemas with Sales disabled, after protected backups and data/configuration checks. One minimal sender-qualification email reached the connected owner Gmail inbox with DKIM/SPF/DMARC passing. This does not qualify the inquiry/reply outbox journey. No provider/DNS write, payment or transfer occurred. No sales beta or live buyer journey is claimed. The self-hosted deploy workflow is a credential-unconfigured no-op; explicit provider/runtime receipts establish the controlled deployment.
- Spaceship API docs were inspected; live SellerHub eligibility and generated-link permissions are unqualified. Reviewed manual links are available. Actual handoff, reliable sales-mail receipt and recovery, and controlled apex/www activation remain required for beta acceptance.

See [operations runbook](operations.md), [buyer policy proposal](buyer-data-policy-proposed.md) and [delivery acceptance](03-delivery-and-verification.md). Do not mark beta complete until those external gates and exact-candidate live receipts are satisfied.

## Controlled pilot correction

The first deployed private-draft check found that Sales used only registrar cache names, omitting imported holdings from its picker and draft admission. Engine `.9` unions the existing imported-name namespace into private selection and search. It does not change the registrar-only control observer. A regression covers imported-only inventory, long-label and IDN drafts, search, and rejection of publication without a current registrar observation. The failed pilot receipt is retained; the QA owner backup was restored and workspace disabled before correcting source. The repaired controlled private-draft/preview, false-control denial, Unicode presentation, isolation and restore retry passed; QA was restored disabled. See [operational receipt](receipts/operational-20261019.json). The Cloudflare capability retry still returns HTTP 403, code 10000, for both custom-hostname and fallback-origin reads.

## Remaining activation boundary

The native Chrome dashboard confirmed that Cloudflare for SaaS on `domains.domains` presents **Enable Cloudflare for SaaS**, with 100 included hostnames. [Official enablement](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/enable/) requires payment setup for non-enterprise zones; [plans](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/) list $0.10 per additional hostname beyond the included allowance. No activation or billing acceptance is confirmed. The Mac became locked before a final payment/access review could be completed. Native Chrome already had an authenticated session; a separate in-app Google passkey attempt is no longer needed. The owner still needs to name the controlled apex/www fixture and review the buyer policy. No external buyer collection or live beta is claimed.

The fleet rollout preserved a first stale runtime response on tenant 5, stopped promotion, and reconciled the exact same deployed version to the expected engine hash without redeployment. Other verified checkpoints were not replayed. All ten tenants retain Sales editing, intake, mail and hostname flags off. The full protected operational/backups directory stays local; the public receipt contains no credentials, root keys, buyer data, recipient address or capability URL.
