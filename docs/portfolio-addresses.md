# Public portfolio addresses

The public identity is separate from the immutable account ID and the profile's
existing internal handle. Owners claim one unique address such as
`https://domains.domains/yourname` from Public profile. New managed profiles claim
the address while creating their private draft. Claiming never publishes a draft,
selects holdings, changes a domain's sale status, or changes existing publications.

Names use lowercase letters, numbers and single hyphens, up to 40 characters.
Application, company/support, commercial, authorization, staff and infrastructure
names are reserved, including `domains`, `about`, `support`, `pricing` and
`security`. The policy is maintained in `src/hosted/reserved-portfolio-handles.ts`;
a route-audit regression prevents literal gateway routes becoming claimable. Claims are atomic and immutable
in this release; closure, suspension and unpublishing do not release a name.
Existing `/w/<account-id>/p/<handle>` bookmarks remain functional.

Anonymous requests resolve the handle centrally, check account availability, and
use a signed request with no owner identity to read only the tenant's published
row. Private draft, inventory and credential stores are never initialized. Missing
or unpublished profiles return 404, invalid published data returns 503, and missing
collections return 404 without falling back to a larger catalogue. Responses are
uncached and retain the existing public renderer's security headers.

## Release

1. Apply additive control migration `0015_portfolio_addresses.sql`.
2. Deploy the gateway with both new flags off first, so its address-options
   endpoint is available before the new editor is served. Then deploy compatible
   tenant adapters and the pinned UI engine. Preserve live bindings, configuration,
   keys, public legacy hosts and DNS. Old editors and long links keep working
   throughout this sequence.
3. Enable `PUBLIC_SITE_ADDRESSES_ENABLED=true` only after the migration and all
   tenant readers are in place. Verify a controlled unpublished claim, publication,
   collection links, copy/open links, unpublish, and cross-account rejection.
4. `PUBLIC_SITE_SUBDOMAINS_ENABLED` remains off until wildcard DNS, certificate
   coverage and Worker routing for `*.domains.domains` are separately verified.
   When enabled, `yourname.domains.domains` redirects to the same short canonical
   path. Subdomain paths cannot expose account or API routes.

Rollback disables the gateway flag first and retains claims. Old addresses and
publications remain unchanged; do not drop the mapping table or recycle handles.

## Next: bring a domain

Existing custom-domain setup serves individual Sales listings. Portfolio hosting
needs its own binding target and published-only reader, DNS ownership verification,
TLS/provider readiness, detach and takeover protection, and an end-to-end controlled
hostname test. It must retain the customer's domain in the address bar. This change
creates the short address and public reader foundation; it does not advertise or
enable portfolio custom domains and does not change customer DNS.
