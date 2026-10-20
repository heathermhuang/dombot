# Public accounts and email

Customer-facing copy uses **account** for access and **portfolio** for domain
holdings. Internal `workspace_id` values, service bindings and tenant URLs remain
immutable implementation details. The rejected `d.d` mark must not return.

## Release gates

Apply `hosted/migrations/0004_public_registration.sql` to the control database
and `hosted/migrations/0005_passwordless_passkeys.sql` before deploying the gateway. The latter adds proof/passkey tables and session freshness metadata. Existing credentials, tenant identities and portfolio data are retained.

Public signup opens only when all of these settings are complete:

- `LEGAL_OPERATOR_NAME` and `LEGAL_JURISDICTION` identify the confirmed contracting
  party and data controller. Read `/terms` and `/privacy` with that identity before
  opening registration. Without it those routes return an explicit 503 notice;
  a placeholder is not a published policy. Policy text is maintained in
  `src/hosted/legal.ts` with a dated version. Increment it when terms change.
- `EMAIL` is a Cloudflare Email Sending binding restricted with
  `allowed_sender_addresses: ["accounts@mail.domains.domains"]`.
  `EMAIL_FROM` must match. Local development must keep `remote: false`.
- `CANONICAL_ORIGIN` is `https://domains.domains`. Email links always use this
  configured origin, never a supplied host or return URL.
- `EMAIL_DELIVERY_VERIFIED=true` requires a controlled accepted-send receipt and
  a received message with passing sender authentication. An enabled sender or
  DNS records alone are insufficient. Do not send a test message without the
  owner's authorization for its sender, recipient and purpose.
- Legacy slots use `PUBLIC_SIGNUP_IDS`, a comma-separated list of prequalified, physically
  isolated, unused tenant IDs already present in the gateway's `WORKSPACES`
  configuration. Never include a customer's old or closed identity or a QA slot.
  Check owning control rows, unique root keys, private ingress and signed gateway
  admission against the established deployment receipts.
- Platform slots use `PLATFORM_ENABLED=true`, the private `DISPATCHER` namespace
  binding, and operator-owned `platform_workspaces` records. A record must have
  `qualified_at>0` and `signup_enabled=1`, with an enabled, unused, uninvited and
  unclosed workspace. Do not put hundreds of platform IDs into the legacy
  environment list. Provisioning is separate from runtime qualification and
  public eligibility; see [Workers for Platforms](workers-for-platforms.md).
- Set `PUBLIC_REGISTRATION_ENABLED=true` only after the preceding checks pass.

Until then the bounded access-request form remains available and the landing
page does not advertise immediate account creation. Existing invitations and
operator-issued recovery links remain valid. Registration uses available
preprovisioned capacity; it does not create unbounded infrastructure or reuse
closed accounts. When all slots are taken the form reports capacity honestly.

## Email and Google inbound delivery

Transactional mail uses the dedicated `mail.domains.domains` sending domain.
Cloudflare manages bounce MX/SPF, DKIM and DMARC beneath that subdomain. Preserve
the existing root MX and Google configuration. **Do not onboard the root sender
without first verifying every existing root-domain sender's SPF/DKIM alignment:**
Cloudflare onboarding automatically adds a strict root DMARC policy. Disabling
the root sender may leave DMARC behind; compare authoritative DNS with the saved
baseline and remove only a record introduced by this operation.

Support is `domains@domains.domains`. Its actual inbox/alias must exist at the
Google mail provider and a received message must be verified. An MX record or a
message in the sending Gmail account does not prove delivery to support.

The default `/login` and `/signup` screen asks only for email. A ten-minute, single-use magic link and six-digit code share one proof; either invalidates both. Codes allow at most five attempts. Only proof hashes are stored (codes use a peppered HMAC). GET never consumes a link. New accounts require explicit current Terms acceptance and Privacy acknowledgement. Existing users keep their immutable identity and can sign in when public signup is closed or full. Existing passwords remain usable at `/login/password`. Legacy signup links expire after 20 minutes and password-recovery links after 15 minutes. Acceptance
versions and time are recorded with the account creation transaction. Resending
invalidates the previous link. Password recovery revokes browser sessions;
paired assistants remain separately revocable in MCP settings.

Shared durable app budgets default to 30 reserved requests per UTC day and
300 per UTC month; the operator may configure bounded overrides using
`AUTH_EMAIL_DAILY_LIMIT` and `AUTH_EMAIL_MONTHLY_LIMIT`. Email-first requests
reserve before identity lookup, including unknown addresses, and exhausted
capacity returns a branded retry page. Additional IP, global and per-address
limits remain; see passwordless-auth.md for their configuration. Failed sends consume
budget to prevent retry storms. These limits do not reserve the provider's
account-wide free allowance, which may be used by other applications; no plan
upgrade or unlimited free-delivery claim is implied. Provider acceptance does
not establish inbox delivery. No tracking pixels are used.

Scheduled cleanup removes expired proofs, budgets and sessions. Closure still
disables access immediately and queues physical erasure after 30 days; the
operator performs erasure and backup handling. Do not describe those manual
steps as automated or a formal security/legal clearance.

## Verification and rollback

Run `npm run typecheck`, `npm run lint`, `npm test`, the separate security
regressions and the existing Worker build checks. Registration tests exercise
real D1 transactions, racing claims, reserved/closed/unlisted capacity, proof
expiry/reuse, CSRF, current legal acceptance, recovery/session invalidation,
mail failures and concurrent message budgets. They send no external email.

For an operational problem, set `PUBLIC_REGISTRATION_ENABLED=false` and
`EMAIL_DELIVERY_VERIFIED=false` to stop new self-service creation and email
requests without changing existing credentials. Disablement does not remove
accounts already created. Keep additive migration tables when rolling back the
gateway; retain their records for investigation and applicable retention.

## Legal operator configuration

Keep `LEGAL_OPERATOR_NAME` and `LEGAL_JURISDICTION` aligned with the confirmed
operator identified in the published Terms and Privacy Policy. Use domains.domains
as the public product brand. The privacy/support contact is domains@domains.domains.
Legal identification does not replace actual sender authentication, support-inbox
receipt or live account journey checks.
