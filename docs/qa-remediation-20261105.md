# SaaS QA remediation · 5 November 2026

Release status: implementation verified locally; CI, merge and production
qualification are pending. This report distinguishes the named recovery repair
from the earlier runtime incident.

## Provisioning

Deterministic tests reproduced two unsafe replay paths: a lost database-create or
Worker-upload response followed by an absent provider read caused another write.
Both regressions failed before the repair. Setup now retains its original keys and
identity and returns an outcome-pending hold until the exact resource can be read
and qualified. It never treats a single absence read as permission to replay.
This also conservatively holds an attempted write after a known rejection when no
resource exists; operator reconciliation may be needed. No timeout, background
continuation, queue rewrite or automatic retry was introduced.

Native local Worker → service-binding RPC → setup Durable Object tests exercise
the existing trusted lease, lost create response, object reset, eight concurrent
retries, a deliberately pending module read, serialized cleanup and stale calls
after cleanup. They preserve one identity/pair, remove only registered synthetic
resources, and leave cleared storage empty. The original queue passes those
scenarios; removing serialization is unsupported.

The private single-record diagnostic contract and safe gateway correlation are
documented in [on-demand provisioning](on-demand-provisioning.md). Unit tests reject
provider body/key leakage and malformed upstream references. The production runner
retains stage/status/correlation before its mandatory cleanup.

The historical hung RPC at 14:27:56 UTC on 4 November remains **unexplained**.
The later storage reset is a separate provider-reported event, consistent with
[Cloudflare's reset documentation](https://developers.cloudflare.com/durable-objects/observability/troubleshooting/).
Native fault tests and later successful production runs demonstrate recovery;
they do not establish the cause of that hang. Instrumentation and this distinct
replay repair must not be reported as proof that the historical P1 is fixed.

## Dependencies and pinned artifact

The exact compatible lock updates are body-parser 2.4.0, fast-uri 3.1.9,
ip-address 10.7.6 and qs 6.17.1. No override or forced major was added. The refreshed
production audit reports zero vulnerabilities. The full audit retains 29
development-tool findings (28 moderate, one high); those are not suppressed or
described as production clearance for development tooling.

The engine provenance includes the complete build lock, so the dependency update
requires a newly packaged `2.0.0-hosted.3` artifact. Its source digest is
`a6b2368a88b62f92e724e384ad59ad371ed9165a5cac0f6e512c89bae467e258` and
archive SHA-256 is `663ee4109cea69e7c50278fe501778219f8f996e692f105addad3f3615ed34b1`.
The embedded source lock includes the fixes. Engine integrity verification passes.
The package does not change customer schemas or registrar behavior.

Bounded local advisory contracts test malformed URI scheme rejection and AJV
references, IPv6 parsing/rate-limit grouping, query/form parsing and hostile comma
coercions. A separate local process accepts a valid compressed body with trailing
bytes without crashing and serves a following JSON request. These payloads never
reach production.

## Controlled acceptance

`scripts/inquiry-qualification.test.mjs` uses disposable non-production D1,
real public/internal routes and signed admission, with captured mail and a mocked
Turnstile verification transport. It exercises submission, mail confirmation,
owner/sender conversation, private-note exclusion, replay, limits, bad challenge
and unknown-delivery reconciliation. No mail is sent and no actual CAPTCHA is
solved. Production Turnstile and external delivery remain unqualified.

`node scripts/passkey-browser-qualification.mjs --check` qualifies the disposable
local account page and real WebAuthn registration options. Running without
`--check` serves `http://localhost:5197/__qualification/session`. The isolated
bundle translates the RP/origin constants and permits that exact loopback origin;
production source, RP and HTTPS guards stay unchanged. Only local fixture sessions
and credentials are affected. A virtual test authenticator can enroll, sign out,
log in, test stale authentication with same-origin `POST
/__qualification/stale-auth`, reauthenticate and remove the key. Status is available
at `/__qualification/status`; Ctrl-C disposes the runtime. The real ES256 protocol,
fresh-auth and replay regressions also pass in `passwordless.test.ts`.

Actual browser completion is pending access to the locked Mac. Physical-device
credential creation requires user takeover. Browser/virtual-device success would
still not qualify the production RP or a physical device. Passkeys and inquiries
never use an import QA lease or relax its cleanup allowlist.

The analytics API returned HTTP 403 for the existing operator token. The exact
service control must be inspected/applied through an authorized existing browser
session or appropriately scoped access. No CSP, WAF, Turnstile, JavaScript
Detections or cache policy was relaxed. Analytics/CSP acceptance remains pending.
QQ/163/126 delivery, mainland connectivity and real registrar/marketplace writes
remain the exact controlled-fixture/provider holds from the reviewed plan.

## Verification and rollout

Local verification passed typecheck, lint, engine integrity, 2,709 tests with one
deliberate manual skip, four security regressions, four relay checks, all six Worker
dry runs, web/demo/site builds and the existing local import allocation/readback
qualification. The later inquiry fixture adds one test; final CI must include it.
Focused reruns are not added to the unique test count.

Read-only production preflight found 55 accounts, 44 admitted tenants, zero active
QA leases and zero unfinished requested allocations. Protected custody retains
current code/settings, D1 recovery exports and credential/publication fingerprints.
Rollout uses that refreshed roster and exact live bindings, preserving tenant
keys, identities, coordinator namespaces, publication revisions, quotas, flags
and schedules. The final managed import canary and independent cleanup must use
the final deployed candidate. Append deployment and CI receipts only after they
are observed.
