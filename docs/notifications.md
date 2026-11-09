# Email and portfolio notifications

The primary experience is for an owner with 10–20 names. Portfolio size does not
change preferences automatically. Existing accounts are not enrolled in new
portfolio emails by a deployment, page view or import.

## What sends email

- Inquiry submission sends the buyer a confirmation. Owner alerts start after
  confirmation and continue for buyer messages. Owner replies still reach the
  buyer when owner inquiry alerts are disabled.
- Requested sign-in, identity confirmation, signup verification, recovery and
  replacement links retain their existing proof and expiry rules.
- Committed password changes/resets and passkey additions/removals create a
  security notice when the security feature is enabled. No failed-change notice
  is presented as a successful change.
- New manual/unknown-setting renewal reviews are grouped into a change-only weekly
  message, prepared on Monday after 09:00 in the saved timezone. Nothing new means
  no routine reminder. The optional overview is off by default and may repeat
  upcoming names when explicitly enabled.
- Unresolved near deadlines that cannot wait for the next weekly review use an
  urgent envelope. Confirmed provider evidence is required for provider-status
  claims. Currently the source adapter recognizes fresh recorded expiry statuses;
  an independent automatic-renewal failure feed is not assumed or fabricated.
- Healthy auto-renew settings do not trigger ordinary deadline reminders. They
  can appear in an explicitly enabled overview. Enabled is not proof of renewal.

Renewal candidates have a usable recorded review/expiry date within 30 days, or
specific trusted provider-status evidence. A seven-day stage is distinct from the
initial review, but it is not a daily countdown. Same-stage events are deduplicated.
Routine and urgent work have separate admission: an urgent event does not wait
23 hours merely because a routine message was already sent that morning.

The email lists up to 20 affected names with dates, renewal setup, source freshness
and available estimates. The count covers the full qualified set. Missing prices
are not zero; TLD estimates can miss premium renewals. Missing/conflicting dates
remain review work in the app rather than definitive deadline claims. Links open
the current authenticated view; no historical reporting portal is required.

## Owner controls

Settings → Notifications offers inquiry alerts, renewal reminders, optional weekly
overview and an IANA timezone. New portfolio mail needs an explicit Save and an
email-verified account recipient. A passkey alone is not email verification.
Renewals → Renewal reminder choices provides Mark handled, Let expire and Resume.
These choices never renew a domain or change a registrar setting. Mark handled
dismisses the current stage; Let expire mutes ordinary deadlines for that cycle.

Unsubscribe links disable optional portfolio mail only. Scanner GETs do not change
preferences; explicit browser POST and RFC 8058 POST are idempotent. Authentication,
security and buyer replies remain independent. Token hashes expire after 90 days.

## Quality and delivery

All account, inquiry, renewal, security and operator messages share one shell:
HTML/text, full wordmark, system fonts, a 600px layout, mobile wrapping, descriptive
actions, complete fallback links, support/privacy and appropriate preferences.
No open tracking or analytics redirects are added to private links.

Control migration 0025 adds consent, due checkpoints, attempt evidence and committed
security intents. Tenant migration 0011 adds the outbox and hashed event ledger.
Backup format 14 preserves owner decisions and preference drafts. Starting a restore pauses optional portfolio mail before the tenant operation; it
stays paused on failure or an uncertain outcome until preferences are reviewed.
Restore does not re-enroll sending, restore capabilities or replay pending mail. Deletion removes
selected-name choices and associated transient email content. Account deletion
cascades the new control records. Retention keeps diagnostic attempts for 30 days;
unknown attempts retain the evidence needed for reconciliation.

Atomic leases, final claims, preference/recipient checks and weekly reservations
prevent concurrent send duplication. Known-unsent quota deferral is not charged as
a provider attempt. Actual transient provider attempts stop after five failures.
Provider acceptance followed by an acknowledgement failure retries the ack only.
Ambiguous sends stay unknown; they are not automatically resent.

Optional sending needs explicit daily/monthly allowance and shared-campaign
headroom. Existing campaign IDs/counters, provider ceilings and authentication/
conversation controls are retained. A denied atomic budget reservation does not
partially consume another bucket. Admission reservations are conservative;
they are not a report of physical provider sends or inbox delivery.

New flags default off in repository templates. Managed deployment must preserve
all current bindings, secrets, identities, credentials, publications and schedules.
Use the matched pinned engine/UI artifact, current release-preservation procedure
and trusted managed-import QA lease/cleanup runner. Notification due work and
historical choices do not restart registrar polling in an otherwise empty account.

Source/CI, managed adoption, provider acceptance and actual inbox/client rendering
are separate qualification outcomes. Do not infer Gmail/Outlook/Apple Mail receipts
from a local preview. Native checks require an unlocked computer. No independent
customer adoption or new provider capability follows from these changes.
