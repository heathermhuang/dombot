# Scoped Dynadot DNS initialization

Dynadot supports nameserver writes through
[`PUT /domains/{domain}/nameservers`](https://www.dynadot.com/domain/api-document#set_nameserver).
The existing application already implements that API. A separate Dynadot website
login is not a technical requirement. The connected MCP tools in this execution
expose reads; the authenticated first-party app is the write channel.

Moving an unused Park.io fixture to hosted Dynadot DNS also needs its DNS mode
initialized. The new setup page uses the saved account credentials server-side
with native `POST /records`, `add_dns_to_current_setting=true`, an apex ANAME to
`park.io` and a www CNAME to `park.io`. This keeps the current web target during
preparation. It never calls the SDK replacement operation, edits DNSSEC or chooses
nameservers from guessed addresses. Assigned servers come from the registrar,
or from nonempty public delegation when the API omits its default servers.

## Authority and scope

`DYNDNS_SETUP_FIXTURE` is a matching host-owned JSON binding on the gateway and
the one target portfolio. It contains `workspace`, `domain`, `accountId`,
`requestId` and an `expiresAt` no more than 24 hours ahead. There is no default
grant and no caller-selected account/domain/record payload. The setup endpoint is
`/w/{workspace}/sales/lander/dns-setup`. Normal owner membership, same-origin POST
checks and five-minute identity confirmation apply. It does not expand the MCP
connection's permissions or expose credentials.

The owner authorized only unused `015.io`, declared no email/custom DNS services,
and retained its Park.io delegation for rollback. This is a one-fixture operation,
not the broader shared-nameserver mode or a migration of other holdings.
An unchanged Park.io NS write check was cancelled before submission; it was not
performed as part of the authorized Dynadot move.

## Mutation and recovery

Before submission the server verifies external-NS mode, the exact original
Park.io delegation, no native records or forwarding/email services, and no DS
records through both registrar and public DNS. It captures the complete returned
registrar configuration in encrypted recovery storage and takes the existing
domain lock. The Park.io authoritative zone itself is not downloaded or claimed
to be backed up; it remains intact at the retained original nameservers.

One durable request permits one native initialization submission. Scope,
credential identity, delegation, DNSSEC and the complete original configuration
are rechecked before sending. An uncertain submission retains its intent and
lock. Rechecks reconcile observable results without another provider write.
Confirmed rejection with unchanged state releases the lock; known non-submission
also releases it. Other-operation locks are never removed. Complete native
readback and provider-controlled, nonempty delegation precede confirmation.

The private payload uses the existing format-18/Sales-v6 recovery envelope.
Backups carry it without restoring DNS submission authority. An imported receipt
can be reconciled, but never replayed. No new migration or root-key export is
required.

## Controlled endpoint qualification

The optional trusted `qualifyConnection=true` fixture field admits only the
selected Dynadot account/domain for a controlled connection test, without marking
the provider qualified portfolio-wide. It also permits preparation of only that
exact root/www endpoint while the normal apex-qualified flag remains false. It requires one admitted workspace and a global hostname cap of exactly
two, plus the existing edge keys, host allowlist and trusted service target.
Missing, expired, other-domain, multi-workspace and excess-cap configurations
remain closed. This is test admission, not a claim of a live endpoint.

Certificate/ownership proof, provider status, exact route, signed checks and
ordinary public HTTPS remain mandatory. The allowance changes no final live
verification. Remove it after real cutover/restoration qualification and retain
the normal provider/host/workspace activation boundaries.

Focused validation covers 81 native, initializer, form, controller and hosting
tests, plus type/lint checks. Exact-head CI must pass before deployment. Real DNS,
TLS and restoration still require the authorized fixture; source/fixture tests
do not establish those outcomes.
