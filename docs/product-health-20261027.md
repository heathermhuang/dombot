# Product health — 27 October 2026

**Status: attention required.** Targeted owner Dynadot syncs currently pass, but
the reported demo failures have not been reproduced or explained. Runtime
exceptions exist in the platform measurements. Passing code checks do not clear
the product's operational health.

## Production observations

Captured through the existing Cloudflare login and connected owner MCP endpoint.
No credentials, domain lists, private customer identities or access URLs are
included in this report.

| Observation | Result | Time / qualification |
| --- | --- | --- |
| Registered user accounts | 42 total, 38 enabled | 27 Oct 05:00 Singapore / 26 Oct 21:00 UTC; includes operator and test accounts |
| Enabled workspace slots | 519 | Capacity, not customer count |
| Unclaimed qualified platform slots | 481 | Enabled, signup-qualified and without a user; not the raw signup-enabled registry count |
| Owner portfolio | 940 cached domains across eight configured accounts | Other providers were not refreshed during this investigation |
| Owner Dynadot accounts | Four successful targeted syncs: 666 + 57 + 50 + 18 = 791 domains | 27 Oct 04:55–05:00 Singapore; no returned errors |
| Latest owner sync-error alerts | None when initially inspected | Latest-state alerts cannot reconstruct prior failures |
| Gateway runtime sample | 44,235 success outcomes, 1,045 client disconnects, four script exceptions | 24-hour window ending 27 Oct 04:59:42 Singapore; platform outcome categories, not HTTP/business-success counts |
| Product runtime exceptions | Five across two scripts: four gateway and one tenant | Same 24-hour platform sample; not attributed to the demo |
| Historical exception log query | HTTP 403 | Exact request/exception messages unavailable through the current Cloudflare login |
| Deployed gateway source | `c716eb3c8cc5bb26e3e835efd5797a786a3cce33` | Verified against live settings and current fork main |

The population changed from 40 to 42 accounts during the investigation. Counts
are point-in-time readings; neither test accounts nor disabled users have been
silently treated as active customers.

## Findings and diagnosis

1. **Monitoring misreported its scope.** The existing `/health` handler returned a
   fixed OK and a foundation-era version string without checking its database.
   The proposed change probes control storage, returns 503 on failure, and labels
   its scope `gateway-storage`. It does not claim registrar or fleet health.
2. **Successful retries erase the visible sync error.** Each registrar cache keeps
   `lastError` and `lastErrorAt` only for its latest failed state. Success sets
   both to null. Thus an empty alerts list after recovery is not evidence that
   the demo had no failures. This is confirmed by the source's success/failure
   branches, independently of the live successful sync results.
3. **The demo's provider is now known: Dynadot.** Its current path includes both
   provider serialization/cooldown and managed proxy handling. Transport failure,
   throttling, provider rejection and a gateway/coordinator fault remain
   hypotheses. The current four successful syncs do not select among them.
   No speculative provider retry or proxy changes were made.
4. **Runtime exceptions require follow-up.** Platform metrics confirm their
   existence; the unavailable detailed logs prevent a defensible claim about
   exact cause, affected request or demo correlation. Client disconnects are
   reported separately and have not been classified as application errors.

Next diagnostic input: a retained Dynadot failure message or correlated event
time, or working read access to the relevant Worker log dataset. Check the
affected provider account, gateway proof outcome, proxy queue wait, transport and
provider response under the same correlation ID before changing retries.

## Implemented administration

The proposed `/admin` area provides system/storage status, user search and detail,
per-user owned/imported/archived counts, aggregate observed counts, configured
registrar states, last success timestamps and retained operation outcomes. It
records unavailable observations durably and distinguishes stale or unknown
readings from zero. It is restricted by operator-owned immutable user IDs and
fresh authentication. See [the complete feature and rollout plan](admin-feature-plan.md).

The dashboard is **implemented and locally verified, not deployed**. Production
still runs the prior health endpoint and does not have the new metrics schema.
Activation requires identifying the intended existing operator sign-in, applying
the additive control migration, canarying the coordinator/wrapper and releasing
the gateway and fleet. The operator allowlist defaults to empty.

## Verification

* All three TypeScript configurations: pass.
* Repository lint: pass, zero warnings.
* Full suite: 146 files, 1,591 tests passed, one pre-existing skipped test.
* Security regression suite: four passed.
* Fixed-source relay checks: four passed.
* Pinned tenant engine integrity: pass; engine remains `1.5.2-hosted.11`.
* Web renderer build and gateway/tenant Worker dry-run bundles: pass. The renderer
  retains its existing large-chunk warning; admin HTML adds no client bundle.
* Local browser: mobile overview, search to one matching user, user detail and
  error history verified with synthetic data; no console errors observed.
* Admin tests cover anonymous/customer denial, fresh-auth requirement,
  fail-closed configuration, CSRF, signed internal observation isolation,
  real-engine import counts, unknown/unavailable coverage, safe classifications,
  deduplication/archive semantics, escaping, audit and health failure behavior.

These are implementation checks and controlled local runtime evidence. They do
not constitute production rollout, formal security clearance, physical-device
acceptance, uptime certification or a resolved Dynadot incident.
