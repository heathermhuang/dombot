# 101domain support

101domain is available in Settings → Registrars on desktop and web builds.
Enter a dedicated API key from My Account → Developer Tools – API & MCP.
Primary users must have 2FA or SSO enabled. The key is shown once, expires
after at most one year, and is stored using the host's existing encrypted
credential storage. Include `domains_read` and `dns_read` for portfolio reads,
`dns_write` for DNS/nameservers, and `domains_write` for permanent URL forwarding.
No finance/account/product permissions are needed.

The adapter lists every page (50 domains/page), reads detail, checks availability
and pricing, manages DNS on 101domain/SWA nameservers, and supports one permanent
apex forwarding rule. Existing masked forwarding is readable. API registration,
renewal, auto-renew changes, privacy/lock changes, transfers and EPP codes are
unavailable; UI, bulk and MCP dispatch reject the unavailable operations.
A nameserver change accepted for registry processing reports pending; the app
keeps the currently active nameservers until a later read confirms the change.
Privacy is not reported by this API; the normalized boolean default is not a
verified privacy state; the UI shows “Not reported” instead of an off toggle. Missing or premium renewal prices remain unavailable
rather than being inferred from generic TLD/search pricing.

The provider lives in registrar-client, pinned here until an upstream release
contains it; see [vendor provenance](../vendor/README.md). Account labels and IDs,
proxy routing, credentials and cached portfolios use the existing account model.

Verification must distinguish the offline suite/builds from live account sync.
Live read-only acceptance: compare the full inventory count and representative
status, expiration, auto-renew and nameserver values with the 101domain portal.
DNS and forwarding writes require an explicitly disposable domain and a scoped
key; do not infer live write acceptance from mocked tests.

Sources: [technical API](https://api.101domain.com/api/documentation),
[key setup](https://help.101domain.com/kb/how-to-get-api-keys),
[endpoint reference](https://help.101domain.com/kb/api-endpoints-reference).
