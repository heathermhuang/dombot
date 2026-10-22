# Public early-access launch

The hosted foundation is promoted in place: preserve the gateway control database,
all tenant databases, keys and workspace IDs. The `domains-staging` internal
resource names do not imply separate data after promotion. Public early access
uses verified email and prequalified capacity; it does not add billing or
unbounded provisioning. See [conference-operations.md](conference-operations.md).

- `/domains` redirects to the explicitly allowed `https://alternative.domains/`
  when `PUBLIC_PORTFOLIO_ORIGIN` selects it, otherwise to a validated
  `PUBLIC_PORTFOLIO_PATH` of `/w/<uuid>/p/<handle>`. It cannot select a private
  API or an arbitrary request-supplied origin.
- The homepage offers free account creation, a labelled upstream demo, support,
  and the founder collection.
- `CANONICAL_ORIGIN` is set only after the public hostname and TLS are verified.
  Old hosts redirect GET/HEAD requests to the canonical origin. Other methods
  return 421 rather than replaying credentials or mutations across origins.
- Existing MCP grants are resource-bound. The shared hosted endpoint is
  `https://domains.domains/mcp`; legacy workspace endpoints remain supported.
  Clients must reconnect after an origin change. See [unified-saas-mcp.md](unified-saas-mcp.md).

## DNS cutover sequence

1. Capture every record at the current DNS provider and check public DNSSEC DS.
2. Recreate mail, verification, FTP/SSH and web records in Cloudflare. Initially
   leave the web records DNS-only at the old origin so the old site continues
   serving during DNS activation and certificate issuance.
3. Update only the selected domain's registrar nameservers to Cloudflare's
   assigned pair. Read the registrar again to verify the result; never blindly
   repeat an uncertain write.
4. Wait for zone activation and valid TLS. Attach the public hostname(s) to the
   gateway, replacing only their web routing records. Preserve mail and other
   subdomains. Verify homepage, login, workspace APIs, MCP discovery and public
   collection before retiring the old gateway hostname.
5. Set the canonical origin, verify old-host redirects and new-host session
   behavior, and update private access records. Keep the old origin and DNS
   snapshot available for recovery while delegation caches expire.

Founder publication is explicit: include only the reviewed previously public
names that still match a fresh successful inventory, plus explicitly historical
names. Newly discovered private holdings and unmatched records remain unlisted.
Enable the founder MCP server and the selected automatic-sync interval through
the authenticated settings API; no registrar purchase or renewal is implied.

## Free conference offer

The managed early-access SaaS is free: no subscription fee and no credit card
required. Registrar registration, renewal, transfer and other provider charges are
separate and remain payable to the registrar. This is an early-access offer; do not
promise lifetime pricing or unlimited capacity.

The homepage offers verified-email account creation at `https://domains.domains/signup`.
Use `https://domains.domains/` in conference materials and verify the complete QR
journey before printing. Available capacity is a dated snapshot, never a promise
of unlimited or permanently reserved accounts.

The 17 October public-host release preserves the legacy Your.Link collection at
`https://alternative.domains/`, using only its thirteen already-public collection sections
and local copies of its public assets. Share, inquiry and canonical links are retained.
The wrapper sends non-portfolio paths to the existing `dombot` service so the established
self-hosted `/mcp`, API, assets and authentication routes retain their owning backend.
No DNS or mail record changes are needed for this route-based promotion.

The managed gateway's apex route serves `domains.domains`, with its canonical origin set
to `https://domains.domains` only after the portfolio clone passes live checks. `/domains`
then points to the preserved collection on alternative.domains. The existing explicitly
published workspace collection remains available at its immutable `/w/.../p/...` path.
The previous gateway hostname and www redirect GET/HEAD only; POST/other methods return
421 so credentials and mutations cannot be replayed across origins. Existing host-bound
browser cookies stay on their original host, and MCP clients must pair on the final origin.

The free-service signup flow claims an existing qualified reserve after email
verification and legal acceptance; it does not provision infrastructure on demand.
Account closure suspends access and records a retention deadline; final physical
erasure and off-device backup/key custody
remain explicit operating gates until separately qualified. The agent spending budget is
zero during this release. Never describe early access as unlimited or lifetime-free.

## Public-registration successor

The verified-email public-account flow is the active conference offer. It remains
gated by operator identity, published legal policies, delivered transactional
email and prequalified capacity. See
[public-registration.md](public-registration.md) for the exact settings and
verification procedure. If those gates are disabled, report that state explicitly
and use the bounded fallback request flow. Use account/portfolio in customer copy;
immutable internal tenant IDs do not change.
