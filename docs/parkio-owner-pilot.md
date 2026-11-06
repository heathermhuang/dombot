# Park.io owner-only feasibility pilot

This is a temporary diagnostic at `/admin/parkio-pilot`, not a customer connector
or an inventory import. It uses the existing domains.domains account, admin and
fresh-authentication checks, restricted to one explicitly configured owner ID.
It does not create users, allocate portfolios, modify registrar settings, write
portfolio inventory, or change tenant engines.

## What the owner tests

1. Open the private pilot page while signed in to domains.domains. Complete the
   normal fresh authentication if requested.
2. Choose **Open Park.io sign-in**. A temporary Cloudflare Live View tab opens
   Park.io's actual login page. Enter credentials/MFA there, not in chat.
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
- Focused contract/runtime coverage: 34 tests. Existing admin/passwordless plus
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
