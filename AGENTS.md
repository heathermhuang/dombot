# Project working notes

## Public brand and landing page

- The owner explicitly rejected the `d.d` monogram and its conference-logo variants. Never use that mark in shipped UI, previews, or new promotional assets. Historical files under `assets/brand/conference-2026` are not approval to reuse it.
- Use the full `domains.domains` text wordmark on the public website and account pages. Read `.impeccable.md` for the current design direction.
- Lead customer-facing copy with domains.domains and product tasks. Keep upstream attribution in the shared footer, source and legal notices; do not repeat it in hero text, screenshot captions, demo buttons or onboarding instructions.
- Product previews may use owner-authorized generic domains from the public portfolio. Prefer strong dictionary words and descriptive names; avoid brand-like holdings and .example placeholders. Keep illustrative account details, renewal estimates and draft statuses labelled as sample data; do not invent asking prices or imply live publication. Never expose private registrar records or invented customer endorsements.
- Use “account” for sign-in and access, and “portfolio” for domain holdings. Keep internal immutable tenant identities unchanged. Public registration requires verified email, published Terms and Privacy with the confirmed operator identity, and prequalified capacity; registrar charges are separate. Do not advertise open registration while these gates are off.

- Use inquiry-focused copy throughout public and account UI: “Domain inquiries”, “Get in touch” and “Open to inquiries”. Do not use availability slogans. Keep internal schema identifiers stable. Public inquiry pages refer to the contact or domain owner.

## Legal operator

- The owner confirmed on 18 October 2026 that domains.domains is operated by **Magic Crystal Limited, Hong Kong**. Use that exact company name and jurisdiction in the Terms and Privacy Policy. Public privacy/support contact is domains@domains.domains. Use **domains.domains** in public product copy, shared footers, source offers and project documentation; reserve the company name for necessary legal identification in Terms and Privacy. Retain existing copyright and license notices.

## Open-source provenance

- Use the owner-approved public attribution exactly: “domains.domains is a hosted, multi-tenant version of aoxborrow/dombot.” Link aoxborrow/dombot to the upstream repository. Keep Aaron Oxborrow’s original-project credit separate in the Terms, source page and copyright/license notices. Use the upstream https://github.com/aoxborrow/dombot link for original DomBot, and https://github.com/heathermhuang/dombot for the complete hosted fork and SaaS layer.
- The SaaS layer is open source under AGPL-3.0-or-later; retain upstream copyright and third-party notices. Keep the public source offer at /source accessible without sign-in, and set SOURCE_COMMIT to the deployed Git revision for exact source links.

## Hosted authentication

- Run `npm ci --prefix hosted --ignore-scripts` and `node hosted/build-auth.mjs` after the normal root dependency install, before hosted typechecks/tests/bundles. Auth dependencies belong to `hosted/package.json` so they do not change the pinned tenant engine.
- The default account journey uses ten-minute single-use email links/codes and optional passkeys. Preserve explicit legal acceptance, qualified capacity, immutable identities, existing password access, single-use challenge transactions and five-minute fresh authentication for sensitive actions. New registrar connections use the active session without a second identity check; saved credentials and other sensitive actions retain fresh authentication. Once a passkey exists, email/password sign-in must not bypass the passkey check for those sensitive actions. See `docs/passwordless-auth.md`.
- QQ/163/126 inbox delivery and mainland-China network access require actual controlled receipts; never infer them from Google mailbox delivery or removal of Google login dependencies.

## Managed release information

- Settings → About and the header badge show the live hosted engine version and gateway source revision. Managed accounts use service update information; desktop and self-hosted users retain their existing release/update controls. Do not identify the hosted release using only the root package version.
- Credit the hosted service and SaaS layer to Heatherm Huang, linking https://github.com/heathermhuang and https://x.com/heathermhuang. Keep this contribution credit separate from Aaron Oxborrow's original DomBot credit and retain the source/license notices.

## Public portfolio addresses

- Public handles are globally unique identities in `portfolio_addresses`, separate from immutable account IDs and private draft handles. Claiming an address never publishes content. Keep claims after unpublish, closure and suspension; do not recycle names.
- `PUBLIC_SITE_ADDRESSES_ENABLED` requires control migration 0015 and compatible tenant public readers before activation. Preserve existing long public links. Subdomain routing and portfolio custom domains have separate DNS/TLS verification requirements; do not infer support from Sales listing custom hosts. See `docs/portfolio-addresses.md`.
