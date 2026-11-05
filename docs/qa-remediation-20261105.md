# SaaS QA remediation · 5 November 2026

Released implementation: [PR #161](https://github.com/heathermhuang/dombot/pull/161),
source `403a4e976a47db9fed4d78062037545071e37cc6`, engine `2.0.0-hosted.3`.
[CI](https://github.com/heathermhuang/dombot/actions/runs/41943296107), merge,
staged deployment and production qualification passed. The
[sanitized release receipt](qa-remediation-release-20261105.json) records exact
module/deployment identities and preservation evidence. This report distinguishes
the named recovery repair from the earlier runtime incident.

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
log in at `/login?next=%2Faccount`, test stale authentication with same-origin
`POST /__qualification/stale-auth`, reauthenticate and remove the key. The fixture
does not provision a portfolio, so `/account` is its sign-in destination. Status is available
at `/__qualification/status`; Ctrl-C disposes the runtime. The real ES256 protocol,
fresh-auth and replay regressions also pass in `passwordless.test.ts`.

The browser handoff exposed the five-minute fresh-auth guard before enrollment;
no credential was created. The local setup link now starts a fresh initial session
when opened and refuses to reseed after a passkey exists. Its `--check` exercise
verifies expired-session refresh and this enrolled-key guard. Initial browser
attempts also reported generic noncompletion; those attempts are not claimed as
passed or as a demonstrated production defect. After the fixture handoff and
correct `/account` destination were established, native Chrome with a virtual
authenticator completed enrollment, login, forced fresh-auth enforcement,
reauthentication and explicit removal with user credential takeover. The local
server recorded successful verification and confirmed zero remaining keys; the
fixture was disposed. No production passkey code was changed. This qualifies the
local browser/protocol flow, not the production RP or a physical device. Passkeys
and inquiries never use an import QA lease or relax its cleanup allowlist.

A separate disposable localhost HTTP qualification reused the existing ES256
authenticator fixture through the real gateway routes. Enrollment, login,
challenge-replay rejection, stale removal rejection, reauthentication and removal
passed, leaving zero keys. This validates the local RP adapter and server wire
flow; it is separate synthetic protocol evidence, not another browser test.

The analytics and scoped-configuration APIs returned HTTP 403 for the existing
operator token. After the Mac was unlocked, native Chrome changed only the
configured `domains.domains` Web Analytics site from “Enabled excluding EU
visitors” to “Disabled”; reload confirmed persistence. The site and historical data
were retained. No manual snippet was installed. Analytics measurement is
intentionally disabled; the observed injected scripts had already been blocked by
CSP. Native Chrome found zero beacon DOM matches and zero analytics-related console
messages on auth/private pages at 390 × 844. Five public/auth HTML checks and three
managed account/onboarding/import HTML checks also found no beacon injection.
Strict CSP, cache/session policy, WAF, Turnstile and JavaScript Detections were not
relaxed or disabled.
QQ/163/126 delivery, mainland connectivity and real registrar/marketplace writes
remain the exact controlled-fixture/provider holds from the reviewed plan.

## Verification and rollout

Final implementation CI passed 255 test files and 2,710 tests, with one deliberate
manual skip, four separate security regressions, four relay checks, both CodeQL
languages and all required builds. Local verification also passed typecheck, lint,
engine integrity, all six Worker dry runs, web/demo/site builds, dependency
contracts and the existing local import allocation/readback qualification. Focused
reruns are not added to the unique test count. The local handoff helper correction
does not change a deployed module, dependency or engine artifact.

Production preflight captured all 55 accounts and the exact 44-tenant admitted
roster. Protected custody retains 45 D1 recovery exports, 46 code/settings
snapshots, prior template assets and credential/publication fingerprints. An
asset-session timeout and an HTTP 500/code 10013 upload each stopped rollout;
readback proved the original module/settings, original admission was restored,
and only then did a reconciled retry proceed. These are separately observed
provider incidents, not evidence explaining the historical hung RPC.

The controlled canary and all 44 tenants now serve the pinned engine/source pair.
Gateway/provisioner code and future-template agreement were verified, and original
allocation policy was restored. All 55 accounts, 540 pre-existing control workspace
identities, 39 platform mappings, 44 credential namespaces, two published listings
and two published portfolios were preserved, including publication revisions.
Existing canonical/legacy public routes and two active custom hosts passed. Eight
legacy Worker schedules, gateway schedules and the provisioner's cleanup cron were
preserved; unrelated bindings, secrets, flags and quotas were retained.

All 38 post-deploy HTTP checks passed. Final managed import run
`f4a7c5fa-d0f0-4d01-bf0e-35d543778009` proved zero allocation on open/preview, one
pair on Save, two unchanged retries and readback on the final candidate. Cleanup
independently confirmed zero run-owned Workers/databases/setup keys, no QA account
or session, scrubbed temporary credentials and preserved real accounts. No active
QA lease or unfinished allocation remains. Registrar/marketplace/payment writes
and external inquiry delivery were not used as fixtures.

## Reported filter-chip removal follow-up

The user subsequently reported that a chip's X had no effect. A disposable real
renderer with three reserved synthetic domains was exercised at desktop and
390 × 844 sizes: a TLD filter reduced three rows to one, and Pricing reduced them
to zero; one click on each X removed the chip and restored all three rows, including
while its dropdown was open. The menu wrapper already defaults to non-modal, so
the initial modal-click hypothesis was disproved. Coordinate clicks at the mobile
X target also passed. Raw touch injection is unavailable in the in-app browser.
The reported case is not yet reproduced; the exact chip/value and whether the
chip remains visible or only the rows stay unchanged are requested. No speculative
filter code change or additional engine rollout was made.

Follow-up: the feature-enabled, full-table Chrome touch fixture subsequently reproduced an inspector overlap at the visible Pricing X. The repair, native provisioning artifact-read fault tests and verified engine `.4` rollout are recorded in [home-provisioning-completion-20261105.md](home-provisioning-completion-20261105.md) and its release receipt. The earlier unreproduced result above describes the initial limited fixture, not the current outcome.
