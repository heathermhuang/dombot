# Public early-access launch

The hosted foundation is promoted in place: preserve the gateway control database,
all tenant databases, keys and workspace IDs. The `domains-staging` internal
resource names do not imply separate data after promotion. Keep new-customer
signup invite-only; this release does not add billing or unbounded provisioning.

- `PUBLIC_PORTFOLIO_PATH` is an explicitly configured `/w/<uuid>/p/<handle>`.
  `/domains` redirects only to that public route, preserving query parameters.
  It cannot route to a private API or another origin.
- The homepage links to the founder collection and an early-access inquiry email.
- `CANONICAL_ORIGIN` is set only after the public hostname and TLS are verified.
  Old hosts redirect GET/HEAD requests to the canonical origin. Other methods
  return 421 rather than replaying credentials or mutations across origins.
- Existing MCP grants are resource-bound. Clients must reconnect using their
  workspace's new-domain MCP URL after an origin change.

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
