# Conference operations

Offer: free early access for portfolio management. No credit card is required.
Registrar charges are separate. Do not promise lifetime pricing, unlimited
capacity, universal registrar eligibility, or completed independent security
qualification. Use the full domains.domains wordmark and labelled sample data.

## Before opening

1. Verify `https://domains.domains/` and `/signup` in a fresh browser. Scan the
   actual printed QR on iPhone and Android, using Wi-Fi and mobile data. An
   unfamiliar attendee should complete sign-in and import without coaching.
2. Record available qualified workspace capacity at that time. Count only
   enabled platform rows with `qualified_at>0` and `signup_enabled=1`, excluding
   owners, invitations and closure reservations. Check the public registration,
   legal, email and dispatcher gates. Recheck immediately before the event;
   open signup can consume the reserve before attendees arrive.
3. Read the provider-wide remaining email quota separately from application
   campaign counters. Budget one first email per attendee plus resends, recovery
   and inquiries. Other projects share provider quota. Never infer inbox
   delivery from an accepted send or campaign reservation.
4. Qualify the customer-facing registrar route. An owner-specific proxy override
   does not qualify the shared managed default. Namecheap customers must meet
   registrar API requirements and allowlist the displayed outgoing IP. Route
   changes require checking each affected allowlist; never silently substitute
   an IP or fall back to direct traffic. Keep CSV import as the API-free path.
5. Confirm the named support operator can receive mail at
   `domains@domains.domains`. Verify an actual received test, not just SENT.
   Keep the recovery case procedure below and an offline demo available.

## Attendee rehearsal

Use a controlled QA account and fictional `.example` domains. Record the runtime
engine/source and viewport alongside results. Capture the QA draft before import
and restore it afterward; preserve existing publication state and account flags.

- Open the QR destination, request an authorized sign-in email, receive it, and
  exercise a correctable code typo without requesting unnecessary extra mail.
- Import the sample CSV privately. Confirm recognized fields and additions,
  repeat the preview to check duplicates, and confirm an invalid row prevents
  submission. Search the imported names and sign out/in to verify persistence.
- Distinguish imported names from registrar-verified holdings. Imported names
  do not prove ownership or provide registrar expiry/renewal data.
- Verify the shared MCP endpoint's read-only consent, account isolation and
  revocation using QA identities. Restore original MCP settings and revoke test
  grants. Never grant an attendee access to an operator's portfolio.
- Keep public publication, registrar changes, renewals and buyer messages out
  of the sample walkthrough unless separately authorized and qualified.

Responsive browser checks do not replace physical-device or venue tests.
QQ/163/126 and mainland connectivity remain unqualified until controlled receipts
exist. The accepted Gmail-only launch scope must not be presented as wider proof.

## Support and recovery

Assign an operator before the event; publish no response-time promise without
coverage. Collect the account email, time and a sanitized error screenshot. Never
request a password, registrar API key, backup, recovery link or MCP bearer token.
Use [hosted-operations.md](hosted-operations.md#account-recovery) for identity
verification and one-use recovery. Treat email access, browser sessions and MCP
grants as separate credentials. Revoke only the affected authorization.

Back up control data, occupied tenant data, the platform registry, gateway
configuration, auth pepper and matching tenant roots. Verify SQL integrity and
decryption in isolation; do not overwrite customer databases for a drill. Keep
an encrypted off-device copy and place its recovery key in a separate approved
vault. A local archive is not off-device custody, and an isolated SQLite restore
is not a live Worker disaster-recovery test. Record both limits honestly.

## Day-of response

- Capacity or email exhaustion: stop promising immediate access, explain the
  limit, and direct people to the labelled demo/support path. Do not reset limits.
- Registrar failure: retain cached holdings, state the failed sync, and offer
  private CSV import. Do not re-enter credentials or repeatedly retry an unknown
  provider failure. Distinguish proxy rejection from registrar authorization.
- Site or venue outage: play the offline sample walkthrough and show the printed
  URL. Do not call the recording a live session or collect credentials at the booth.
- Suspected account/data isolation issue: stop onboarding and preserve evidence;
  investigate before reopening. A release rollback must preserve current customer
  data, coordinator identity and encryption keys.

Freeze feature work before the final rehearsal. Repair release-blocking defects
through the normal reviewed PR and deployment process. Close the event with
observed signup, first-import, email-failure, sync-failure and support-case counts;
do not substitute demo views or synthetic load results for attendee outcomes.
