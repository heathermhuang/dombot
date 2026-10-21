# Hosted UI/UX completion plan — 21 October 2026

## Outcome and scope

Complete the ten findings from the page-by-page review of fork `8480453`, preserving the existing design context and private/public boundaries. Ship a coherent, recoverable workflow for cross-registrar inventory, selected public sites and domain inquiries. This is an implementation and release plan, not a claim to outperform every domain platform.

## Competitive benchmark

Official product documentation reviewed on 21 October 2026. These describe competitors' advertised capabilities, not independently measured task performance or customer outcomes.

| Platform | Relevant reference | Bar for this release |
| --- | --- | --- |
| Efty | [Portfolio management](https://support.efty.com/category/48-managing-your-portfolio): bulk import/update/edit/export | Maintain efficient portfolio operations and actionable empty states. |
| Dynadot | [Smart folders](https://www.dynadot.com/help/question/what-are-smart-folders): grouped registrar operations | Keep account, expiry and auto-renew visible while retaining grouped actions. |
| Afternic | [Sales landers](https://www.afternic.com/sales-landers) and [Portfolio Agent](https://blog.afternic.com/portfolio-agent/): task-specific landers and reviewed agent actions | Clear buyer modes, explicit review, predictable bulk actions; AI access alone is not differentiation. |
| Spaceship | [SellerHub](https://www.spaceship.com/en-GB/sellerhub/): imports, pricing and buyer messaging | Preserve inquiry work and follow-ups across navigation. |
| Atom | [Bulk Domain Manager](https://www.atom.com/blog/introducing-the-bulk-domain-manager/): bulk tags/prices with previews | Repeated bulk changes must succeed while retries remain idempotent. |
| Sedo | [Bulk uploader](https://sedo.com/us/about-us/news-press/newsroom/sedo-releases-new-bulk-domain-uploader/): spreadsheet synchronization | Keep import/export and portfolio organization usable; avoid adding an unqualified marketplace integration. |

Positioning: an independent cross-registrar workspace with explicit selective disclosure and reviewable operations. Marketplaces retain strengths in distribution, payments, brokerage and transfer services; no equivalence or superiority in those areas is claimed here. A universal ranking requires consenting comparative user task studies beyond this engineering release.

## Implementation decisions

1. Preserve `legacy=1` through legacy settings/preview/review navigation. Regression must reproduce the real route boundary.
2. Adapt the existing Domains table for mobile without changing the inventory schema or routing v2 through the v1 publication editor. Show account, expiry, lifecycle and auto-renew; retain secondary operations under details. Keep desktop table sorting and selection.
3. Store inquiry reply and private-note drafts separately in document memory, scoped by hosted path and inquiry. Never persist buyer text to localStorage. Preserve retries' request keys and warn on document exit while unsent text exists.
4. Derive the follow-up input from the saved reminder until the user edits it; provide explicit removal.
5. Give each completed bulk operation a fresh key while retaining the key for retries/recovery of an unfinished operation.
6. Retry both hostname and domain-control data sources when recovery is requested.
7. Fit the navigation row to the available width; retain complete menu navigation below its safe breakpoint.
8. Distinguish empty search/filter results from first-use onboarding and offer clear filters.
9. Match default sort options to the actual hosted inventory format.
10. Use one site-edit navigation row and contextual actions; simplify internal qualification/mode wording in Sales. Do not merge independently published sites and shops implicitly.

## Verification and release order

- Verify focused behavior and meaningful regressions for navigation, inquiry drafts, follow-up conversion and operation keys. Retain existing coverage.
- Browser checks on synthetic fixtures at 390, 768 and 1280px, plus wide desktop: mobile facts, header fit, private/public editor journey, route/back preservation, repeat bulk action, retry recovery and keyboard controls. Fixture results do not establish backend persistence.
- Repack the pinned tenant engine; install its exact archive and verify hashes.
- Run CI-equivalent root/hosted typecheck, lint, unit/security tests and web/demo/site/Worker dry-run builds. Review the final diff.
- Commit/push a scoped PR; monitor required CI, merge when green under the user's end-to-end authorization.
- Inspect current deployment topology and existing release scripts. Promote the exact engine using the supported preservation workflow; never use stale tenant counts or template configs as live truth. Verify exact deployed revision and runtime/UI behavior. No real registrar writes, buyer messages, purchases or customer content publication are needed for these UI fixes.
- Record code, CI, deployment, browser results and outstanding human/device evidence separately. Physical-device and comparative user-study results require actual observations; never substitute a desktop viewport for them.

## Acceptance record

Implemented all ten review findings, plus the globally colliding table-scroll CSS that overlapped pagination. The focused review also required preserving legacy mode through inventory, clearing stale all-matching selections after bulk completion/recovery, and clearing compose drafts after successful inquiry deletion.

Local browser evidence (synthetic data): reply/private-note navigation retention; saved reminder populated with unchanged Save disabled; mobile and tablet inventory at 390/768px without horizontal overflow; desktop header right edge 1256px at 1280px; one Preview and one Review control; two successive bulk receipts with distinct keys; no-match Clear filters; domain-control Retry recovers; legacy edit → preview → inventory → review retains legacy mode. Screenshots and receipts are retained locally under `output/ui-ux-fixes-20261021/` in the primary workspace.

Typecheck/lint and engine integrity pass. The full suite passed 1,381 tests (one skipped), plus four security regressions. Final CI runs the required checks again for the exact commit. The engine artifact is `1.5.0-hosted.21`. Public/account branding and release security boundaries are unchanged. Physical-device, independent comparative user-study, real email and paid registrar-operation evidence are not claimed.

Release/deployment receipts remain private operational artifacts; they must be inspected before declaring rollout complete.
