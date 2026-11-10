# Reviewed bulk lander code deployment · 11 November 2026

PR [#214](https://github.com/heathermhuang/dombot/pull/214) is merged and its code,
additive schemas, pinned engine/UI and future template are deployed. Automatic
DNS connections remain **disabled** pending live provider and fixture
qualification. No customer DNS, nameserver delegation, paid entitlement or
external-contact message was changed or initiated by this rollout.

## Released artifacts and scope

- Engine/UI: `2.2.1-hosted.3`; registrar SDK remains `1.2.1-hosted.1`.
- Application, gateway and edge source:
  `31b3592854035e4f02a61ecda664c8aecec4c518`.
- Engine source digest:
  `915838e6904df1d8eabba96b7023e0c4bb19c816ba0d5a7fdb6afa6ad802a4c4`.
- All 48 original admitted portfolios and the qualified future template.
- Control migration `0026_lander_connections.sql` and tenant migration
  `0012_lander_connections.sql`; existing records remain intact.
- Backup format 17/Sales v5. Retain a compatible recovery reader; importing
  recovery snapshots never resumes jobs, publications or DNS authority.

The gateway explicitly has `LANDER_CONNECTIONS_ENABLED=false` and an empty
connection-workspace list. The original allocation policy was restored after the
rollout. The future template retains all 16 qualified bindings, including service,
proxy and feature settings; it was not replaced by the default minimal template.

## Review and verification

The review corrected four supported issues: unknown forward-write restoration,
mail/service dependencies introduced after review, cleanup after control-loss
epoch advancement, and failed-preparation lock/resource recovery. New manual
hostname plans also clear stale connection provenance so old cleanup cannot
remove a newer setup. See the [consolidated review](lander-review-20261110.md).

[Exact-head CI](https://github.com/heathermhuang/dombot/actions/runs/42841475745)
passed 3,303 unit tests with one existing skip, root/Worker/hosted typechecks,
lint, engine and changelog validation, security and relay suites, required builds
and all Worker dry runs. Both CodeQL analyses passed. The focused recovery and
hostname suites passed 39 tests. Unchanged desktop/mobile synthetic evidence
covers multi-page selection, exact neutral content, reauthentication return,
one confirmation and reopening a job after tab closure; it does not qualify live
provider DNS behavior.

A controlled code canary preceded the fleet rollout. Every original portfolio
passed exact module/settings and live engine/source checks. Forty-one configured
coordinators retained their original maintenance policy and pause state. Trusted
ordinary-role production QA verified sign-in, zero allocation on open/preview,
one allocation on valid import, two idempotent retries, readback, the new engine,
a disabled lander configuration, denied connection creation and zero jobs.
Independent cleanup completed with original accounts/resources preserved.

All 68 public HTTP checks passed, covering 28 public listing pages, two profiles
and the two original active custom hosts. Source attribution is current and the
public directory has no conflicts. These are technical/synthetic observations,
not evidence of new customers, additional traffic, inquiries or sales.

## Preservation and recovery evidence

Original 62 users, 586 workspace identity rows, 43 platform mappings, credential/
settings and publication fingerprints, original inquiry/message payloads and
notification choices were preserved. Active custom-host configuration and all
shared claim ownership fields remain unchanged. Two normal lease timestamps
advanced; the original complete claim checksum was reproduced and every
non-timestamp field compared exactly. No production record was altered to make
that check pass.

Protected recovery custody contains 51 code/settings snapshots and 49
Cloudflare-hosted bookmarks. Database contents and root keys were not exported.
Interrupted uploads were reconciled against exact original or target state;
original admission and scheduling were verified before continuation. Temporary
asset-upload tokens are scrubbed from the durable recovery copy.

Operational evidence is retained privately under
`.wrangler/bulk-lander-release-20261110/` in the primary workspace. The date in
that directory records the operation's start date. Final checks show zero active
QA runs, zero unfinished allocations, and zero connection jobs or recovery
archives in the original portfolios.

## Activation remains separate

The initial deployment does not qualify a DNS provider or root/www endpoint.
The prior read-only SaaS check returned HTTP 403 under the existing operator
credential; the specific missing permission or entitlement is not established.
Service access/configuration and an exact owner-authorized unused fixture are
still required before reversible live DNS/TLS/ordinary-HTTPS qualification and a
scoped activation. Do not substitute arbitrary holdings or old sample domains.
Shared Domains.Domains authoritative nameservers remain a separately consented
follow-on service.
