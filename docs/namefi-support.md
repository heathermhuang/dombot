# Namefi support

Namefi is available in Settings → Registrars with a Plain API Key from
https://namefi.io/api-keys. The key belongs to the signed-in Namefi user and the
personal portfolio includes both email-held and NFT-held domains. Organization
portfolios are not selected by this integration.

Namefi keys are not read-only: they can spend NFSC and charge a saved card.
Store the key only in the normal encrypted registrar credential store. The key
is never part of the source, engine artifact, public report or changelog.

The integration supports connection testing, complete personal inventory,
expiration dates, nameserver reads, availability, domain-specific annual prices,
DNS records and auto-renew changes. Missing EPP lifecycle, creation date, privacy
and transfer-lock observations remain unknown. Namefi has no bundled rate table;
renewal estimates use actual per-domain quotes where the API supplies an annual
price. Multi-year totals are never treated as one-year rates.

Registration and manual renewal remain in Namefi's checkout. Transfer, contacts,
WHOIS privacy, transfer-lock and nameserver-delegation changes are unsupported in
this adapter. DNS replacement preserves unchanged records and stops before
removing managed, SOA or NS records. Writes with unknown outcomes are not retried;
partial DNS changes require a fresh read before retrying.

The provider uses the public v-next REST API, documented at
https://api.namefi.io/v-next/openapi/doc.json. The pinned SDK source patch,
archive integrity and official logo provenance are recorded under `vendor/`.
Automated contract tests run against the installed SDK artifact rather than a
separate mock implementation. Live acceptance uses read-only requests; it does
not purchase domains, change DNS or modify auto-renew.

Source and CI qualification do not establish deployment. Runtime and owner
connection evidence are recorded separately after release.
