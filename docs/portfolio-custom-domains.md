# Portfolio custom domains

A published portfolio can use one customer-owned domain or subdomain. The short
portfolio address and old long URLs remain usable; a healthy custom connection
becomes the share address and the short URL redirects there. Saving a domain plan
never publishes content, reserves a hostname, or creates a certificate.

## Connect a domain

1. Claim a short public address and publish the profile you want people to see.
2. In **Your site → Use your own domain**, enter a domain without a scheme, port
   or path. Prefer an unused subdomain when another website already exists.
3. Add the ownership TXT record shown in the setup. Keep existing MX, TXT and
   other records. Select **Check connection**.
4. Add the provider's separate ownership/certificate TXT records. Continue
   checking until HTTPS is ready. Certificate issuance can take time.
5. Add the routing CNAME to the displayed target. An apex requires DNS-provider
   CNAME flattening or ALIAS support. Do not change an existing site's routing
   before its replacement HTTPS connection is ready.
6. Use **Open your domain to finish connecting**. A successful HTTPS GET of the
   current published page activates the connection and redirects to the clean URL.
   The verification URL is temporary; HEAD requests do not activate it.

Only published profile/collection pages are available on this hostname. Account
pages, credentials, portfolio drafts, registrar inventory, MCP and mutations are
not exposed. Unpublishing makes both custom and short portfolio pages unavailable.

**Remove connection** revokes routing before provider cleanup. The content and
short handle remain. Customers restore DNS themselves. Reconnecting requires a
new plan and new ownership proof. If a provider write has an unknown outcome,
setup stops for service-side reconciliation rather than repeating the write.

## Architecture and limits

Migration `0016_portfolio_domains.sql` adds private plans, versioned hostname
bindings and a shared hostname reservation table. Existing live Sales hostnames
are backfilled. Sales and portfolio connections cannot simultaneously own a host;
release checks the exact owner generation. Detached reservations are tombstones
that permit a future freshly verified domain owner without reusing an old plan.
Short public handles remain permanently reserved under the separate address policy.

The public-only `domains-sales-lander` edge forwards only GET/HEAD `/` and
`/c/<slug>` to `PORTFOLIO_GATEWAY`, with fresh headers and no caller identity.
The gateway checks the central binding, global reservation, account eligibility,
rollout scope and finite lease, then signs an owner-null request to the tenant's
published projection reader. Gateway keys are never installed in the public edge.
No backend request is sent to a customer-controlled origin.

One live/pending hostname per portfolio and twenty held portfolio hostnames per
service are supported initially. The Cloudflare plan's provider count is checked
before certificate creation. This is a service limit, not a billing integration.
The existing deterministic gateway cron refreshes at most twenty due connections
with concurrency four, renewing a one-hour positive lease after DNS/provider/route
checks. Unknown observations retain the last good lease until expiry. A definitive
lost proof, missing route/certificate or revocation blocks traffic. Paused accounts
and rollout scopes are not reactivated by maintenance. Closed accounts are detached.

## Operator configuration

Keep the feature off until the following are qualified:

- Apply migration 0016 after a fresh control backup. Audit the expanded reserved
  handle list against existing claims; stop for explicit resolution on conflict.
- Enable Cloudflare for SaaS on the domains.domains zone. Standard features suffice;
  no Enterprise custom metadata, apex proxying or paid plan upgrade is required.
- Create a dedicated zone-scoped token with SSL and Certificates Edit and Workers
  Routes Edit for domains.domains only. Install it as `PORTFOLIO_CF_API_TOKEN` on
  the gateway; never put it in a plaintext var, source, browser URL, log or receipt.
- Set `PORTFOLIO_CF_ZONE_ID`, `PORTFOLIO_CNAME_TARGET`, and
  `PORTFOLIO_EDGE_WORKER=domains-sales-lander` on the gateway. Qualify an unused
  originless, proxied fallback DNS record (AAAA `100::`) and active SaaS fallback.
- Bind `PORTFOLIO_GATEWAY` to domains-staging on the public edge. Set
  `PORTFOLIO_CUSTOM_HOSTS_ENABLED=true` on both Workers only after source/CI and
  controlled DNS/TLS routing proof. Start `PORTFOLIO_HOST_WORKSPACES` with the
  controlled workspace UUID array; `["*"]` enables all otherwise eligible accounts.
- Exact `customer-hostname/*` routes go to the public edge. Preserve the existing
  root/www routes. Never replace them with a zone-wide `*/*` route.

A release must preserve live bindings/assets/flags, disabled accounts, credentials,
passkeys, the shared proxy scheduler and the founder's alternate Dynadot proxy
bindings. Take a fresh production baseline after any intervening release. Deploy
the compatible tenant public reader/UI before enabling the feature. Distinguish
unit/CI success from an actual external DNS/TLS receipt.

## Recovery and rollback

The feature flag and per-workspace scope stop portfolio custom-host serving and
restore short share URLs. Leave both control tables and reserved names in place.
Do not roll the Sales namespace guard back while portfolio claims exist. A token
outage prevents setup and lease renewal, but cannot grant extra owner authority.
Disconnect remains available for existing rows even when new setup is paused.

For `needs-review` or detachment with an operation marker, inspect the exact
hostname, epoch, operation, provider ID and route from an operator context. Confirm
whether the external write happened; do not blindly replay it or adopt an
unattributed provider resource. Reconcile only the observed generation. Record the
result before clearing a marker. Cleanup validates the exact route pattern/Worker
and certificate hostname, and refuses deletion after losing the global reservation.
A not-found certificate/route is already cleaned up. Retain unknown receipts.

## Verification

`portfolio-domains.test.ts` exercises real D1/public rendering with a deterministic
provider: unpublished/unproven gates, races, uncertain creates, persistence failures,
fresh proof after detach, Sales collisions, lost control, public-only headers,
HTTPS visit activation, collections, short redirects and cleanup. Isolation tests
exercise browser ownership, origin and fresh-auth gates in a real Worker runtime.
Run the full repository checks and five Worker dry runs before release.
