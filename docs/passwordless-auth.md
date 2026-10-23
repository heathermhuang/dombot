# Email sign-in and passkeys

`/login` and `/signup` share an email-first form. No Google resource, social login,
password or CAPTCHA is required by this flow. Mainland reachability and delivery
to QQ/163/126 need actual network/mailbox tests; the absence of Google dependencies
is not proof of China availability.

## Security contract

- Email links and six-digit codes share a ten-minute proof. The server stores a
  SHA-256 link hash and a peppered, challenge-bound HMAC of the code. Five attempts
  exhaust both. A new request replaces the earlier proof. GET only shows a
  confirmation page, so link scanners cannot sign in or use up the proof.
- IP, address and global request limits apply before sending. Unknown, disabled
  and known account responses share the same text/status. SMTP acceptance, failure
  and quota exhaustion do not disclose whether an address is registered.
- New users explicitly accept the current legal version. Only prequalified unused
  slots may be claimed, inside the same D1 transaction as proof consumption,
  identity creation and legal acceptance. Failed or concurrent claims never
  allocate another person's portfolio. Closed identities are never recycled.
- Existing users keep their identity, password hash and portfolio. Email proofs
  for existing users snapshot the credential hash; changing the password prevents
  old pending proofs from creating a session. A new browser token is minted for
  every authentication. Email reauthentication is bound to the requesting active
  session, which is rotated after success.
- Passkeys use pinned SimpleWebAuthn libraries, the exact HTTPS origin and RP ID
  `domains.domains`, user verification required, opaque user handles, single-use
  five-minute challenges, per-credential counters and a transactional revision
  check. Public keys are stored; private keys and biometrics are never received.
  Synced authenticators can legitimately have a zero counter; challenge replay
  protection is mandatory even when counters stay zero.
- Credential access/changes, proxy credentials, backup import/export, registrar
  writes, bulk-job continuation/results, domain deletion, agent approvals and MCP
  enabling require authentication within five
  minutes. Once any passkey exists, a fresh existing passkey is required. Email
  login or password recovery cannot bypass it. Revoking a session invalidates its
  pending registration/reauthentication challenge. Password recovery also revokes
  shared SaaS MCP grants and pending OAuth authorizations/codes atomically.
  Ordinary password changes and browser logout leave MCP connections active.
  Workspace-specific legacy pairings remain separately controlled through MCP
  settings; recovery does not remove registered passkeys.
- The gateway decodes API method names once and rejects noncanonical names,
  including literal/encoded trailing slashes and extra path separators, before
  forwarding. Encoded letters retain the same sensitive-method checks.
- A first passkey requires fresh email/password authentication. Further enrollment
  requires a fresh existing passkey. Limit ten per user. Removal requires a fresh
  passkey, derives the user from the session and signs out other browsers. Add a
  backup on another trusted device. Lost-passkey recovery requires operator
  identity verification; email alone does not remove registered passkeys.

The unchanged tenant HTML receives a self-hosted enhancement from the gateway.
It routes a `428` response to confirmation and returns to the private page. It
never automatically replays a registrar write or backup export; retry the action
after confirming. JavaScript-disabled browsers can still use email/password.

## Build, rollout and rollback

```sh
npm ci --ignore-scripts
npm rebuild esbuild
npm ci --prefix hosted --ignore-scripts
node hosted/build-auth.mjs
```

Dependencies live under `hosted/`, outside the pinned engine dependency graph.
The generated browser bundle is embedded in the gateway, served only at
`/auth/browser.js`, with CSP `script-src 'self'`. Keep the existing preview image
allowlist and asset binding. The ten tenant engines do not require rebuilding.

Apply `0005_passwordless_passkeys.sql` after the existing control migrations and
before gateway deployment. Capture the existing users/workspaces/bindings and an
owner-only backup first. The migration is additive; old sessions get zero freshness
and must confirm before sensitive actions. Deploy the exact merged revision and
set `SOURCE_COMMIT` accordingly. Verify source, account routes, real email receipt,
one-time link/code use, session rotation, fresh-auth rejection and a controlled
passkey enrollment/login/removal on an isolated QA identity. Restore QA enablement
and remove test credentials afterward.

Keep additive tables when rolling back the gateway. Disable public registration
and email delivery if needed; existing password access is retained. A rollback to
a version without fresh-auth guards weakens protections and must not be presented
as an equivalent security state. Passwordless users need this gateway to sign in;
prefer a fix forward or retained `/login/password` fallback for password users.

## Capacity and external qualification

Cloudflare's account API reported a 1,000/day provider quota on 18 October 2026.
Its published Workers Paid allowance is 3,000 emails per billing month, shared
across the account; usage above that is chargeable. The app defaults to durable 30/day and 300/calendar-month request budgets.
Operators can set `AUTH_EMAIL_DAILY_LIMIT` and `AUTH_EMAIL_MONTHLY_LIMIT` after
checking provider usage; ceilings are 10,000/day and 100,000/month, not prepaid
allowances. Email-first requests reserve before identity lookup, including
unknown addresses, so global exhaustion returns the same branded 503 and
Retry-After to everyone. The code screen is not shown when this reservation fails.
Shared-network defaults are 200 requests per IP and 400 globally per ten minutes,
configurable with `AUTH_EMAIL_IP_LIMIT` and `AUTH_EMAIL_GLOBAL_LIMIT`. Two requests
per address remain enforced. Verification allows 600 per IP per ten minutes
(`AUTH_EMAIL_VERIFY_LIMIT`), while each proof still permits only five attempts. Failed sends remain charged. No paid upgrade or quota increase is part
of this release. These app budgets do not reserve a provider-wide free allowance.

Before expanding signup capacity, reconcile the provider's current subscription
usage and app send demand, then set an explicit budget and measure inbox receipts.
QQ, 163/126 and mainland network checks require owner-controlled recipients and a
mainland test endpoint. Record delivered/accepted/unknown separately. Never use
invented mailboxes or treat a Google mailbox receipt as China qualification.

## Conference campaign allowance

The optional
`EMAIL_CAMPAIGN_ID`, `EMAIL_CAMPAIGN_LIMIT` and `EMAIL_CAMPAIGN_DAILY_LIMIT`
configure one non-resetting total and one shared daily allowance across auth and
inquiry email. All three must be valid when configured. The lifetime row is not
removed by hourly expiry cleanup and must not be reset across billing periods.
Provider failures and unknown-address reservations remain charged. Set the total only after recording an explicit usage budget and checking current
provider pricing. A reservation ceiling is a conservative send cap, not a claim
about account-wide billing or inbox delivery.
