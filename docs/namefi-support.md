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
DNS records, auto-renew changes and asynchronous registration orders. Missing EPP lifecycle, creation date, privacy
and transfer-lock observations remain unknown. Namefi has no bundled rate table;
renewal estimates use actual per-domain quotes where the API supplies an annual
price. Multi-year totals are never treated as one-year rates.

Manual renewal remains in Namefi's checkout. Registration uses saved Namefi profile contacts; an accepted order stays pending until confirmed. Registration has offline coverage only in this hosted candidate and is protected by the existing paid-operation scope and approval boundary. Transfer, contacts,
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

## Upstream SDK synchronization, 10 November 2026

SDK `1.2.1-hosted.1` rebases the retained hosted transport/date safeguards onto
upstream registrar-client `1.2.1`. It replaces the former custom Namefi source.
Upstream SDK PR #106 and app PR #268 are merged; the app's SDK publication gate
is satisfied. The complete upstream app release is `v2.2.1`.

Upstream #110 deliberately removes inventory reads before DNS and auto-renew.
Public DNS reads now make one request and may return records for an unowned name;
owned-detail lookup still checks inventory. Namefi enforces ownership on batch
DNS writes. Hosted account admission, tenant selection, operation scopes and
fresh authentication remain enforced by the application, independently of the
public provider read. An owned empty zone still returns `[]`, cancellation
reaches the direct request, and redirects remain refused without forwarding keys.

DNS edits reconcile by record ID before additions and stale deletion; unchanged
and managed/SOA/NS records remain protected. A failed or unconfirmed batch stops
later writes. None of these offline checks performs a real registrar mutation.

Upstream's maintainer reports live DNS and auto-renew checks on a throwaway
domain; that evidence does not qualify our hosted deployment or registration.
Sources: [SDK #106](https://github.com/aoxborrow/registrar-client/pull/106),
[DNS optimization #110](https://github.com/aoxborrow/registrar-client/pull/110),
[app #268](https://github.com/aoxborrow/dombot/pull/268).
