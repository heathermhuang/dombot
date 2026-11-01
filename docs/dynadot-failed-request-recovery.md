# Dynadot failed-request IP recovery

The hosted queue preserves one global Dynadot lease and the existing 1.1-second
post-response spacing. A proven failed-request IP restriction opens a durable
circuit. The first application quiet period is 30 minutes with positive jitter
up to 10%; any longer provider Retry-After wins. After expiry, only one inventory
request can claim the fenced recovery lease. Pricing and legacy requests defer
locally without provider traffic. Unsuccessful or uncertain probes escalate to
two hours, then six hours, then attention required after three probes.

The compatibility release uses a **global Dynadot hold**. The transport identifies
managed routes using host configuration and the selected actual proxy; unknown
custom egress cannot be proved independent by this service boundary. Neither
route labels nor purpose create parallel provider lanes. Other registrars retain
their relay capacity. The circuit exposes only allowlisted status/deadline data;
lease tokens, URLs, credentials, response descriptions and holdings remain private.

Only HTTP 200, logical code 200 and a valid explicit inventory array close a
half-open circuit. HTTP 200 error envelopes, missing/malformed inventory,
exceptions, cancellation and abandoned leases cannot reopen pricing. The normal
application sync commits retained/fresh holdings and its scheduled event. Local
holds do not increment upstream attempts or create failure events. Disabled
accounts, operator maintenance pauses and terminal recovery remain stopped.

Pricing restrictions also schedule the inventory recovery candidate even when
inventory was recently fresh. Pricing retains pending names and previous quotes
until inventory succeeds. The existing account/key/route capability evidence is
persistent configuration state: invalid classic-key and unsupported REST-TLD
rejections survive cold wrappers, inventory/cache rebuilds and the former TTL.
An actual API-key change or explicit capability reset can invalidate evidence;
a deployment does not. Read-only price checks never become paid renewals.

## Rollout and rollback

Deploy central compatible readers and the additive scheduler protocol before new
engine clients. Use the existing bounded Dynadot admission pause while mixed
versions drain, retaining leases and all longer stored cooldowns. The incident
seed is guarded by the observed incident time, exact prior short-cooldown
checkpoint and absence of active Dynadot leases; its persisted marker prevents
redeployment from reseeding a recovered circuit. It never shortens an active hold.
The Conference rearm helper additionally checks the exact event, account, source,
engine, last-good/error times, retained count and failed-three-attempt state.
Apply it with an encrypted-document compare-and-swap; a mismatch stops migration.
No other stopped account is bulk reset.

Restore the previous client deployment/settings if needed while retaining the
compatible scheduler and its durable circuit. Do not roll the scheduler back to a
version that ignores active circuit state, delete Durable Object storage, clear
negative pricing evidence, change routes or re-enable exhausted probes.

## Verification boundary

Regression tests cover the original classification gap, endpoint purpose, one of
eight admission, long holds/restart, legacy aliases, fencing, semantic inventory,
uncertain/abandoned probes, escalation/terminal stop, guarded migration, scheduled
recovery, retained prices, TTL/cache suppression, old readers and incident grouping.
These deterministic checks make no registrar requests. The full repository CI
matrix and deployed-source/customer-state checks remain separate from actual
Dynadot inventory recovery and renewal-pricing coverage. The quiet periods are
application policy, not promises of provider clearance.
