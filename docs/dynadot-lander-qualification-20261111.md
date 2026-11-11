# Dynadot DNS lander candidate

The owner selected unused `015.io` and explicitly authorized a one-domain move
from Park.io to the existing Dynadot account, with no email or custom DNS services
to preserve and the old Park.io delegation retained for rollback. This is a
separate, one-time DNS-provider migration; ordinary lander jobs retain nameservers.
No delegation or DNS record has yet been changed at this checkpoint.

The candidate engine is `2.2.1-hosted.4`. It adds native Dynadot DNS discovery,
apex ANAME and www CNAME planning, append-only creation and exact-record removal.
It never calls the SDK's whole-zone replacement operation. Full native objects,
unrelated records and the provider-wide TTL are retained. The adapter requires
the exact enabled account, its credential fingerprint, DNS mode, matching
nonempty assigned/public Dynadot nameservers, complete bounded native records and
DNSSEC reads. Unsupported forwarding, duplicate records, ambiguous accounts and
record-capacity shortfalls are holds. No nameserver or DNSSEC mutation is part
of the adapter.

`DOMBOT_LANDER_DNS_PROVIDERS` is an explicit, host-owned per-portfolio provider
list. Its default is Cloudflare only. Adding a connected Dynadot account or
qualifying Cloudflare cannot admit Dynadot writes. Discovery and forward
execution require explicit native-provider qualification; revocation stops new
preparation/writes while preserving recovery of an already approved operation.

Separate durable removal/append intents accommodate the provider's lack of a
record-update operation. Ownership/certificate proofs precede web changes;
both web removal and creation require TLS readiness. The lease is checked again
immediately before an external mutation is sent. Full readback verifies the
changed record, every retained record and native metadata, and shared settings.
Ambiguous submissions are not replayed. Recovery verifies exact record state
before reversing each intent and preserves later conflicting changes.

Backup format 18/Sales v6 retains Dynadot recovery. Older supported files remain
readable; imports retain private recovery and never resume jobs or grant DNS
authority. Retain this compatible reader after accepting the new format.

The native API contract was inspected in Dynadot's current primary documentation:
[append](https://www.dynadot.com/domain/api-document#set_dns),
[selective removal](https://www.dynadot.com/domain/api-document#remove_dns), and
[complete DNS reads](https://www.dynadot.com/domain/api-document#get_dns).
Fixture tests are not live API proof. The exact selective-removal request and
complete preservation, root/www DNS/TLS, ordinary public HTTPS and restoration
must be qualified on the authorized fixture before activating this provider.
The Dynadot browser session is currently signed out; an owner sign-in handoff is
prepared. Automatic connection flags remain disabled.

## Existing service hosting is now verified

PR [#216](https://github.com/heathermhuang/dombot/pull/216) deployed gateway-only
source `d9daa40c6f28192c72295823c851b834e72ba132`. Exact-head CI passed 3,310 unit
tests with one existing skip, four security tests, four relay checks, required
type/lint/build checks and CodeQL. Eleven public checks and trusted production
sign-in/import/two retries/readback/disabled-gate/cleanup qualification passed.
Original bindings, assets, schedules, account data and routes were preserved;
final active QA and unfinished allocation counts are zero.

The private service-bound inspection, using the existing secret in place,
returned HTTP 200 for custom-hostname reads and the fallback origin. The fallback
`portfolio-origin.domains.domains` is active; the observed custom-hostname count
is zero. This count is existing usage, not a quota entitlement. The earlier CLI
OAuth HTTP 403 did not establish that this service credential lacked access.
Existing tenants/template/edge remain on the preceding `.3` engine and source;
this hosting correction did not change DNS or enable the connection feature.
