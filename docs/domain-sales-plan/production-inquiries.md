# Production inquiry operations

This release adds renewable DNS control to explicitly selected listings. It does
not publish inventory, activate other accounts, enroll an unqualified external
hostname provider, or remove the existing publication and fresh-identity checks.

## Supported control paths

A healthy connected registrar remains a source of current domain control. For an
imported or otherwise unconnected name, the account can prepare a DNS record in
Domain setup, add the exact TXT value, and check it through the authenticated
workflow. Preparing a record grants no authority. Verification does not publish
the draft: the account must still review and approve its exact public content.

The DNS check issues a tenant-local lease lasting at most 24 hours. The gateway
checks previously verified records every six hours, in batches of at most 20 due
records per scheduled run. It does not scan inventory or poll pending records.
Transient failures retain only the last bounded observation and retry the due
record after two minutes. Expired observations cannot authorize publication.

Every observation advances a fenced generation before a tenant grant is issued.
A newer loss cannot be undone by an older successful check. A persistent loss
generation also reaches the tenant if the original revocation delivery failed.
Restoring the record makes verification available again, but a publication that
lost control requires another explicit review. Subsequent healthy renewals do
not undo that review or rewrite its public terms.

A missing record blocks the canonical page and affected hostname immediately in
the control registry, including normalized URL variants and inquiry submission.
Shop pages and exports temporarily stop while a known loss is unacknowledged by
the tenant. They resume after durable revocation, excluding the affected listing.
Tenant revocation marks an active listing uncertain.
Existing private conversations and recovery records retain their normal policy.
Lease metadata is not portable; deleting/restoring a draft removes its grants.
Account closure/suspension continues to block public routing and delivery.

## Hosting

`SALES_OPERATOR_HOSTS` is an operator-owned routing policy, not evidence of domain
control. Each entry binds a workspace, domain, exact apex or www hostname,
observed Workers Custom Domain resource ID and `domains-sales-lander` service.
Create it only after checking the actual resource, unused hostname and protected
DNS snapshot. Production operator routes require the normal hostname TXT proof,
current publication, TLS and an exact served revision. They do not use the
short-lived demonstration attestation as a permanent grant.

Existing approved hostname bindings are rechecked in bounded due batches every
six hours. The controller checks current publication and TXT proof, then verifies
the served HTTPS revision. A healthy renewal keeps the page serving. Missing
proof advances the binding epoch and suspends routing. A different served revision
stops routing until it can be reconciled. Paused/deleted publications are detached;
renewal never discovers or activates a private listing. The owner can use Check
connection for an existing plan after completing fresh identity confirmation.

Cloudflare for SaaS remains a separate adapter. Its entitlement, scoped API token,
apex behavior and billing must be qualified before enabling customer-managed
zones through that adapter. An owned-zone route does not prove that capability.

## Delivery and recovery

Public inquiries use the existing confirmation and durable outbox. Normal mailbox
Reply uses independent participant-scoped relay addresses. Quotas, suppression,
final claims and unknown outcomes remain authoritative. Documented rate/daily
quota rejections are known-unsent and receive bounded retry. Documented validation
or binding rejections fail visibly; provider suppression is retained. Transport
ambiguity and server-side uncertainty remain unknown and are never replayed
without reconciliation. Raw provider messages are not stored as diagnostic text.

Dispatch checkpoints align with the next cron boundary. A late invocation no
longer causes the following tick to be skipped. An unavailable tenant does not
prevent dispatch for other eligible tenants. Independent maintenance tasks still
run if another task fails; the invocation reports a fixed failure without PII.
The owner health view highlights unknown/failed delivery, expired leases and work
that is overdue by five minutes, rather than flagging normal queued mail.

## Release sequence

1. Preserve the dirty primary checkout, backups, exact engine manifest, schema,
   live settings, identities, legacy portfolio and protected DNS observations.
2. Apply additive control migration `0008_sales_domain_controls.sql` and tenant
   migration `0006_sales_control_leases.sql` before enabling new writers. Deploy
   engine `.15` and the gateway/edge from the same reviewed source. Do not infer
   coordinator adoption from an outer engine header.
3. Keep `SALES_DNS_CONTROL_ENABLED=false` on tenants until migrated. Enable it
   only for the intended account, together with gateway
   `SALES_DOMAIN_CONTROL_ENABLED=true` and a strict UUID list in
   `SALES_DOMAIN_CONTROL_WORKSPACES`. Other accounts remain opt-in and disabled.
4. Inspect the actual named operator hostname resources and add only those entries
   to the routing policy/host allowlist. Add the exact reviewed TXT records while
   preserving existing application, mail, CAA, delegation and DNSSEC records.
5. Use the normal owner setup and exact publication review. Qualify actual form
   submission, explicit confirmation, inbox/reply, relay in both directions,
   recovery, pause/unpublish and a new controlled recipient that is not
   pre-enrolled with the email provider. Owned-mailbox qualification is not
   independent-user acceptance. Keep the demonstration visibly identified.
6. Record deployed versions, source offer, lease/renewal evidence, actual received
   notifications, unchanged protected state and any remaining named-domain gate.

After a DNS lease is written, use a compatible reader for repair. Do not roll back
to an engine that cannot process its revocation. Pause/unpublish and detach before
retiring routing policy or verification configuration; do not use configuration
removal as a revocation workflow. Preserve failed and unknown receipts.
