# Integrated public publishing qualification

31 October 2026. Implementation covers P1–P6 from the exact accompanying reviewed
plan. This record separates source checks, local synthetic observations and release
gates; it does not claim launch readiness, inquiry delivery or independent usefulness.

The isolated implementation starts from hosted fork `7a9a44c`; the dirty primary
checkout is preserved. Candidate engine is `1.5.2-hosted.29`, source digest
`9236b4a50b337c75334387deb04c84a2ba289a2691e245c75ad2eaa6e88abe3d`.
The archive, installed engine and web assets pass `engine:verify`.

## Code and local checks

- Typecheck and lint pass.
- All 178 unit suites pass: 1,885 tests, one existing skip. The final local run
  uses two workers after a four-worker attempt exhausted loopback sockets;
  remote CI retains the repository's four-worker check.
- Four security regressions and four fixed-source relay checks pass.
- Web/demo/site builds and six required Worker dry-run bundles pass. Changed
  gateway, tenant and provisioner bundles were repeated after bootstrap repair.
- New behavioral tests cover scoped disclosure, unrelated draft preservation,
  lost-response receipts, zero-row guards, injected transaction failure, current
  and last-domain withdrawal, strict v3 links, standalone changed terms, imported
  and duplicate-account rejection, tenant mismatch, expiry, backup identity,
  signed gateway admission, flags-off withdrawal and 1,000/20,000-name pagination.
- The 100-name composite budget fixture used maximum descriptions, categories
  and contact-identity lengths. It committed 100 public rows in about 737 ms on
  local Miniflare; 101 entries were rejected. This is synthetic wall time, not a
  customer latency measurement or a platform-wide performance claim.

The full suite exposed and repaired new-table classification in empty-tenant
maintenance and trigger-body splitting in on-demand bootstrap. The real schema
bootstrap, repeated bootstrap and empty-tenant sleep checks now pass. No scheduler
policy, provider routing, credential or customer publication is changed by these
checks.

## Browser observations

The first pass used source-built assets and local synthetic inventory only. Three
names remained selected across three searches at 390px. The exact scoped review
showed profile identity and collection membership while retaining an unrelated
saved introduction privately. Publication and withdrawal each returned a durable
receipt. Anonymous readback after withdrawal contained neither the removed name
nor an empty catalogue/collection. Widths 320, 390, 768 and 1280 showed no horizontal
body overflow in the inspected flows; both themes and visible Tab focus were
checked. Source-pass screenshots are in `receipts/` and are labelled accordingly.

A signed gateway-admission bug discovered in the browser was fixed and regression
tested. The exact installed engine/UI pair also passed native Chrome 200% zoom: Chrome
reported “Zoom: 200%”, keyboard Tab/Space selected the exact name, and review and
publication returned a durable receipt. The local harness denies provider
requests and has no external mail transport. No real inquiry delivery follows
from these observations.

V3 recovery was separately exercised with `node scripts/publication-recovery-qualification.mjs`:
backup envelope 9, exact private draft retention under a rotated synthetic root,
revoked live projections, invalidated operational reviews and mandatory rebinding
all passed, with no provider or mail transport.

## Controlled release gates

Required CI/CodeQL, exact-candidate browser qualification, live-derived configuration,
protected backups and semantic preservation receipts remain required before release.
Deploy compatible readers with both new write flags off, then qualify only the
existing controlled QA tenant. Preserve all prior flags, source attribution,
immutable identities, reservations, grants, credentials, routing and schedules.

Broader activation remains held for a consenting, owner-selected pilot: seven days
and at least five completed owner workflows, including price maintenance and
withdrawal. Missing evidence retains the hold; no recurring automation is created.
Mailbox and DNS/customer-content boundaries remain in force.

The final responsive matrix also records all four widths in both themes under
`receipts/candidate-*.png`; the 1,000-name picker retained `sample000.example`
across cursor navigation. The inspector is available in legacy/inventory flows
without requiring conversion.

The normalized five-run before/after browser comparison used the same 1,004-name
synthetic inventory, light theme, 1280px viewport and warm loopback origins. Median
editor readiness changed from 511.0 ms to 534.7 ms (+4.64%, within the 20% bar),
with 21 initial requests on both versions. Transferred initial resources changed
from 445,049 to 487,905 bytes. These synthetic timings are not customer latency.
The 1,000/20,000-name presence fixtures returned the same bounded 76,734-byte
page; the first CI observation measured about 187/1,057 ms under its four-worker
load. Full browser timing at 20,000 names is not established by those API fixtures.

The first CI unit run completed 1,884 tests and exposed only the budget receipt's
macOS-specific temporary path. The corrected test uses `os.tmpdir()` and retains
the same publication and rejection assertions. The pinned archive was rebuilt.

## Preview correction

A final review found that the iframe preview omitted linked commercial prices
while the exact review text displayed them. The follow-up engine resolves the
current published revision and operational eligibility in one allowlisted query,
reconciles asynchronous results against the current reference, and displays
frozen staged Sales terms during combined review. Preview actions remain disabled;
stale, paused, mismatched and failed reads suppress unchecked terms without email
fallback. The same renderer now sorts linked prices with independent fractional
prices without changing either amount. New behavioral regressions cover these
paths and flags-off same-origin preview reads without private hydration.

The shared public/preview query selects only the minimal commercial projection,
not descriptions, categories, seller fields or encrypted Sales drafts. The
existing 100-name combined-commit limits and publication schema are unchanged.
Use `node scripts/publication-local-qualification.mjs --large --linked` for the
local synthetic linked-price preview fixture; providers and mail stay blocked.

The follow-up candidate is engine `1.5.2-hosted.30` (source digest
`2b4fed4aa02301e0c7494c9e1e8ab12ac36f948738b0718090a7c9e30df5f52b`).
Its full local run passed 1,891 tests with one existing skip across 179 suites.
The paired browser fixture displayed the exact synthetic USD 14,800 linked price,
with zero active inquiry links and zero mailto links in the iframe. The screenshot
is `receipts/candidate-30-linked-preview.png`. Native final-build zoom and broader
reader promotion remain explicit external gates while the Mac/approval are held.
