# Dynadot sync admission reliability

## One Dynadot request across hosted users

All hosted Dynadot requests now use the same durable admission lane, including
inventory, pricing and account reads from scheduled, browser and MCP syncs.
Managed, approved alternate and other customer-supplied proxy routes no longer
create independent Dynadot lanes or bypass admission. The queue changes neither
the selected proxy nor its credentials. Desktop and self-hosted installations
without the hosted scheduler retain their existing transport behavior.

Only one Dynadot request can hold a lease across accounts and workspaces. It
keeps that lease until the response body is consumed and sockets are closed,
then leaves at least 1.1 seconds before the next Dynadot request. An upstream
429 persists its Retry-After cooldown for all waiting Dynadot users. Other
registrars retain the shared relay's existing concurrency. Tenant rotation,
bounded pending tickets, cancellation, fenced releases and abandoned-lease
expiry remain in force. Admission waits retain the 120-second deadline and
do not open a connection while waiting; hosted Dynadot clients keep automatic
HTTP retries disabled rather than multiplying requests under load.

The existing primary durable object is reused, preserving leases and cooldown
state. For a rollout, operators may set `DYNADOT_ADMISSION_RESUME_AT` to a future
Unix timestamp in milliseconds. Until then, new Dynadot acquisitions defer
without network traffic while releases and cancellations remain available.
Deploy the scheduler first, allow old alternate leases to drain, and set the
resume time no earlier than any retained primary/alternate upstream cooldown.
Then deploy the matching tenant engine. Old alternate releases remain fenced
and can close leases issued before migration. Private status endpoints expose
Dynadot active/queued counts and cooldown time without credentials or API data.

Deterministic regression checks cover eight concurrent users across all three
route classes (one grant, seven waiting), shared cooldown across routes, a
custom-route bypass, socket cleanup, self-hosted compatibility and release of
old alternate leases during rollout. They send no live registrar requests.
These controls prevent concurrent application calls; they cannot guarantee
that every provider rate limit disappears. Dynadot also imposes account-tier
request-rate limits: https://www.dynadot.com/domain/api-document

## Earlier queue-capacity admission fix

The managed relay allows four active connections and four pending queue tickets
per workspace. A full sync of four Dynadot accounts plus Namecheap starts five
proxied reads. When relay slots are temporarily occupied, four reads can join the
queue and the fifth receives `busy`. The old client immediately turned that reply
into `PROXY_QUEUE_BUSY`, so an account could show Sync failed without its registrar
ever receiving a request. A later attempt could succeed after capacity freed up.

The lease client now waits five seconds before checking capacity again, within
the original 120-second admission deadline. It keeps the same request identity,
obtains a fenced lease before opening any connection, and cancels promptly when
the caller aborts. Permanent saturation still ends at the original deadline;
busy admission polls are limited to 24 over that interval. Active and pending
limits, tenant fairness, transport deadlines, provider pacing and HTTP retry
policies are unchanged. Registrar writes are not replayed.

## Verification

The regression test uses the actual queue transition logic with four occupied
slots and five reads from one workspace. On the previous source, one read fails
with `PROXY_QUEUE_BUSY`. With the fix, all five complete, active/pending counts
remain bounded at four, and the queue drains. Additional tests cover permanent
saturation and cancellation during capacity backoff.

The before/after scenario was also run through temporary remote preview clients
against separate test objects in the existing Cloudflare scheduler namespace.
The old client admitted 4/5 reads and rejected one; the fixed client admitted 5/5.
Both runs left zero active and pending tickets. The real outgoing-IP object and
registrar endpoints were not used by this contention probe.

The authored change is confined to the Worker lease client and its regression
tests. Engine `1.5.2-hosted.12` packages it for the hosted tenant boundary; its
renderer assets are byte-identical to the preceding engine. Deployment must
preserve workspace secrets, bindings, access state and the existing admin grant.

## Evidence boundary

The new owner diagnostics initially contained only successful scheduled and
browser sync outcomes. A backend full sync and the browser full sync both
succeeded before the fix, retaining 940 domains across eight accounts. The
original demo failure was not retained, so it cannot be conclusively attributed
to this queue-capacity defect. This fix addresses the reproduced contention
failure; it does not claim to resolve unrelated provider outages or bad credentials.

Dynadot's published request/thread limits remain applicable:
https://www.dynadot.com/domain/api-document
