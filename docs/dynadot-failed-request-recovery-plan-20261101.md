# Dynadot failed-request restriction: implementation and release plan

Date: 1 November 2026. Status: reviewed; authorized for end-to-end implementation in a new Codex thread. No repair has been deployed by the planning thread.

## Outcome

Prevent repeated rejected pricing calls from keeping the managed Dynadot connection restricted. When Dynadot reports a failed-request IP restriction, preserve inventory and prices, enforce a durable quiet period, admit exactly one inventory recovery request, and resume eligible work only after verified inventory success. Show the actual restriction and next action to the owner and administrator.

Keep the existing single global Dynadot lease across users, accounts, routes, inventory and pricing. Keep the 1.1-second post-response spacing for healthy requests. The immediate repair is failure suppression and longer recovery cooldowns, not a blanket slowdown of successful requests.

## Evidence and its limits

- Incident report: `output/dynadot-incident-20261101/REPORT.md`; machine receipts: `live-probe.json`, `monitor.json`, `source-comparison.json`, `cleanup.json` in that directory.
- Scheduled Conference inventory failed at 02:30:45, 02:35:46 and 02:40:46 UTC on 1 November. All 666 cached domains survived. Recovery stopped after three actual failures; last good inventory was 31 October, 02:29:12 UTC.
- At 03:11:02 UTC, one corrected normal-header inventory request through the actual production scheduler and existing managed relay returned HTTP 429 with a failed-request IP restriction. At grant: one active Dynadot lease, zero waiters. Release succeeded and persisted a shared 60-second cooldown.
- Engine `.30` source hash exactly matches the original alert. Its transport, lease client, queue transitions and Dynadot wrapper match the corresponding `.31` sources inspected in `/private/tmp/dombot-public-design-pilot-20261101`.
- Earlier same-route receipts show classic price-only business `invalid key`, unsupported-TLD REST search, and explicit failed-request IP throttling. These are plausible contributors; the provider's threshold and complete triggering traffic are unknown.
- Existing parser matches `too many requests`, but not `too many failed requests`. Replaying the recorded response reproduces `reason=unknown`.
- Historical Workers observability lookup returned HTTP 403. Historical lease timing cannot be reconstructed.
- Two initial diagnostic requests omitted the SDK Accept header and returned logical code 400. They are excluded from normal-path recovery conclusions. The corrected third request reproduced the restriction; the preview is now closed. Do not repeat those probes.
- A matching Dynadot support thread exists with only an automatic acknowledgement in the last mailbox search. This plan does not authorize another external message.
- Official rate-limit and signing reference: https://www.dynadot.com/domain/api-document. The 30-minute/two-hour/six-hour policy below is our conservative policy, not a provider promise about clearance.

## Scope and invariants

1. No domain purchases, renewals, transfers, deletions or setting changes as tests. Classic `price_check=1` remains read-only, but rejected classic access must not be repeatedly exercised.
2. Preserve credentials, selected routes, root keys, tenant identities, user pauses, publications, cached holdings, last-good timestamps, quotes, provenance, pending names and diagnostic history.
3. Never switch IP/proxy or rotate credentials to work around a provider restriction. Do not clear a circuit or capability rejection merely because of deployment, engine version, browser reload or inventory refresh.
4. Other registrars retain existing concurrency. Self-hosted and desktop installs retain existing behavior except for safe diagnostic classification and applicable local rejection caching.
5. Do not add an alternative pricing driver or expand existing provider/pricing quotas. Use the native scheduler, coordinator, budget accounting and incremental pricing continuation.
6. Local deferral sends zero registrar requests and does not increment upstream-failure counters or open duplicate email incidents.
7. Cross-route global serialization is mandatory even if long cooldowns become scoped to the proven affected egress. A circuit scope is not a new concurrency lane.

## Phase 0: establish the correct working and release base

- Read project `AGENTS.md`, deployment documentation and the existing incident receipts. Refresh only drift-prone facts: live source/engine, scheduler source/settings, queue status, current cached recovery state and existing release writers. No initial registrar call.
- The primary checkout is old and dirty. Preserve it. Create a separate isolated checkout from the verified current release/integration base; do not reset, stash or commit unrelated work.
- `/private/tmp/dombot-public-design-pilot-20261101` and `/private/tmp/dombot-pilot-mail-20261101` belong to other tasks. They are read-only references, not edit destinations. Recheck remote refs and production before selecting a base or engine version.
- An existing legacy freeze marker refers to a MyDocker task. Do not delete or repurpose it. Respect actual task ownership; do not let an unrelated advisory marker justify modifying that project.
- Before release, resolve active production-writer conflicts using existing release coordination. Recheck fleet counts dynamically; old counts are not deployment manifests.

## Phase 1: explicit, backward-compatible failure classification

Primary files: `src/shared/dynadot-rate-limit.ts`, its tests, `src/shared/sync-monitor.ts`, hosted monitor/admin renderers and relevant schemas.

- Add an explicit allowlisted `failed_request_ip` reason. Match the observed failed-request/IP message before generic request-rate matching; retain existing concurrency, daily quota, edge challenge and unknown classifications.
- Parse bounded JSON/XML/text error descriptions safely. Never persist raw bodies, URLs, headers, private domains, credentials or arbitrary provider text.
- Correct endpoint classification for single-domain REST `/domains/{name}/search` pricing, currently classified as `other`.
- Keep provider Retry-After provenance separate from the longer application quiet period. A fallback 60 seconds must not be displayed as a confirmed provider reset time.
- Readers must accept old records without the new reason/fields. Deploy compatible central readers before new writers. Keep incident identity based on failure category/status/route; adding diagnostic detail or changing build must not reopen the same incident.
- Add minimal sanitized attribution needed to verify the new behavior: purpose, scope class, circuit state, next eligible time and outcome. Do not log every queue poll. Recovery observations should be bounded and usable for a single incident.

## Phase 2: durable circuit breaker inside the existing queue

Primary files: `src/shared/proxy-scheduler.ts`, `src/hosted/proxy-scheduler.ts`, `src/worker/proxy-scheduler.ts`, `src/worker/proxy-transport.ts`, their tests and environment types.

### Metadata and scope

- Extend the internal service protocol additively with validated request purpose (`inventory`, `pricing`, `other`) and a server-defined egress scope class. Preserve legacy acquire/release/cancel behavior and fenced tokens.
- The tenant transport derives purpose from method and exact endpoint and derives managed egress from host configuration and the selected actual transport, not UI input or a caller-provided arbitrary key. Keep this metadata separate from the existing queue route, which is normalized to `relay` for global Dynadot admission.
- Scope the new long circuit to the affected managed egress when identity can be verified. Managed aliases sharing that egress must share the circuit. Customer proxy credentials and raw URLs never cross the scheduler binding.
- Do not invent reliable custom-egress identity from labels or assume each custom route has a distinct IP. Unknown/legacy scope is handled conservatively while mixed versions drain. Preserve the existing shared short upstream cooldown across routes.
- If trustworthy scope separation cannot be implemented without changing the existing security boundary, retain a conservative global long hold for the initial compatibility window and record that limitation. Do not silently claim unaffected-route isolation or create parallel provider lanes.

### State machine

Persist bounded optional state in the existing Durable Object storage: `open`, `half_open`, retry ordinal, `notBefore`, reason, last observed time, and the fenced half-open lease. Closed is the absence of an active circuit. No SQL migration should be needed for queue state.

| Event | Required behavior |
| --- | --- |
| First proven failed-request IP rejection | Open affected circuit; wait at least 30 minutes, respecting any longer valid Retry-After. |
| Acquire during open interval | Return a typed local deferral immediately; do not open a socket or consume retry budget. |
| Quiet period expires | Admit exactly one inventory request under the existing global lease. Pricing and other affected requests remain deferred. |
| First recovery probe rejected or uncertain | Reopen for at least two hours; preserve all cached data and pricing work. |
| Second recovery probe rejected or uncertain | Reopen for at least six hours. |
| Third recovery probe rejected or uncertain | Stop automatic probes and show provider/operator action required. No infinite six-hour loop. |
| Valid inventory success | Close the circuit and permit eligible native inventory/pricing continuation. |

Apply only positive deterministic jitter of up to 10% to scheduled recovery, never reducing a provider Retry-After. Store the chosen deadline once. No model-driven recurring observer.

- Include the failure category and effective quiet-period timing in the fenced release outcome. Parse the already bounded response while the lease is held; do not issue another network request to inspect it.
- Determine successful inventory semantically: valid success envelope and valid inventory payload. HTTP 200 with code 400/401/429, malformed responses, timeouts, cancellations and expired leases cannot close the circuit.
- A stale release cannot clear or shorten a newer circuit. A successful ordinary non-probe response cannot clear a circuit opened later by another lease. An abandoned half-open lease reopens conservatively without fabricating a provider response.
- No scheduler token, URI, customer secret or domain inventory is retained in public diagnostics. Bound state cardinality and clean obsolete completed circuit metadata without evicting active holds.

## Phase 3: account recovery and pricing behavior

Primary files: `src/core/services/registrars.ts`, `src/core/services/dynadot-transport.ts`, registrar metadata schemas, Worker maintenance/coordinator integration and hosted renewal continuation.

- Add a distinct persisted provider-restricted/deferred state or equivalent typed metadata. Retain the existing three-attempt bound for generic upstream failures. A shared local hold does not spend it.
- Solve the existing stop-state deadlock: an eligible restricted account must be able to submit one native inventory recovery candidate even when the old generic recovery state was `failed` after three attempts. The global circuit alone decides which candidate gets the half-open lease.
- Use the existing native scheduling mechanism and its pause/empty/disabled rules. Do not reset ordinary freshness, install blanket fleet cron triggers or forcibly enable paused accounts.
- Migrate/re-arm the exact confirmed Conference incident using guarded compare-and-swap only if current account, error, engine evidence and retained counts still match. Preserve history and last-good timestamps. Do not bulk-reset old failures or attempt counters across the fleet.
- Inventory stays independent of optional pricing. While inventory is restricted/failed, pricing reports blocked with remaining names retained and does not issue traffic.
- A half-open inventory success must update the normal cache/event through the normal application path. Only after that success may native pricing resume, under unchanged 15/20 budgets. Start with one eligible supported pricing operation; do not fan out the backlog as a release test.

### Stop known rejected pricing strategies

- Inspect the existing persistent capability cache before adding another one. It already has credential/route fingerprinting and a 24-hour TTL; verify load, persistence, reset and SDK/host interaction with regressions.
- After a proven classic `invalid key`, suppress that classic fallback for this account/configuration. Continue allowed REST inventory and supported REST pricing; do not mark the whole REST credential invalid.
- After a proven unsupported-TLD response, skip repeat requests for that affected TLD/configuration. Keep the quote status unsupported/blocked rather than presenting a missing price as a fresh zero or completed pricing.
- Persist rejections across Worker restarts, engine releases and inventory rebuilds. An elapsed generic cache TTL alone must not repeatedly generate known failed calls while an IP restriction is active.
- Reconsider a rejection only after an actual credential/capability change or a bounded explicit capability refresh after recovery. Route configuration changes must not be used to evade a restriction. Never copy another account's credentials or prices.
- Preserve successful exact quotes and manual overrides. Pricing completeness remains a separate milestone; blocked/unsupported holdings must be counted honestly.

## Phase 4: owner/admin experience

- Reuse Settings registrar status and the admin sync monitor. Show: failed-request IP restriction, cached domains retained, last good inventory, pricing blocked/pending, next recovery eligibility, and automatic recovery exhausted when applicable.
- During a quiet period, Sync must report the deferral and next time. Repeated clicks cannot bypass the circuit or re-arm unlimited probes.
- Distinguish provider Retry-After from our application quiet period. Do not promise a fixed provider unblock time.
- Preserve quiet incident grouping: the initial actual failure can alert under current policy; local deferrals and build changes do not generate additional failure emails. No synthetic production email is needed.
- No design overhaul or unrelated interface changes.

## Phase 5: verification before release

Write meaningful regression tests that fail on the old behavior, then pass with the repair:

1. Observed JSON failed-request IP message classifies explicitly; ordinary 429, legacy markers, bounded malformed content, XML/text and secret-redaction cases remain correct.
2. Single-domain REST search is pricing. Classic invalid-key business envelopes and HTTP failures remain distinct.
3. Eight users across managed/custom/alternate classes still yield at most one global Dynadot lease. Healthy spacing remains 1.1 seconds after full response/socket cleanup.
4. Restart during a long hold retains it. Managed aliases cannot bypass it. Valid unaffected routes retain their documented behavior without parallel Dynadot execution.
5. Simultaneous post-expiry acquisitions admit exactly one inventory probe; pricing cannot claim it. Deadlines respect positive jitter and longer Retry-After.
6. Semantic inventory success closes the circuit. HTTP 200/code 400, malformed inventory, timeouts, cancellations, stale/duplicate releases and abandoned probes do not. Verify two-hour/six-hour escalation and terminal automatic-probe stop.
7. Local holds cause zero transport calls, no upstream-failure increment, no loss of jobs/quotes and no duplicate incident email.
8. A previously failed-three-times account recovers through the native scheduler; disabled or manually paused accounts remain untouched.
9. Multiple requests/restarts/inventory rebuilds do not repeat known invalid classic or unsupported-TLD calls. Fingerprint/configuration changes invalidate only appropriate evidence and do not bypass an active IP circuit.
10. UI/admin accurately render restriction, retained-data state, next eligibility, blocked pricing and exhausted recovery; legacy records remain readable.
11. Mixed-version protocol and reader compatibility, safe state migration, guarded re-arm mismatch, and rollback retain existing holds.

Run the current repository-required suite and CI matrix, not a stale checklist copied blindly. Expected checks include hosted auth dependency install/build, typecheck, lint, focused/full Vitest suites, security regressions, relay checks, engine pack/verify, web/demo/site builds and Worker bundle/dry-run checks. Match current CI scripts. Keep deterministic tests free of live registrar traffic. A failing environment check is not a provider diagnosis.

## Phase 6: staged production release

1. Produce a reviewable PR with the problem/behavior, evidence, test results, protocol compatibility and rollback plan. Review the actual final diff. Merge and deploy are authorized for this fix once required gates pass; no extra routine confirmation is needed.
2. Save exact deployment versions/settings/bindings, queue state/cooldown and protected-data fingerprints/bookmarks. Never save new plaintext credentials. Coordinate with concurrent release owners.
3. Deploy compatible central schemas/readers before new diagnostic writers. Use additive protocol support in the scheduler before new transport clients.
4. Use the existing temporary Dynadot admission pause only for the bounded mixed-version rollout; preserve active leases/releases and longer stored cooldowns. This temporary global deployment pause is distinct from the ongoing managed-egress circuit.
5. Canary the exact engine/source with synthetic isolated queue tests that make zero registrar requests. Preserve assets, secrets, identities, customer state and occupied-runtime provenance.
6. Update the necessary fleet/templates/provisioner using existing verified release tooling. Reconcile the exact current manifest; do not overwrite another release's assets/settings or assume a historical fleet count.
7. Seed/transition the proven managed restriction conservatively from current evidence using a guarded state operation; do not clear old cooldowns. Verify affected legacy stopped account eligibility without a provider call.
8. Remove only this rollout's temporary admission pause after all relevant clients/readers are compatible. Re-read queue and account state. Native traffic remains subject to the durable long circuit.

## Phase 7: live acceptance and rollback

- First acceptance is software behavior: deployed source/protocol matches candidate, unaffected registrars remain normal, blocked managed traffic sends zero provider calls, cached state remains unchanged, and UI/admin report the true cause/deadline.
- At the actual eligible recovery time, observe one normal native inventory attempt. Use the real endpoint, SDK headers, existing route, normal coordinator and provider budget. No diagnostic alternate driver, forced fleet refresh, deliberate bad request or route experiment.
- If still rejected, verify correct durable escalation and preserved holdings; stop probes at the prescribed limit. This is qualified deployed protection with provider recovery still blocked, not complete provider recovery.
- If accepted, require `trigger=scheduled`, exact released engine/source, cleared current inventory error, normal event lastGoodAt equal to cached lastSyncedAt, and validated inventory. Do not require the current holdings count to remain exactly 666 if legitimate provider changes occurred; preserve prior snapshots and explain supported differences.
- Observe one eligible supported pricing continuation only after inventory recovery. Report valid fresh quotes, retained pending names, unsupported capability counts and actual failures separately. Do not claim all pricing complete from inventory success.
- Rollback restores the exact previous deployment and preserved customer settings but must retain active restriction/cooldown protection, or retain the compatible scheduler guard while rolling back clients. Never erase Durable Object state or re-enable failing pricing traffic as rollback cleanup.
- Remove temporary previews, test triggers, release-only pauses and run-owned resources. Preserve pre-existing user pauses, unrelated scope markers and other tasks' resources.

## Completion receipts and remaining external gate

Deliver exact commit/PR, CI run, engine/source, deployed scheduler/gateway/tenant proofs, protected-data comparisons, zero-call hold evidence, native recovery outcome and cleanup receipt. Report source/CI, deployment, provider inventory recovery and pricing coverage as separate states.

If Dynadot's restriction persists, finish and release all protection that can be verified; record the exact external gate and next permitted native recovery time. Existing support response/clearance is external. Do not send another message without explicit authorization or keep rerunning probes to manufacture success.

## Reviewed decisions

- No blanket healthy-spacing increase: the reproduced rejection occurred with one active request; longer spacing alone does not stop known failed calls.
- Preserve one global lane; add typed circuit state, not parallel route lanes.
- Prefer verified managed-egress scope; conservative compatibility behavior is explicit if old clients cannot provide trustworthy scope.
- One semantic inventory recovery probe precedes pricing. Generic failure stop-state must not prevent that probe, and manual Sync cannot bypass its budget.
- Three bounded recovery probes with 30-minute/two-hour/six-hour quiet periods, then attention required. These are changeable application policy defaults, not documented Dynadot clearance times.
- Reuse and strengthen the existing capability cache; do not build a second negative cache or rely on deployment/TTL to forget evidence.
- No new outreach, route switching, credential changes or speculative claims of full pricing completion.
