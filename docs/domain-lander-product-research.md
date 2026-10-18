# Domain landers: offers, seller needs, and product direction

Researched 18 October 2026. Public official product pages, release notes, terms, API documentation, and selected firsthand NamePros discussions. This is desk research, not customer interviews, transaction testing, or proof of conversion uplift. Prices describe the cited public pages on this date; transaction quotes, eligibility, taxes, payment methods, and account terms still matter.

## Recommendation

Make domains.domains useful to a seller from inventory through inquiry and sale. Prioritize portfolio operations, a working sales path for each selected domain, lead handling, and a choice of transaction providers. A searchable branded shop supports that workflow. An owner's biography and project showcase should be optional.

This revises the profile-first direction in `owner-site-plan.md` and `owner-site-visual-research.md`. Those documents and the implemented publication controls remain implementation history; they do not establish that a profile-first product meets domainer demand. In particular, postponing per-domain landers and lead capture removes much of the commercial job this research identifies.

Three different services must be distinguished:

1. **Lander:** converts someone who visits a particular domain into a purchase or inquiry.
2. **Distribution:** brings potential buyers through marketplaces, registrar search, advertising, or other channels.
3. **Transaction:** collects payment, coordinates domain delivery, handles installments where offered, and pays the seller.

A platform may bundle all three. Hosting a lander does not itself create demand or marketplace distribution. A checkout link does not automatically confer a marketplace's exposure.

## What the services offer

### Spaceship SellerHub

Offers fixed prices, offers, direct owner contact, buyer messaging, notifications, lease-to-own, bulk import and edits, traffic statistics, seller portfolios, checkout links, and transaction handling. Recent updates add offer read receipts, CSV exports across operational tabs, purchase-source visibility, and optional paid offer deposits. These are practical selling and management tools around the lander. Sources: [SellerHub](https://www.spaceship.com/sellerhub/), [release notes](https://www.spaceship.com/blog/sellerhub-updates/).

Its public API documents listing reads/writes, verification records, checkout-link creation, and SafePay transaction reads. That makes an integration plausible; this research did not qualify API completeness, webhooks, or production behavior. [API documentation](https://docs.spaceship.dev/).

The current fee distinction is material: standard sales 10%; checkout links 5%; SafePay 3% for wire/BTCPay and 5% for other supported methods. Fees can be split under documented conditions. These are different transaction routes. [SafePay pricing and process](https://www.spaceship.com/sellerhub/safepay/). The 2025 introduction still quotes 5% generally, but the February 2026 release note explicitly records the increase to 10%; use current pricing rather than that introduction.

### Atom

Offers landers, payment plans, support, self-brokerage, branded marketplaces, discovery, and marketing with different listing tiers. Standard/WLM commission is 7.5%; Plus 15%; Premium generally 15–30% by sale value, with legacy exceptions noted in its schedule. Marketing exposure differs by tier. [Commission schedule](https://www.atom.com/help/article/atom-com-marketplace-commission-structure).

The WLM includes the seller's URL, logo, messaging, search, recommendations, and support, with no setup/monthly fee advertised. It is a full shopping and sales service, beyond an owner profile. [WLM product](https://www.atom.com/white-label-marketplace). Terms describe a credit of 20% of Atom's commission for eligible seller-owned Premium sales through the seller's WLM; that is not a 20 percentage point reduction. [WLM terms](https://www.atom.com/help/article/white-label-marketplace-terms-conditions).

Standard and Plus have no exclusivity requirement. Premium's partial-exclusivity policy imposes external-platform, pricing, listing-mode, eligibility, and sale-reporting conditions. External negotiated sales can still incur Atom commission. [Premium policy](https://www.atom.com/partial-exclusivity-option). Consequently, a universal cross-marketplace price rule would be wrong.

AtomPay separately handles seller-sourced transactions and can be linked from another site. Its page distinguishes transaction, card, and installment-management charges and explicitly says it is an escrow alternative, not a licensed escrow provider. Its public pages conflict on current fees and promotions; obtain a transaction-specific quote rather than treating “starting at 2%” as a universal rate. [AtomPay](https://www.atom.com/pay).

### Afternic / GoDaddy

Offers Request Price, Buy Now, lease-to-own, and advertising/parking landers. Request Price connects to brokerage; Buy Now uses GoDaddy checkout. [Lander choices](https://www.afternic.com/sales-landers). Registrar distribution and eligible Fast Transfer are separate benefits. Fast Transfer requires supported domains, registrar, price, age, expiry and lock conditions plus opt-in; every listing is not automatically eligible. [Fast Transfer](https://www.afternic.com/fast-transfer).

Public BIN commission is 15% Basic / 20% Boost when using qualifying GoDaddy Aftermarket nameservers, versus 25% / 30% otherwise, with a $15 minimum. Lease-to-own has its own adjustments. [Current seller pricing](https://www.afternic.com/sell-domains). Separately, Custom Checkout Link advertises 5% for externally negotiated BIN sales, minimum $15; do not confuse this with distribution commission. [Custom Checkout Link](https://blog.afternic.com/custom-checkout-link/).

### Efty Investor + Efty Pay

Combines landers, a branded Domain Shop, portfolio management, integrations, financial insights, and buyer data. [Investor features](https://efty.com/products/efty_investor/). Its posted monthly plans start at $22 for 50 domains, $34 for 500, and $89 for 5,000; higher tiers add features such as white label and Stripe integration. [Plan table](https://efty.com/pricing/).

Efty Pay fees are separate: 5% when using its nameservers, 12.5% otherwise, with imported leads at 5% regardless of nameservers. [Fee rules](https://support.efty.com/article/25-what-is-the-commission-fee-you-charge-for-domain-sales). Lead Score is a vendor-provided prioritization signal, not proof that a buyer will pay. [Lead Score release](https://efty.com/blog/post/7616/introducing-smart-tools-and-lead-score-for-efty-investor/).

The April 2026 release says LTO expanded to for-sale landers and Domain Shop, adding percentage-based portfolio down payments while preserving fixed domain-specific settings. Prefer that newer release over the help article still claiming those channels are unsupported. This was not tested in an account. [Full rollout](https://efty.com/blog/post/7644/lease-to-own-leveled-up-full-platform-rollout-smarter-terms/), [conflicting help article](https://support.efty.com/article/193-what-is-lease-to-own-on-efty-pay).

### Sedo

Offers fixed-price and offer sales, auctions, landers, transfer support, and SedoMLS distribution. Lander options emphasize a clear purchase path, payment/trust information, responsive layout and visitor language. [Lander description](https://sedo.com/us/about-us/news-press/newsroom/easy-to-setup-domain-sale-template-brings-attention-to-your-domains/).

Its price list distinguishes 10% for qualifying parked BIN/Buy Now or Best Offer sales directly through Sedo; 15% for other direct marketplace sales; 20% for SedoMLS-origin sales. TLD, minimum-fee, tax, and external-transfer conditions apply. A seller needs channel-aware net proceeds, not one blanket “Sedo fee.” [Price list](https://sedo.com/us/what-we-offer/price-list/).

### NamePros Landers

Provides free landers with 0% NamePros commission, direct inquiries, optional price display and qualification, minimum offers, email verification, spam controls, analytics integrations, bulk settings/import/export, downloadable inquiries and payment-provider links. The selected payment/transaction provider can still charge. [Official feature guide](https://www.namepros.com/articles/free-landing-pages-by-namepros-parking.1168019/).

Its portfolio website adds public search/filtering, selected visibility, and a public CSV reflecting the inventory and prices the seller chose to show. A shop is already available without a monthly lander subscription. [Portfolio guide](https://www.namepros.com/articles/guide-to-portfolio-websites-in-namepros-parking.1027792/). This establishes a strong free-feature baseline; attractive templates alone are weak differentiation.

### Aftermarket.com / former Domain.io address

Opening domain.io now redirects to Aftermarket.com. Its support material describes portfolio and lander tools, external price monitoring, configurable market price adjustments, verification DNS, financial tracking, and custom purchase destinations. It explicitly describes CSV export/upload rather than automatic marketplace synchronization. [Support FAQ](https://support.aftermarket.com/en/articles/10011625-faq).

The newer sales page promotes bulk operations and 0% lander commission, but its own FAQ also mentions a small lander-sale commission. Treat exact transaction pricing as unresolved; do not infer that every checkout/escrow service is free. [Sales page](https://aftermarket.com/sell-domains). Its useful product lesson is detecting inventory and price inconsistencies across channels.

## What domainers need: evidence and inference

These needs recur across documented capabilities and seller reports. Their priority and willingness to pay still require testing with actual users.

| Job | Useful product behavior | Basis |
| --- | --- | --- |
| Make a name purchasable | Domain-specific page with clear status, price/currency or offer/inquiry path, and working checkout/contact | Repeated lander capabilities across the services above |
| Negotiate deliberately | Separate public BIN, minimum acceptable offer, private floor and provider-specific terms | Multiple sale modes; Atom external-pricing conditions; Spaceship offer workflows |
| Follow up without losing context | Domain-linked inquiry inbox, notifications, conversation history, status, reminders and export | SellerHub messaging/export; NamePros direct inquiries; seller reports below |
| Spend less time on junk | Rate limits, bot filtering, email verification, minimum offers and optional qualification | NamePros controls; Efty scoring; Afternic qualification experiments |
| Get paid and deliver safely | Chosen transaction provider, explicit fees, clear transfer/payout state and installments only when actually supported | SafePay, AtomPay, Efty Pay and marketplace transfer services |
| Operate hundreds/thousands of names | Bulk import/edit, price and listing checks, expiration/renewal costs, audit history and recovery | SellerHub, Efty, Aftermarket; operational complaints below |
| Preserve options | Per-domain routing, portable data, private holdings, selected public inventory, and explicit provider constraints | Multiple providers and listing policies; NamePros public selection/export |
| Know what works | Visits distinguished from humans, verified leads, offers, paid sales, net proceeds and channel attribution | SellerHub source visibility; disputed lead counts; fee differences |

Firsthand reports add several cautions:

- A large seller reported appreciating direct lead handling and pricing control after switching landers, but also reported lower sales and advised smaller portfolios to retain marketplace exposure. His conclusion that fewer leads proved bots was not established by controlled data. Treat this as a concrete control-versus-reach tradeoff, not evidence that any lander wins. [March 2026 experience](https://www.namepros.com/threads/the-afternic-efty-and-namepros-landers-experience.1382376/).
- SellerHub users requested price/string filters and bulk editing and described confusing settlement records. These are historical pain signals, not assertions that the issues remain unfixed. [Discussion](https://www.namepros.com/threads/spaceship-com-marketplace-thread.1356304/page-23).
- An Afternic user reported a dashboard saying names were listed while public prices/availability disagreed. Another discussion asked for bulk lander health checks. The lesson is to verify the buyer-facing page, not merely trust an internal status. [Listing report](https://www.namepros.com/threads/afternic-official-thread.1295231/page-355), [health-check request](https://www.namepros.com/threads/afternic-official-thread.1295231/page-338).
- Afternic says its experiments found that qualification before submission reduced genuine inquiries as well as confused ones. This is vendor evidence without published experiment data, but it argues for measuring completed sales before making more fields or deposits mandatory. [Experiment account](https://blog.afternic.com/balancing-lead-quality-and-quantity/).

There is no single seller persona. A hands-off owner may value brokerage and reach above low commission. An active investor may prioritize direct negotiation and transaction-provider choice. A large operator needs bulk consistency and renewal economics. Someone holding a domain for development needs privacy and a non-sale state. Defaults should support these differences.

## Proposed scope for domains.domains

This is a recommendation, not implemented functionality or a validated market gap. Efty, NamePros and Aftermarket already overlap with it. Our existing registrar/inventory workflows may provide a useful starting point, but we have not demonstrated a defensible advantage.

**First coherent seller workflow:** select a domain → choose sale intent and terms → choose direct inquiry or a supported marketplace/checkout destination → preview the buyer experience → publish → verify the actual page → receive and follow up on an inquiry → record the transaction and net outcome.

Priorities:

1. **Private inventory and sale settings.** Keep private costs/notes/floors separate from published fields. Add per-domain sale intent and bulk actions with reviewable changes. Distinguish configured, published, verified, and externally observed states.
2. **Per-domain buyer experience.** Clear domain name, for-sale status, price or offer path, recognizable transaction provider, concise delivery explanation, and responsive accessible controls. Support external destinations for owners who prefer an existing platform. Respect existing DNS/email when planning activation.
3. **Lead handling.** Persistent inquiries associated with the domain, verified contact where appropriate, spam controls, notification delivery, status/history and export. A decorative contact button without a reliable inquiry path is insufficient.
4. **Transaction integrations.** Start with explicit checkout links and supported imports/exports; qualify API integrations separately. Show expected provider fees and net proceeds with their conditions. Never label manual CSV exchange as live sync or present an unverified destination as working checkout.
5. **Optional branded shop.** Search/filter selected names by budget, extension and category, with consistent pricing and inquiry paths. Owner identity can build trust; projects and biography remain optional sections.
6. **Operational feedback.** Flag failed landers, stale prices, unverified listings, sold names still published, renewal exposure and missed notifications. Use bounded checks, provider APIs and checkpoints where available.

Reuse existing draft/publish separation and explicit visibility selection. Keep registrar/account management and buyer-facing pages distinct. Published content must never include private acquisition costs, reserve prices or account credentials.

Do not commit to operating escrow, underwriting installments, creating a global buyer marketplace, or promising sales uplift at this stage. Transaction custody and buyer distribution are substantial services with their own qualification needs. Integrating them is a more credible first step than claiming to replicate them.

## How to validate the direction

Use the same complete workflow with a hands-off seller, an active negotiator and a large-portfolio operator. Observe import effort, configuration mistakes, time to publish a working lander, inquiry delivery, follow-up and transaction handoff. Check whether users prefer our lander, routing to their existing provider, or keeping a name private.

Evaluate qualified inquiries, accepted offers, paid transactions, net proceeds and seller time. Keep visits and raw inquiries as intermediate measures. A short pilot cannot establish sell-through for rarely selling inventory; there is no conversion or willingness-to-pay claim from this research.
