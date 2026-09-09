# Hosted staging foundation

The hosted edition adds an invite-only account gateway in front of independently
installed DomBot workspaces. It reuses the existing portfolio UI, registrar
adapters, encrypted storage, publishing workflow, and MCP tools. This milestone
is not public signup, billing, a general-purpose fleet provisioner, or a registrar
security qualification.

## Isolation boundary

Each workspace is a separate Worker deployment with its own D1 database,
`DOMBOT_SECRET`, `DOMBOT_GATEWAY_SECRET`, and immutable workspace ID. Tenant
Workers have `workers_dev: false`, `preview_urls: false`, and no public routes.
The gateway reaches them through explicit service bindings.

The gateway stores customer identities, password hashes, invitations and hashed
sessions in a separate control database. It never accepts a caller-selected
binding name, database ID or encryption key. An authenticated session resolves
to one enabled workspace. Every private request is checked against that mapping
before dispatch. A user can view another workspace's deliberately public
collection or OAuth discovery, but receives no owner authority there.

Gateway-to-tenant requests carry a short-lived HMAC-signed proof, bound to the
workspace audience, request method, path/query and body digest. Incoming proof
headers and browser cookies are stripped. Each tenant verifies the proof before
running DomBot, and private APIs additionally require an authenticated owner in
the proof. Separate runtimes preserve upstream's single-instance global store;
this design does not switch tenant databases inside one shared DomBot runtime.

This is operator-managed encryption, not zero knowledge. The operator controls
deployment and keys. The application boundary and tests improve inspectability;
they are not a claim of an independent security audit.

## Accounts and provisioning

The staging pool contains three independently provisioned slots: founder and two
pilot workspaces. The operator creates an expiring invitation tied to an email
and reserved workspace. Signup consumes the invitation and creates the account
atomically; unique database constraints prevent duplicate claims. There is no
open signup without an invitation, automated email delivery or social login.
An invitation is an operator-issued credential, not independent email verification.

Passwords use scrypt with per-password random salts and a separate server pepper.
Sessions are opaque random tokens stored by hash, last seven days, and use a
Secure, HttpOnly, SameSite=Lax, host-only cookie on HTTPS. Logout revokes the
session in the control database. Password changes revoke all browser sessions;
paired MCP clients must be revoked separately. Login and OAuth issuance have
persisted rate limits. Recovery is operator-assisted in this pilot.

URLs:

- `/` — staging product homepage.
- `/login`, `/join?code=...`, `/account` — customer authentication and security.
- `/app` — redirects the signed-in owner to their workspace.
- `/w/<workspace-id>/` — the existing application and private APIs.
- `/w/<workspace-id>/mcp` — the workspace's MCP endpoint.
- `/w/<workspace-id>/p/<handle>` — an explicitly published collection.

The current production roots and the owner's existing public portfolio URL are
not changed by this deployment.

## MCP grants

Each workspace keeps its own OAuth clients, authorization codes and tokens.
Discovery advertises its workspace-specific issuer and resource. PKCE and owner
approval remain required. Hosted grants default to `portfolio:read`; unsupported
scopes or a mismatched resource are rejected.

- `portfolio:read`: portfolio reads, sync and non-mutating registrar queries.
- `domains:write`: domain settings and transfer authorization codes.
- `domains:spend`: registration, transfer and renewal operations.

Approval shows the requested permissions and target workspace. The endpoint
requires a token for its exact resource, and registers only tools allowed by that
request's scopes. A token from another workspace fails even if it has broader
permissions. Revocation takes effect on the next request. Legacy desktop and
single-owner MCP behavior remains unchanged unless hosted enforcement is enabled.
These scopes are workspace-wide; per-account grants, monetary budgets, and
per-operation approvals are later work. There is no refresh-token grant in this
initial implementation; reconnect when the access token expires.

## Deployment

Public templates are `hosted/wrangler.gateway.jsonc` and
`hosted/wrangler.tenant.jsonc`. The scripts operate only on new `domains-staging*`
resources and reject production routes. Prepare a private
`.wrangler/hosted/resources.json` with the account ID, HTTPS staging origin and
four new database IDs (control first, then three tenants). Then:

```sh
DOMBOT_OWNER_EMAIL=you@example.com node scripts/prepare-hosted-staging.mjs
npm run web:build
node scripts/deploy-hosted-staging.mjs
```

The preparation script preserves existing keys on reruns. It writes private
configs, secrets and hashed invitation seed SQL under the ignored `.wrangler`
directory; back up those files securely. It does not send invitations. The deploy
script applies migrations, deploys tenants with public ingress disabled, installs
secrets, then deploys the gateway and seeds invitations. It does not delete
resources or modify an existing self-hosted deployment.

Enable the existing repository CI workflow on pushes to the foundation branch.
CI checks all three TypeScript configurations, lint, the complete test suite, the
web renderer and dry-run bundles for the original Worker, gateway and tenant.

## Founder migration and recovery

Copy into a verified empty founder workspace, preserving the live source. Exclude
browser sessions, MCP grants and queued bulk operations. Disable automatic sync
and MCP in the copy, and keep publication private until separately selected.
Compare the complete sorted account/domain identity set, account count and
settings after import; also verify the pilot workspaces remain unaffected.
Never replay an uncertain import without first inspecting destination state.

The normal encrypted export includes the publication draft. Restore never
publishes. Treat the root key and backup as a pair; do not directly replace a
root key while retaining unreadable database contents. Pause affected workspaces
before maintenance, preserve their keys, and use a verified export/import to
migrate or rotate. This milestone does not implement automatic disaster recovery
or automatic tenant deletion.

## Verification and rollout gates

`src/hosted/isolation.test.ts` runs a real local gateway and three real tenant
Workers backed by separate D1 databases. It tests invitation reuse/concurrency,
CSRF, owner reads, foreign API denial, encryption separation, direct-ingress and
forged-proof rejection, workspace-specific OAuth approval, cross-workspace bearer
rejection, scope-filtered tools and session revocation. Publishing and backup
negative tests remain in the preceding milestone.

Repeat the same essential tests on staging with two controlled pilot accounts,
then exercise browser login and the real founder portfolio. Keep public signup
closed until external security review, provider write qualification, account
recovery, operational monitoring and capacity management are ready. Successful
sync and green CI do not establish that a paid registrar operation is safe.
