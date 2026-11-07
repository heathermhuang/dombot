# Park.io owner-only feasibility pilot

This is a temporary diagnostic at `/admin/parkio-pilot`, not a customer connector
or an inventory import. It uses the existing domains.domains account, admin and
fresh-authentication checks, restricted to one explicitly configured owner ID.
It does not create users, allocate portfolios, modify registrar settings, write
portfolio inventory, or change tenant engines.

## What the owner tests

1. Open the private pilot page while signed in to domains.domains. Complete the
   normal fresh authentication if requested.
2. Choose **Sign in to Park.io**. The same embedded browser opens on every device.
   Touch capability is detected automatically, including tablets with desktop
   user agents. On a phone or tablet, tap a field in Park.io, then tap **Phone
   keyboard** below it to open the native keyboard. **Next field**, **Delete**
   and **Enter** control the same form. On a computer, type directly in the
   embedded browser. Enter credentials/MFA there, not in chat.
3. For this first contract-qualification run, navigate to **Orders → Active**.
   Return to the original pilot tab and choose **Inspect Active export**.
4. Choose **Save session and close browser**. The server reads the Active CSV
   inside the authenticated remote browser, validates the schema, encrypts a
   candidate cookie jar and baseline, then verifies that the browser has closed.
5. Choose **Test saved session from Worker**. An ordinary Worker HTTP request
   downloads the same export with the saved cookies, without a browser. The
   report compares normalized domain names and every available expiration date.
6. A later manual check can measure short-term session survival. Close/clear the
   pilot when finished. The alarm also removes encrypted test session data after
   its 24-hour retention period.

The extra inspection steps are specific to the first pilot because the real
Active CSV contract has not yet been inspected. The proposed customer experience
remains connect, sign in, and automatically see holdings once that contract is
qualified. A completed pilot does not establish a permanent login or public
readiness. `accountIdentityQualified` remains false until a separate stable
provider-account identity contract is proven.

## Admission and lifecycle

Enablement requires **all** of:

- `PARKIO_PILOT_ENABLED=true`.
- `PARKIO_PILOT_OWNER_ID` matching the existing sole owner/admin to be qualified.
- A future `PARKIO_PILOT_EXPIRES_AT` timestamp.
- A random Worker secret `PARKIO_PILOT_SECRET` of at least 32 characters.
- Browser Run binding `PARKIO_BROWSER` and the private SQLite-backed
  `PARKIO_PILOT` Durable Object namespace.

The committed configuration is disabled and contains no credentials. Preserve
the gateway's live bindings, asset policy, feature flags, secrets and schedules
when preparing a deployment; the generic staging template must not replace them.
Only the reviewed Browser Run binding, owner pilot namespace and pilot variables
are new. No tenant fleet rollout is required.

An active login lasts ten minutes with a three-minute browser idle timeout.
Repeated start requests reuse that attempt. Three browser acquisitions per UTC
day and three Worker comparisons per captured session bound the pilot; checks
are at least one minute apart. An uncertain acquisition is held instead of
blindly retried. Cleanup attempts are bounded; failed cleanup blocks new browser
starts and requires operator reconciliation. Cookie state is removed on cancel
and retention expiry. A failed browser close cannot produce a portability pass
or reopen the captured browser through the application.

Do not rotate the pilot secret, change its owner ID, remove the namespace or roll
back its class while a login/cleanup obligation exists. First close and clear
the owner attempt, verify the browser resource is gone, then disable/remove the
feature. Expired/disabled application admission does not replace actual browser
cleanup. Disabling the gateway route alone does not revoke an already connected
Live View; the browser must close.

Starting again reconciles an idle-closed or expired browser before acquiring its
replacement in the same request. The deployed native binding returns an exact
`BrowserBindingError: Session not found (status=404)` for a closed session,
despite its nullable type declaration. Only that specific absence response (or a
normal null/ended result) qualifies as closure; unrelated lookup failures hold.
Recovery retains the daily acquisition count and cleanup limits. Browser
navigations receive a branded recovery page rather than raw diagnostic JSON.

## Private data and read boundaries

No session recording, screenshot collection, analytics, raw provider exceptions,
browser endpoints or cookie values are exposed by the status response. Live View
URLs are bearer credentials and are issued only after owner authorization; they
are never persisted in the diagnostic record. Existing gateway observability
must retain disabled tracing/invocation payload capture and query redaction.

The cookie jar and baseline are encrypted under an owner-bound HKDF/AES-GCM key
in Durable Object storage, separately from customer data. Authentication-cookie
selection is a conservative first-party pilot profile and must be tightened from
real-account evidence before a customer connector. Unsupported partitioning and
unsafe values stop the test. Rotation observed during the post-closure read
stops further use until its persistence contract is qualified.

Only a single export link discovered on the authenticated Orders page can be
used. Its HTTPS origin, export path and query names must pass the narrow policy.
The operator must confirm the Active view; this pilot does not infer current
holdings from arbitrary paid/order-history exports. Automatic redirects are
disabled for browser and Worker export reads. Other operations, origins, encoded
paths and management actions are rejected before sending credentials.

Responses are limited to 2 MiB and 10,000 rows. The CSV reader rejects HTML login
pages, malformed quoting, conflicting duplicates and ambiguous dates. It accepts
only explicitly recognized domain/expiration header aliases and ISO calendar
dates. An unknown real export schema is a qualification hold, not an empty
portfolio. The public login page was anonymously verified at `/users/login`;
the private export schema and account identity have not been verified yet.

## Implementation and verification

Gateway integration adds an isolated, disabled owner route and a Fetch-based
Durable Object. The native Browser Run SDK types are a hosted-only development
dependency because the gateway's existing generated runtime declarations predate
session-management methods. The pinned tenant engine and its dependency graph
remain unchanged. Browser commands use the native binding rather than an account
API token or an additional browser-automation client library.

Focused tests cover unsafe export destinations, cookie serialization, malformed
CSV, date/size limits, owner/root-bound encryption, disabled/expired admission,
owner/CSRF/fresh-auth checks, idempotent start, server-side capture, verified
closure, post-closure comparison, clear/retest rejection and cleanup failure.
Native Worker fixtures use synthetic data and loopback origins; no Park.io
credentials are used in automated tests.

The mobile page works around Live View's canvas not invoking the phone keyboard.
Its secure native input forwards text directly over the short-lived Cloudflare
WebSocket to the same remote tab. Text is cleared immediately and is not sent
to the gateway, logged or stored. Input is restricted to focused fields on the
Park.io HTTPS origins. The owner-only connection response is uncached; its
capability URLs are not included in the page HTML or status record. Leaving the
page closes its socket and clears pending input. Existing login/browser expiry
and cleanup limits still apply.

Anonymous synthetic-form checks with the actual Cloudflare viewer/socket passed
in mobile-sized Chromium and WebKit: native input focus, username/password
typing, deletion, one submission, no retained local input and no input HTTP
requests to the gateway. The anonymous browser was closed afterwards. These
checks do not establish physical iPhone keyboard behavior or a real Park.io login.

Debug report: Miniflare rejected non-loopback Origin headers before fixture
routing; using the established localhost fixture origin fixes that test
transport. The first class implementation imported `cloudflare:workers` into
Node-based gateway tests; the isolated Fetch-based object removes that runtime
dependency without weakening owner admission. Regression tests exercise both
the pilot lifecycle and existing account/admin flows.

Before enabling a live pilot, require the repository typecheck/lint/full test
suite, separate security regressions, relay checks, engine verification, changelog
checks and gateway dry-run bundle. Preserve the exact deployed source and
configuration receipt. A real user sign-in and an actual post-browser-close
Worker read remain separate evidence from these automated checks.

## Results to retain

Record candidate/source and adapter versions, start/closure/check timestamps,
column contract, selected cookie names/attributes (never values), domain count,
domain-set agreement, expiry agreement, rotation/challenge/rate-limit class and
cleanup result. No raw CSV or private holdings belong in a committed receipt.
Extend qualification to time-separated reads and stable account identity before
building the full scheduled customer integration.

## Preparation receipt, 6 November 2026

- Maintained base: `5fa7e95f` (refreshed in an isolated checkout).
- Root/Worker/hosted typecheck, lint, changelog validation and gateway dry-run:
  passed. Pinned engine `2.1.0-hosted.3` verification passed without rebuilding
  or changing the tenant artifact.
- Focused contract/runtime/CDP coverage: 36 tests. Existing admin/passwordless plus
  pilot runtime regression run: 69 tests passed.
- Full local run: 269 files passed; three files encountered macOS loopback
  `EADDRNOTAVAIL` failures. All 101 tests in those three files passed in one
  bounded serial rerun. Retain that distinction; require normal hosted CI.
- Separate security suite: four tests passed. Relay checks: four passed outside
  the filesystem/network sandbox, after sandboxed loopback binding was rejected.
- One anonymous Browser Run session was acquired with hostname restrictions,
  a login target was created, and the session-close API reported `closed`.
  Target creation alone does not prove document load, challenge handling or
  successful authentication. No real Park.io session or holdings were captured.
- Live gateway binding/observability metadata was read into protected local
  custody for deployment planning. No production settings or resources were
  changed as part of preparation.
- CI CodeQL initially flagged dynamic browser-code construction and a test-only
  chained HTML decode. Browser URL/limit values now use CDP arguments to a static
  function; diagnostics tests use the protected JSON status route. Dedicated
  regressions cover argument separation and remote-object cleanup on exceptions.

## Native form verification, 7 November 2026

Before deployment, a real local Chrome submission reproduced `Origin: null` and
HTTP 403 with the original no-referrer document/form policy. The document now
uses same-origin referrers and the popup form uses only `noopener`. The external
Live View redirect response alone suppresses the referrer. This preserves native
POST Origin headers without allowing null-origin requests through CSRF admission.
The browser reproduction then reaches the synthetic sign-in view with HTTP 303;
the runtime regression checks both policies and rejects an explicit null Origin.
This check uses synthetic data and no real Park.io login.
