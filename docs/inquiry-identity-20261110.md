# Inquiry contact details and private submission context

The public inquiry form asks for a full name and email, with optional LinkedIn or
professional profile, organization, organization website and inquiry role. The role
label is “I’m inquiring”, with individual, organization and client options. Existing
message/offer and email-confirmation behavior is preserved.

The public gateway and custom-host edge capture submission time, IP address,
reported user agent and language, and approximate IP-derived location/timezone
when available. These bounded fields are carried in the signed public admission,
so internal Worker hops cannot substitute their own context. They are stored with
the existing encrypted inquiry payload. Request metadata is not accepted in the
public form/JSON schema. Missing values remain unknown.

The seller’s inquiry panel labels identity as unconfirmed, distinguishes confirmed
email access from self-reported details, links to provided profiles/sites, and
shows private submission context with an expandable raw IP/user-agent section.
Network/browser data and submitted profile links do not verify personal identity.
Older inquiries show that request details were not captured; there is no backfill.
“Request contact details” prepares an editable reply without sending, preserves
existing reply drafts and uses the existing verified-inquiry sending requirements.

The privacy notice and policy describe collection, recipients and retention.
Contact details and request metadata remain outside public conversation responses
and email payloads. They follow the inquiry’s existing deletion and retention
periods: pending inquiries expire after seven days, verified conversations after
12 months without activity. Owner exports/backups retain the fields. Backup format
16 and Sales backup version 4 prevent older readers silently losing new data;
this reader accepts supported older backup versions. Rollback must retain a
compatible inquiry/backup reader once new records have been accepted.

The deployment must activate compatible tenant readers before gateways start
signing metadata. The preceding immutable form scripts remain available while
coordinators propagate. Rollout includes existing portfolios, the future template,
provisioner, canonical gateway and public custom-host edge, with live configuration
and existing data preserved.

Verification covers full synthetic form intake to encrypted storage and private
seller projection, signed edge propagation, HTML escaping/URL validation, legacy
inquiries/retries, email/public isolation, deletion and backup restore. Runtime
and deployment observations are recorded separately in the release receipt.
