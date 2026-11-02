# Public domain listing URLs

Hosted listing links use `https://domains.domains/<canonical-domain>`, for
example `https://domains.domains/working.io`. The editor, live-listing actions,
shop entries, linked portfolio pages, previews, presence inspector and new
publication receipts all use the same helper. Domain case, IDNs and a trailing
dot normalize to one ASCII address. Inquiry forms submit to
`/<canonical-domain>/inquiries`, including after validation errors.

Existing `/w/<workspace-id>/d/<domain>` links permanently redirect with HTTP 308.
The redirect retains query parameters; old inquiry POSTs retain their method and
body. A legacy URL only redirects when its original account still has the unique
eligible publication. Private account/API paths and immutable account identities
are unchanged. Self-hosted installations keep `/d/<domain>`.

## Eligibility and isolation

The gateway resolves the domain against published projections in enabled,
admitted accounts, excluding closed accounts and known control losses. It uses a
narrow, signed, GET-only internal tenant reader. This reader needs no encryption
root, inventory hydration, registrar credentials or provider calls. Caller cookies,
authorization and spoofed gateway/forwarding headers are never passed through.
Rendering and inquiry processing retain anonymous Sales admission and existing
ownership, availability, revision, origin, challenge and intake checks.

No eligible publication returns 404. Multiple eligible publications return 409;
the gateway never chooses an account arbitrarily. An unavailable reader returns
503 rather than treating missing evidence as an absent listing. No persistent
listing or negative-result cache can outlive unpublish or control expiry.

The initial resolver bounds discovery to 64 admitted accounts and four concurrent
read requests, with five-second per-reader deadlines and an IP request allowance.
Above that fleet size it returns 503 before probing. Each candidate costs one
small published-only read, plus one request to render the selected page. This is
an explicit initial scale/availability limit: a durable publication directory is
needed before extending beyond this fleet size. One unavailable candidate also
holds resolution because its conflicting-publication status is unknown.

## Release sequence

No schema, DNS, credential, listing-content or publication change is required.
Deploy the compatible tenant wrapper's internal reader to all admitted runtimes
before switching gateway routing and sharing links. The reader is independent of
the engine, so it can be released with the previous pinned engine first. Then
release the gateway and the new engine/UI pair. Qualify the actual serving
coordinator versions, including dynamically provisioned tenants and templates.
Keep the gateway reader/routing compatible during any rollback of sharing UI.

Local tests cover clean GET/HEAD, canonical metadata and form actions, redirects,
query preservation, origin rejection and POST forwarding, unavailable/duplicate
publications, withdrawal/expiry/control loss, closed/disabled accounts, platform
dispatch, bounded capacity and internal-reader admission. These are source/local
checks, not evidence of deployment or real inquiry delivery.

Local verification on 2 November 2026: 230 test files passed (2,511 tests passed,
one skipped); typecheck, lint, engine integrity/boundary verification, four
security tests and four relay checks passed. Web, demo and site builds passed,
as did self-hosted, gateway, tenant, lander, provisioner and proxy-scheduler
bundle dry runs. The packaged engine/UI pair is `1.5.2-hosted.36`.

## Marketplace data on the lander

The lander renders the explicitly approved `PublishedSale` snapshot: public
asking price, public minimum offer, description, seller display name, inquiry
mode and selected validated provider destination. It supports Spaceship,
Afternic, Sedo, Atom and Efty destination links.

The core app's synced `MarketListing` records are not automatically incorporated.
Market-specific status, prices, discounts, installment terms, listing tiers and
traffic remain separate. Public prices currently come from the saved portfolio
asking price or an explicit override. Floor prices and private account data are
not part of the public projection. Connecting selected marketplace fields to
publication would need an explicit reviewable projection with source/freshness
handling; this URL change does not publish them.
