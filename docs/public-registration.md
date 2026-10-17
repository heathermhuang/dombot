# Public accounts and email

Customer-facing copy uses **account** for access and **portfolio** for domain
holdings. Internal `workspace_id` values, service bindings and tenant URLs remain
immutable implementation details. The rejected `d.d` mark must not return.

## Release gates

Apply `hosted/migrations/0004_public_registration.sql` to the control database
before deploying this gateway. It only adds tables; it does not alter existing
accounts or tenant data.

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
- `PUBLIC_SIGNUP_IDS` is a comma-separated list of prequalified, physically
  isolated, unused tenant IDs already present in the gateway's `WORKSPACES`
  configuration. Never include a customer's old or closed identity or a QA slot.
  Check owning control rows, unique root keys, private ingress and signed gateway
  admission against the established deployment receipts.
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

Verification links expire after 20 minutes; recovery links after 15 minutes.
Only token hashes are stored. GET requests do not consume links. Creating an
account requires matching passwords of at least 12 characters and explicit
acceptance of the current Terms and acknowledgement of Privacy. Acceptance
versions and time are recorded with the account creation transaction. Resending
invalidates the previous link. Password recovery revokes browser sessions;
paired assistants remain separately revocable in MCP settings.

Shared durable app budgets permit at most 30 attempted messages per UTC day and
300 per UTC month, with additional IP and address limits. Failed sends consume
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

## Confirmed operator

On 18 October 2026 the owner confirmed **Magic Crystal Limited, Hong Kong** as the
service operator. Use that exact legal name and jurisdiction in production. The
public privacy/support contact is domains@domains.domains. This confirmation does
not replace actual sender authentication, support-inbox receipt or live account
journey checks.
