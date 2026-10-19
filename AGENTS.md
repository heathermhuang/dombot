# Project working notes

## Public brand and landing page

- The owner explicitly rejected the `d.d` monogram and its conference-logo variants. Never use that mark in shipped UI, previews, or new promotional assets. Historical files under `assets/brand/conference-2026` are not approval to reuse it.
- Use the full `domains.domains` text wordmark on the public website and account pages. Read `.impeccable.md` for the current design direction.
- Product illustrations must visibly say they use sample data. Never use private registrar holdings, account details or invented customer endorsements as marketing proof.
- Use “account” for sign-in and access, and “portfolio” for domain holdings. Keep internal immutable tenant identities unchanged. Public registration requires verified email, published Terms and Privacy with the confirmed operator identity, and prequalified capacity; registrar charges are separate. Do not advertise open registration while these gates are off.

- Use inquiry-focused copy throughout public and account UI: “Domain inquiries”, “Get in touch” and “Open to inquiries”. Do not use availability slogans. Keep internal schema identifiers stable. Public inquiry pages refer to the contact or domain owner.

## Legal operator

- The owner confirmed on 18 October 2026 that domains.domains is operated by **Magic Crystal Limited, Hong Kong**. Use that exact company name and jurisdiction in the Terms and Privacy Policy. Public privacy/support contact is domains@domains.domains. Use **domains.domains** in public product copy, shared footers, source offers and project documentation; reserve the company name for necessary legal identification in Terms and Privacy. Retain existing copyright and license notices.

## Open-source provenance

- Use the owner-approved public attribution exactly: “domains.domains is a hosted, multi-tenant version of aoxborrow/dombot.” Link aoxborrow/dombot to the upstream repository. Keep Aaron Oxborrow’s original-project credit separate in the Terms, source page and copyright/license notices. Use the upstream https://github.com/aoxborrow/dombot link for original DomBot, and https://github.com/heathermhuang/dombot for the complete hosted fork and SaaS layer.
- The SaaS layer is open source under AGPL-3.0-or-later; retain upstream copyright and third-party notices. Keep the public source offer at /source accessible without sign-in, and set SOURCE_COMMIT to the deployed Git revision for exact source links.

## Hosted authentication

- Run `npm ci --prefix hosted --ignore-scripts` and `node hosted/build-auth.mjs` after the normal root dependency install, before hosted typechecks/tests/bundles. Auth dependencies belong to `hosted/package.json` so they do not change the pinned tenant engine.
- The default account journey uses ten-minute single-use email links/codes and optional passkeys. Preserve explicit legal acceptance, qualified capacity, immutable identities, existing password access, single-use challenge transactions and five-minute fresh authentication for sensitive actions. Once a passkey exists, email/password sign-in must not bypass the passkey check. See `docs/passwordless-auth.md`.
- QQ/163/126 inbox delivery and mainland-China network access require actual controlled receipts; never infer them from Google mailbox delivery or removal of Google login dependencies.
