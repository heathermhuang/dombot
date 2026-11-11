# Existing hosting-provider reuse

The Sales lander path now prefers an explicitly configured Sales provider pair.
When neither Sales credential field is supplied, it can reuse the complete,
existing portfolio-hosting provider in the same gateway. The portfolio edge must
be the existing `domains-sales-lander`; an explicit conflicting Sales target or
partial Sales credential pair fails closed. Credentials and zones from different
configurations are never mixed.

This reuses only the service-owned certificate/route provider. It does not share
customer DNS credentials, grant DNS authority, change delegation, enable billing,
create hostnames, or enable automatic connection flags. Tenant DNS still needs
its exact connected account and currently authoritative zone.

`LanderService.inspectHosting()` is a named, operator service-binding RPC. It has
no HTTP handler or mutation methods and accepts no caller-selected paths, zones
or credentials. It makes two bounded GET requests to the configured provider:
custom-hostname capacity and fallback origin. Only sanitized configuration,
status and count fields return; no credential or customer hostname list returns.
The portable HTTP application remains in `gateway.ts`; the Cloudflare-only RPC
export is in `gateway-worker.ts`, which is the Wrangler/staging entrypoint.

Tests cover complete existing-provider reuse, explicit precedence, partial and
mismatched settings, unchanged manual target planning, fixed read-only requests,
secret redaction, access-failure versus empty-capacity semantics, and native RPC
visibility. Provider read reachability is not live root/www DNS qualification.

015.io was selected by the owner as the unused fixture. The current registrar is
Dynadot and its delegation is Park.io. There is no connected Cloudflare DNS
account and no 015.io zone in the operator's existing Cloudflare account. The
implemented Cloudflare DNS path must not be used to claim authority over that
Park.io zone. A one-domain DNS-provider migration requires the owner's separate
choice; no such delegation change has been made by this correction.
