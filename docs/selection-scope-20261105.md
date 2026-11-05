# Selection scope and managed document title

Date: 5 November 2026. Candidate engine: `2.0.0-hosted.5`. Local verification passed; production release verification pending.

The hidden bulk-target behavior is inherited from upstream DomBot, including the integrated `ccb918deed20f8d01009970064027fcb021bac97` revision. Upstream stores Domains selection across navigation and derives its bulk targets from all shown domains rather than the filtered result. Activity independently has the same filter mismatch. This is not evidence that an ordinary first click on an empty selection selects hundreds of domains: prior selections can survive outside the visible result. The owner's exact preceding interaction sequence was not recorded.

Domains and Activity now keep selection local to the page. Search, every filter, Owned/Archive and navigation start a new selection; deliberate selections across pages and sorting within the same result remain. Removed rows are pruned without resurrection. Checkbox state, action counts and bulk targets use the same filtered result. The header checkbox labels its full matching-result scope across pages. Filter/navigation changes also reset the shift anchor and close pending bulk dialogs. Late completion of an earlier request cannot clear a newly selected result.

Pricing, notes, folder assignment, CSV export, ownership, marketplace and registrar actions all consume that bounded Domains target list. Registrar actions additionally retain the existing held/connected-account eligibility subset and permission/paid-operation gates. Activity's notes, ownership, dismissal and deletion actions use its bounded event selection. The separate public-profile editor already clears selection on filter changes; it was inspected without changing its publication model.

The browser tab title was a hosted branding omission: the shared renderer HTML retained `<title>DomBot</title>`. Engine packaging now brands the managed HTML as `domains.domains` and hashes the actual packaged assets. Standalone/desktop source titles and original-project attribution remain intact.

## Verification

The full local suite passed 258 files / 2,731 tests with the existing single manual skip. The final focused selection/table/package run passed 23 tests; the final desktop/mobile packaged-UI run passed all 11 scenarios, including delayed completion. Required typecheck, lint, security, relay and build results are retained in the private release records.

The unchanged `.4` browser assets fail the select-all → filter-to-one regression because the previous selection remains. Unit regressions exercise filter/navigation boundaries, pagination/sort preservation, pruning, invalid keys and stale request completion. A disposable local gateway/Worker fixture runs the actual packaged UI in official Chrome, blocks external requests, and checks pricing and notes saves, CSV content, folder assignment, ownership dialogs, Activity, shift selection, desktop/mobile and a delayed folder response after a filter change. All writes in this browser fixture concern reserved synthetic domains; no registrar, marketplace, public publication or customer action is used as a production acceptance fixture.

Run ordinary project checks and `DOMBOT_UI_QA_TOOLS=/absolute/temporary/tools node scripts/selection-ui-qualification.mjs` after starting `node scripts/import-allocation-qualification.mjs --sales`. Playwright remains in a disposable tools directory outside the project lock. Screenshots/results stay in private local artifacts.

Production release follows checked-head CI, fresh rollback snapshots, the existing controlled canary, drained tenant promotion, current binding/credential/publication preservation, future-template/provisioner/gateway agreement, live owner UI checks and trusted managed import/retry/readback/cleanup. Local checks and package builds alone do not establish deployment.
