# Coordinated weekly-review release

Status: coordinated release authorized; candidate qualification in progress. This stack changes read qualification and owner
views; it never changes registrar settings or automatically renews/archives a name.

## Merge and artifact order

1. #153: Gandi deadline interpretation and upcoming forecast (`hosted.42`).
2. #154: past-reported-expiry verification (`hosted.43`), stacked on #153.
3. #155: quote-observation/combined release PR (`hosted.44`), stacked on #154. This also
   hardens the Gandi read/write boundary for failed inventory syncs.

4. Full upstream DomBot 2.0.0 sync (`2.0.0-hosted.1`), stacked on #155.

Merge in that dependency order, retargeting/rechecking each head against the
updated main. Do not deploy intermediate engines. Only the final checked
`2.0.0-hosted.1` source/artifact/UI pair is the coordinated production candidate.
`hosted/dombot-engine.lock.json` binds its source/archive/Worker/asset hashes.
The registrar dependency is `0.15.1-hosted.1`, with cumulative patch/integrity
provenance under `vendor/`. Private customer review inputs stay outside Git.

## Prepared verification and release gates

- Required root/Worker/hosted typecheck, lint, engine integrity, unit/security,
  fixed-source relay and Worker/UI/demo/site builds must pass for the exact final
  input. CI and local results are separate from production acceptance.
- Local browser checks use the real renderer/core with an in-memory synthetic
  fixture and fake providers. No production credentials or records are used.
- Before rollout, refresh the protected, read-only production manifest and its
  account/credential/publication preservation baselines. A preparation snapshot is
  not permission to overwrite later changes. Exclude disabled, closed, unfinished
  and retired resources; reconcile any roster/configuration drift first.
- Retain protected D1 recovery points/exports, current deployed code/settings and
  publication payload/revision snapshots for the exact admitted roster. Never
  export fleet root keys. No schema migration, SQL customer-data repair, new
  secret, namespace, ingress or persistent schedule is required by this stack.

## Authorized coordinated execution

1. Verify the checked PR heads/merged source against the built candidate. Prepare
   the template with the existing `scripts/prepare-on-demand.mjs`; verify the
   candidate manifest and gateway/provisioner template hash agreement.
2. Use the existing release-preservation tooling and current live bindings. Drain
   in-flight work before changing a tenant's engine/UI; use the supported bounded
   admission sequence and restore its original state. Do not recreate resources,
   rotate keys, reset coordinator storage/alarms, clear cache or modify schedules.
3. Canary a controlled account first. Any new production QA identity must use the
   managed QA runner/lease and automatic cleanup; never seed an ad hoc account.
   Validate against synthetic records and zero registrar mutations. Existing real
   accounts remain read-only during acceptance.
4. Roll the qualified engine/UI pair across the refreshed admitted roster, then
   update the future template/private provisioner and compatible gateway source
   metadata as required. Retain the existing private QA entrypoint and two-minute
   backup cron. Match all unrelated bindings, assets, secrets and feature flags.
5. Verify the actual serving coordinator's engine/source headers, not only an
   uploaded outer Worker or registry version. Confirm native scheduling remains
   configured; no extra provider requests are needed to qualify these projections.

## Production acceptance

| Surface                   | Required observation                                                                                                                                                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Domains                   | Held past-expiry records have a separate verification notice/filter. Upcoming expiry keeps its original semantics. Unknown provider lifecycle is not labelled proven loss.                                                                         |
| Gandi cache compatibility | Old list and detail projections ignore unverified update timestamps for forecasting. Repeated reads and failed syncs preserve raw cache/quote ages and unrelated data. Corrected ordinary provider reads replace obsolete data normally.           |
| Renewals                  | Upcoming totals are explainable from current dates and exclude past planning dates. Legacy-date fallbacks and annualized estimate semantics are visible. No erroneous update timestamp is counted as a current payment deadline.                   |
| Quote coverage            | Owner and admin quote-age/source counts agree at the same observation time. Per-currency subtotals reconcile; invalid/future times are unknown. Last-good prices survive failures/cooldowns.                                                       |
| MCP/export                | Cached query flags and age filters agree with the owner view; CSV verification is informational, preserving ownership. A live single-price read gets an actual read timestamp, not a fabricated cache refresh.                                     |
| Preservation              | Existing user/workspace IDs, credential fingerprints, encrypted key mappings, DB/coordinator IDs, publication payloads/revisions, admission and schedules match the approved baseline, allowing only explicitly reviewed release metadata changes. |
| QA cleanup                | All run-owned accounts, Workers/databases, coordinator/setup storage and temporary passwords are absent after finish/expiry; all real accounts retained.                                                                                           |

Use current records for acceptance rather than hard-coding the private review's
counts. Capture receipts that distinguish code, CI, deployment and observed user
behavior. No registrar changes, paid operations, marketplace listing writes,
messages, publication or withdrawal are authorized as acceptance actions.

## Recovery and completion

Prefer fix-forward while holding the next rollout stage. Reconcile uncertain
provider uploads before retrying. Use retained compatible code and preservation
snapshots if rollback is necessary; keep additive read contracts and raw cached
data intact. Never reset storage, force-delete resources or blindly restore an
older incompatible engine. A rollback of the interpretation may restore the old
misleading forecast, so verify user-facing results explicitly.

The release is complete only after the three user-visible behaviors and the
preservation/cleanup checks pass on the final production candidate. Green PRs and
dry-run bundles alone are preparation, not deployment.
