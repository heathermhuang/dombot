# Domain sales: design and implementation plan

18 October 2026 design baseline · See [implementation ledger](IMPLEMENTATION.md) for current source and release status

Baseline inspected: `e829d5edc6f72e3e5c4f3d7fcd4853fda5beaa7f`. Refresh the target branch before implementation and reconcile any intervening changes. This plan uses current local source inspection, the [competitor research](../domain-lander-product-research.md), and current Cloudflare documentation. It does not certify current production configuration, provider eligibility, customer acceptance, or a launch date.

## Product decision

Help domain investors manage their inventory and turn interest in a specific name into a qualified conversation or a transaction through their chosen provider. The first complete release includes seller settings, a domain-specific lander, inquiries, a reliable notification path, and at least one qualified way to serve a lander on a controlled domain. A path on our own website is useful for sharing and testing; it is not equivalent to activating the customer's domain.

Keep existing domain management, renewals, account access and selective publication. Add Sales as a focused workspace. The owner's optional branded shop supports discovery across selected names. A profile or project showcase remains available without becoming a prerequisite for selling.

## Documents

1. [Product and interface specification](01-product-and-interface.md): personas, navigation, layouts, buyer and seller journeys, state/copy specifications, responsive behavior and design acceptance.
2. [Architecture and contracts](02-architecture-and-contracts.md): source map, data ownership, schemas, APIs, concurrency, anonymous ingress, notifications, hostname routing and integrations.
3. [Delivery and verification](03-delivery-and-verification.md): dependency sequence, PR-sized implementation work, tests, migrations, rollout/rollback, measurements and unresolved external prerequisites.

The accompanying standalone prototype illustrates the proposed layouts and interactions using `.example` fixtures. It does not send email, publish anything, connect DNS, call a registrar, accept payment, or demonstrate backend security. Its source and verification notes are delivered separately from application source.

## Scope and defaults

| Decision | Default for the plan |
| --- | --- |
| Initial audience | Investors with multiple registrar accounts who want direct control while retaining existing marketplace choices |
| Buyer entry | A specific domain visited directly or a shared domain link |
| Seller entry | Existing portfolio; Sales → Listings is a filtered selling view, not another inventory database |
| Sale modes | Inquiry, Make Offer, Buy Now through a configured provider, or external marketplace destination |
| Private names | Private until explicitly selected; importing a name never publishes it |
| Prices | Existing private portfolio asking price is the default; explicit per-channel/publication overrides are visible, never silently synchronized |
| Payments | Provider-hosted checkout; no platform custody or native installment contracts |
| First API integration | Qualify Spaceship reads and generated checkout links after manual links/CSV are usable; API writes remain separately enabled |
| Buyer accounts | No account required to inquire; email verification establishes access to an inquiry, never seller-account access |
| Seller notifications | Existing verified account email by default; any alternate recipient must be verified |
| Shop | Selected, searchable inventory; optional branding, contact and collections |
| Deployment | Feature flags, controlled tenant, exact engine receipt, named DNS fixture, then opt-in cohorts |
| Pricing/business model | Preserve the current offer; this plan introduces no subscription, commission, paid commitment or sales guarantee |

## Completion of the planning task

Planning is complete when the three documents agree on routes, models, state transitions, work dependencies and verification, and a reviewable prototype demonstrates the critical layouts. Implementation completion requires the staged acceptance criteria in document 03. Open provider/DNS prerequisites are explicitly identified there and do not stop independent implementation of data, seller UI or canonical-link landers.

This plan supersedes the profile-first sequencing in the earlier owner-site planning documents. It preserves the useful work already done on private drafts, exact publication review and selected public projections.
