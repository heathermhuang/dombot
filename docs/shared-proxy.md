# Shared registrar proxy

Hosted requests using the managed fixed-IP egress must acquire a lease from
`domains-shared-proxy-scheduler` through their private
`DOMBOT_PROXY_SCHEDULER` service binding. The scheduler receives only a random
request ID, workspace ID, route mode, and fenced lease token. Proxy URLs,
registrar credentials, headers, and payloads never enter its durable storage.

The queue is global across tenant Workers. It rotates tenants, bounds pending
work to 64 requests and four per tenant, and waits at most two minutes. Each
network attempt retains the 30-second transport limit. The adapter reserves a
155-second total budget for queueing plus one network attempt and disables
automatic retries on this shared route. Ambiguous registrar writes retain the
existing outcome-unknown protection. Queue failures are identified as not sent.

In `SHARED_PROXY_MODE=serial`, only one lease is active and every release is
followed by 15 seconds of quiet time. An orphaned lease must expire, then pass
the same cooldown. A missing scheduler fails closed. Direct registrars,
desktop/self-hosted use, and the owner's separate UK egress do not enter this
gate. This serial mode is a fallback, not a high-volume capacity claim.

## Fixed-source relay

The authenticated HTTPS CONNECT relay in `relay/server.mjs` can connect directly
from the droplet's IPv4 address or forward through the existing proxy during
migration. It accepts only the approved registrar hosts on port
443 and the IP-echo host used for qualification. It never decrypts registrar TLS
and never accepts caller-selected upstream proxies. Worker-to-relay TLS and
registrar TLS both use certificate verification. Direct mode pins destination
connections to IPv4. Set the managed outgoing IP and Namecheap ClientIp to the
droplet's verified address only after the account allows that address.

Relay configuration `mode=direct` needs only its authentication token and TLS
configuration; upstream credentials are rejected. `mode=migrate` temporarily
accepts the existing token for the upstream route and a separate `directToken`
for direct egress, so tenants can move without changing the IP under existing
connections. An upstream failure never falls back directly. After migration,
remove the old token and upstream credentials and retain only direct mode.

`DOMBOT_PROXY_RELAY_URL` is a host-only HTTPS proxy secret. It must not be written
to customer stores, exports, API metadata, logs, or frontend assets. It changes
only the transport used for the managed route. During migration, the old managed
proxy URL remains available for controlled recovery. New direct-egress tenants
use the authenticated HTTPS relay URL as their managed URL, and still enter the
global queue.
Relay substitution requires the original managed proxy credentials as well as
the shared endpoint. A supplied custom password or a different proxy host is
never silently replaced. Relay-only mode rejects a direct shared-endpoint caller.

Start with scheduler mode `serial`. Install the relay on an approved fixed-IP
host, obtain a valid public certificate, and verify authentication, destination
restrictions, actual outgoing IP, and concurrent HTTPS requests from separate
Workers. Add the relay secret and scheduler binding to every tenant and verify
the deployed engine/source and unchanged private bindings. Only then set
`SHARED_PROXY_MODE=relay` and raise `SHARED_PROXY_CONCURRENCY` to a qualified
bounded value (initially four, maximum eight). The scheduler rejects serial
callers in relay mode, so a missing relay cannot silently bypass the source
restriction. Existing serial leases still retain their cooldown during a mode
transition.

The relay's systemd unit runs as its own user, bounds memory to 128 MB and CPU
to 25%, and supervises restarts. Store its configuration outside the source
tree with root ownership and service-group read access. The certificate deploy
hook updates only this relay's certificate and reloads it after renewal.

## Recovery and evidence

Change the scheduler back to serial mode before removing relay secrets. Wait
for active relay work to drain; no request may fall back directly to the registrar.
Preserve each tenant's DB, encryption root, gateway key, identity, schedules,
ingress and assets during release. Retain private resumable deployment receipts
and verify exact runtime engine/source headers after deployment propagation.

Private `POST /status` on the scheduler binding returns only queue counts,
mode, concurrency, and timing. It never returns workspace IDs or lease tokens.
Monitor backlog and queue time before raising concurrency further. One successful
request or a synthetic burst does not qualify sustained multi-user operation.
