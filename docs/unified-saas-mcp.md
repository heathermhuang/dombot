# Shared SaaS MCP endpoint

## Outcome and implementation plan

All SaaS customers connect to `https://domains.domains/mcp`, sign in through
the existing account flow, and approve access to their own portfolio. Desktop,
self-hosted, and existing `/w/<id>/mcp` connections remain supported.

1. Add gateway-owned OAuth discovery, client registration, PKCE authorization,
   consent, one-use codes, hashed access tokens, and revocation in the control DB.
2. Bind each grant to the signed-in user and immutable workspace. Offer only
   `portfolio:read` initially. Keep registrar credentials in the tenant.
3. Validate every incoming bearer token at the gateway. Route to its workspace
   with a request-bound, 30-second signed MCP delegation, with no owner authority.
   Recheck MCP enablement and the permitted tools inside the tenant engine.
4. Show the shared URL and both shared and legacy connections in MCP settings.
   Revoke shared connections at the gateway without exposing tokens to the UI.
5. Verify concurrent tenants, login continuation, consent CSRF/session binding,
   code replay, PKCE, resource binding, expiry, revocation, disabled/closed accounts,
   forged delegation, write denial, and unchanged legacy connections.
6. Run project checks and CI, merge, migrate the control DB, roll out the pinned
   engine through pilots, deploy the gateway, and verify the live connection flow.

## Protocol and security contract

The canonical OAuth resource is the public origin plus `/mcp`. The gateway is
the authorization server and resource boundary. External tokens are opaque and
stored only as SHA-256 hashes. They are never forwarded into tenant Workers.
The tenant accepts only an authenticated gateway delegation for its own immutable
workspace, limited to `/mcp` and `portfolio:read`; it cannot authorize browser APIs.
Every request checks account enablement, grant expiry and revocation. Existing
MCP policy restrictions and the zero spending budget still apply.

Authorization requires S256 PKCE, a registered redirect URI, explicit consent,
same-origin POST, and fresh account authentication. Consent is bound to the user
and browser session that viewed it. Codes expire after five minutes and can be
exchanged once. Access tokens expire after 30 days; this first release requires
reconnecting after expiry and does not advertise refresh tokens. Unused client
registrations and authorization requests expire and are pruned under rate limits.

Successful password recovery revokes all of that user's shared MCP grants and
deletes their pending authorizations, including issued codes, in the same D1
transaction as the password update and browser-session deletion. A concurrent
code exchange either commits first and its grant is revoked, or commits after
recovery and fails because its authorization no longer exists. Reconnect through
fresh sign-in and consent after recovery. Invalid, expired, disabled-account and
replayed recovery attempts do not revoke connections. Ordinary password changes
and browser logout retain the existing separate MCP revocation policy; revoke
connections in MCP settings. Workspace-specific legacy pairings are stored in
tenant databases and remain separately managed there.

The shared resource advertises only read access. `portfolio:read` retains the
existing engine definition, including sync and non-mutating registrar queries.
Mutation and purchase permissions require a separate future release.

## Migration and verification

The migration is additive. Existing tenant OAuth stores and private databases
are unchanged. Existing endpoints remain usable. The gateway updates hosted MCP
settings responses to advertise the shared URL and merges shared connections
with legacy paired clients. Revocation takes effect on the next gateway request.

Release evidence must identify the source commit, engine artifact, pilot and
fleet runtime versions, gateway deployment, and observed live OAuth/MCP results.
Do not infer runtime adoption from an upload or an outer Worker version header.
