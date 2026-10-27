# Dynadot sync admission reliability

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
