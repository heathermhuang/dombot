# Reviewed SaaS QA remediation plan

Date: 5 November 2026. Status: reviewed and authorized for implementation in a new thread by the user's instruction: “Plan the fixes, review them carefully, then start implementing all the fixes end to end in a new thread.”

## Outcome and completion contract

Resolve the outstanding QA findings through implementation, meaningful regression tests, review, required CI, merge, scoped deployment and current-candidate verification. Close remaining acceptance gaps where controlled evidence can be obtained. Keep a coverage gap distinct from a demonstrated software defect, and keep a successful retry distinct from a root-cause fix. Do not stop at a plan, draft PR or local green result.

No new plan approval is needed. Continue routine reversible work and the authorized release autonomously. Stop only at an actual access, credential, CAPTCHA, legal-acceptance, destructive, payment or third-party communication boundary. Prepare the exact test/action before requesting the input needed at that boundary. Do not bypass it or call the test passed.

## Verified starting state

- GitHub `heathermhuang/dombot:main` was refreshed on 5 November and is `7482c035075ec34deb883261996f9b3c4759398d`, after merged PRs #159 and #160. Refresh again before creating the implementation branch.
- Latest verified serving gateway: `ec5e7ea2c091a8b38a70635a42c0c607f16ed250`; engine `2.0.0-hosted.2`. This is a recorded release receipt, not a substitute for a fresh provider/settings read before operations.
- The password-confirmation redirect is already fixed and deployed. Preserve its regression; do not reopen or duplicate that fix.
- The primary checkout `/Users/heatherm/Documents/ChatGPT/dombot` is dirty and substantially behind current hosted main. Do not reset, stash, clean, commit unrelated files or use it as the implementation base. Create an isolated checkout under `/private/tmp` from current fork main. Existing reference checkout: `/private/tmp/dombot-saas-qa-20261104`.
- Sanitized evidence: `output/saas-qa-20261104-2230/REPORT.md`, `runtime-incident.json`, `production-checkpoint.json`, `production-requalification.json`, `release-20261105.json`, `post-deploy-http-20261105.json`, and `dependency-reachability.json` under the primary checkout. The committed report and receipt are `docs/saas-qa-20261104.md` and `docs/saas-qa-release-20261105.json` on current main.
- Existing open PRs #13 and #19 concern the hosted MCP warning and 101domain support. Inspect for overlap before editing; do not duplicate or absorb unrelated work.
- Baseline evidence: 251 CI test files, 2,699 passing tests, one deliberate manual browser-server skip; four security regressions, four relay checks, both CodeQL languages and required builds passed. Do not add 89 focused rechecks to that total as distinct tests.

## Findings and implementation sequence

| Work package | Priority | Concrete outcome | Dependency |
| --- | --- | --- | --- |
| A Provisioning diagnosis and recovery | P1 | Identify the stalled stage and protect safe recovery from cancellation, reset and unknown provider outcomes | First investigation and test work |
| B Dependency remediation | High | Remove the four named vulnerable production dependency resolutions with compatible updates | Independent; sequence after A's initial diagnosis to avoid changing its baseline |
| C Analytics/CSP conflict | P3 | Stop unwanted analytics auto-injection on the service without relaxing CSP or bot protections | Independent scoped change |
| D Controlled acceptance gaps | Acceptance | Exercise browser/authenticator and inquiry workflows with safe fixtures and truthful limits | Requires fixture/cleanup review before any live write |
| E Release and final qualification | Required | Ship each affected component using current live configuration, verify serving candidate and cleanup | After applicable tests/review/CI |

Use small coherent changes in one implementation thread. Do not create artificial user approval gates between packages. Use separate PRs only where deployment scope or risk warrants separation.

## A Provisioning diagnosis and recovery

### Evidence and uncertainty

The original valid import returned HTTP 503. At `2026-11-04T14:27:56.011Z`, Cloudflare recorded `Provisioner.provision` as hung: request `ccbf9ac7b9721b9b893857de3faf92a3`, trace `6502a67cbc9cdd6aa9acbfbce9ccc9bc`, provisioner version `587f15cd-3423-4682-98bd-b4d76644bfd4`. The completed QA audit shows a database was observed and deleted, with no Worker deletion required. A later, separate `PortfolioSetup.cleanupQa` operation hit a storage reset at `14:29:04.858Z`, reference `9ialbrfdq8hsnpe24adcr84u`. Cleanup then succeeded. Two later guarded production qualifications passed. None of this proves the cause of the initial hang.

Relevant code: `src/hosted/provisioner.ts` (the serialized queue and service-binding RPC), `provisioning.ts` (journal, assets/provider reads and create/upload/qualification), `provisioning-recovery.ts`, `production-import-qa.ts`, `gateway.ts` around pending-workspace activation, and `scripts/production-import-qualification.mjs`. The gateway currently discards the activation exception; the runner asserts the HTTP status before retaining a useful failure classification. Provider fetches have a 45-second signal, but assets reads, body consumption, dispatch and queue waits must be examined individually rather than assumed bounded.

### Implement

1. Read the complete existing provisioning, recovery, QA lifecycle/alarm and on-demand tests before modifying behavior. Refresh current Cloudflare error-handling/runtime documentation. Reconcile historical evidence and current configuration; perform no fresh production allocation merely to seek a different result.
2. Reproduce the real service-binding/DO sequence in the existing local Worker infrastructure: arm the QA lease, provision through the RPC wrapper, inject failure after database creation, and exercise recovery/cleanup. Cover sequential requests, concurrent admission, rejection and object recreation. Reuse `production-import-qa-alarm.test.ts` and existing fixtures; do not introduce a new test framework.
3. Add the smallest useful diagnostic contract through existing protected state/logging: an operation correlation ID, current phase, start/update times, stable failure code and upstream status/request reference when available. Suggested phases: admission, assets, database inspection, database create/reconcile, module read, Worker inspection, upload/reconcile, bootstrap, provenance, idle qualification and admission completion. Keep diagnostics bounded. Store no email, credential, root/gateway key, token, request body, imported data or arbitrary provider response in diagnostic events.
4. Preserve backwards compatibility of existing setup journals. Prefer additive optional fields or narrowly scoped existing storage; do not add a control migration without a demonstrated need. Ensure a late operation cannot recreate state after trusted cleanup has completed.
5. Apply a root-cause repair only after evidence or a deterministic reproduction establishes it. Inspect async queue/RPC lifecycle and all potentially pending I/O. Use supported cancellation where possible. A `Promise.race` timeout alone is not a repair: it must not let the abandoned operation continue creating resources while a retry starts.
6. Preserve identity and receipt reconciliation. Never automatically replay create/upload after an unknown response; inspect actual provider state using the original workspace, database, module/template and keys. A retryable error must not admit an unqualified tenant, allocate a replacement pair or rotate setup identities.
7. Return a safe retryable 503 with a non-sensitive support correlation reference, retaining the user's sign-in and request data. Keep detailed diagnostics private. Extend the trusted runner to retain the method/stage/status/correlation needed for diagnosis without dumping arbitrary response bodies or credentials.

### Acceptance

- A fault after database creation either recovers with the same identity/resource pair, or produces a precise hold without another create. Lost upload outcomes reconcile before replay. No duplicate allocation or premature admission occurs.
- A rejected/reset operation cannot poison the queue permanently; subsequent authorized work can make progress. Cleanup still serializes with provisioning, respects backoff and clears only the registered synthetic run.
- Timeout/cancellation tests demonstrate the abandoned operation cannot perform a late provider write after a successor or cleanup. If that cannot be guaranteed, retain the original in-progress identity and report pending/unknown instead of starting overlapping work.
- Diagnostic redaction tests reject secret/body leakage and ensure unclassified failure is not silently reported as success. Each failure path identifies its last observed phase.
- The P1 is not marked fixed merely because instrumentation landed or another normal run passed. Require a demonstrated cause plus regression, or explicitly classify an evidenced provider incident and its verified recovery with the remaining uncertainty recorded.
- After a named repair, run one bounded managed qualification on the exact candidate. Use the existing trusted lease and mandatory cleanup; a held or failed cleanup stops further tests. Do not broaden customer cleanup eligibility.

## B Dependency remediation

An `npm audit --omit=dev --json` refresh on 5 November still reports four affected packages: `body-parser` high, `fast-uri`, `ip-address` and `qs` moderate. Paths include MCP SDK → Express/body-parser/qs, MCP SDK → AJV/fast-uri, and MCP SDK → express-rate-limit/ip-address. Some also occur through Electron tooling. The earlier gateway/tenant build graphs contain none of these four; that is not a reason to leave known vulnerable resolutions or to claim every execution target is safe.

Compatible registry-verified starting targets: `body-parser` 2.4.0, `fast-uri` 3.1.9, `ip-address` 10.7.6, and `qs` 6.17.1. Recheck before applying. The latest fast-uri is 4.2.3, but AJV's existing 3.x dependency must not be forced to that major.

1. Prefer the smallest compatible parent/lockfile updates; use narrowly scoped, documented overrides only if necessary. Do not run `npm audit fix --force`, rewrite unrelated dependency families, or suppress advisories.
2. Inspect root, hosted-auth and pinned-engine dependency/build boundaries. Run `engine:verify` after the lock change. If the installed pinned engine or embedded build lock genuinely requires repacking, follow `docs/dombot-engine.md`: bump the hosted engine patch, rebuild/package/provenance, inspect the archive and stage the tenant/template rollout. Do not repack an unchanged engine just to make a version number move, and do not bypass integrity checks.
3. Add/run meaningful contract regressions for affected use: schema/URI validation, IP parsing/rate-limit handling, form/query parsing and compressed-body handling where actually consumed. Include upstream advisory reproductions in a bounded local process where appropriate; never send malformed compressed bodies or denial-of-service probes to production.
4. Audit the resulting exact lock and installed tree. The four named production findings must disappear without hiding audit output. Separate remaining development-tool advisories from production runtime reachability and report any new findings.

Primary advisory references: [body-parser](https://github.com/advisories/GHSA-27r3-jxmh-p828), [fast-uri](https://github.com/advisories/GHSA-w74x-v6f9-j3xg), [ip-address](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5), [qs](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw). The audit contains additional fast-uri advisories addressed by the patched 3.x release.

## C Analytics/CSP conflict

Native Chrome observed Cloudflare injecting `static.cloudflareinsights.com/beacon.min.js`, then the service's `script-src 'self'` blocking it on auth and private application pages. The preferred repair is to disable unwanted **Web Analytics auto-injection for the exact domains.domains service/site**, or apply a narrowly scoped existing Web Analytics exclusion rule. Snapshot the relevant existing setting, preserve unrelated hosts and restore it only if rollback is needed. Do not delete the analytics site or its historical data.

Do not add external analytics origins, `unsafe-inline` or `unsafe-eval` to script policy. Do not enable manual tracking as a replacement. Do not disable WAF, Turnstile or JavaScript Detections. A blanket `Cache-Control: no-transform` change is rejected as the default: Cloudflare documents that it can affect security-script injection too. Inspect the live setting and supported rule/API schema first; apply the analytics-specific control rather than making an unverified assumption about headers.

Acceptance: live auth/account/private/public HTML on the scoped service contains no unwanted beacon injection/request, the associated CSP console error disappears, all existing CSP/cache/session protections remain, and Turnstile/security configuration is unchanged. Test without treating Chrome-extension errors as first-party application failures. Record any intentional loss of analytics measurement explicitly; these pages' injected beacon was already blocked in the observed pass.

References: [Web Analytics settings](https://developers.cloudflare.com/web-analytics/get-started/), [FAQ](https://developers.cloudflare.com/web-analytics/faq/), [JavaScript Detections](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/javascript-detections/).

## D Close acceptance gaps safely

Coverage gaps are not automatically implementation defects. Build/repair only the harness or product behavior required to obtain meaningful evidence.

- **Passkeys:** exercise the actual browser enrollment → login → fresh-auth enforcement → removal flow on an isolated non-production synthetic identity using the existing Worker/D1/auth test infrastructure, with the correct local secure-context/RP configuration. Keep production credentials and the founder account untouched. A virtual authenticator qualifies browser/protocol behavior, not a physical device; label that distinction. Physical credential entry/enrollment that requires user takeover must be prepared and handed off at that exact step. Live production RP acceptance remains a separate result unless actually completed.
- **Inquiry:** first exercise submit → email confirmation → conversation/reply → replay/rate-limit/error behavior with synthetic local fixtures and a captured mail transport. For external delivery, bind an exact controlled listing, verified owner recipient and user-controlled sender with a safe cleanup/archive method before any send. Do not infer permission or recipient identity from the public phrase “controlled test.” At the actual Turnstile step, obtain the tool-required confirmation; do not bypass or remove it. No commercial offer, customer message, payment or transfer is authorized as a fixture. If a real external recipient is needed, present the exact recipient and synthetic message for authorization.
- **Cleanup trap:** `production-import-qa.ts:checkControl` holds on unexpected references, including passkeys/inquiries. Do not reuse an import lease for these workflows and then weaken its allowlist to force cleanup. Use a disposable non-production harness with its own precise reset, or design and review a narrowly scoped purpose-specific trusted lifecycle before any production test. Do not disable/sidestep a hold.
- **Other mailboxes, mainland connectivity and registrar/marketplace writes:** prepare the bounded tests and list needed user-controlled fixtures/provider access. Run authorized read-only qualifications where possible. Do not purchase, renew, transfer, alter real DNS or listings, create a paid subscription, or send messages to others as part of a general QA cleanup. Missing controlled accounts or external approvals remain exact acceptance holds; never fabricate provider acceptance.
- **Performance/accessibility:** investigate reproducible console/layout/keyboard findings within these journeys. The earlier large-chunk warning alone is not proof of a performance defect. Capture a bounded baseline before proposing a bundle redesign. Preserve the existing design system; no speculative redesign or CI replacement.

## Review conclusions and rejected shortcuts

| Review dimension | Decision and rationale |
| --- | --- |
| Product | Successful initial setup is the primary outcome. Do not expand into billing, registrar spend or new integrations; the offer remains free early access. |
| Engineering | Diagnosis/fault reproduction precedes a provisioning behavior change. Keep durable identity, serial writes and receipt reconciliation as invariants. Separate the initial hang from the later cleanup reset. |
| Security/privacy | Keep strict CSP and bot controls. Prefer a scoped analytics-specific exclusion. Keep credential payloads out of logs and preserve fresh-auth, scopes and encrypted storage. |
| Browser/user flow | Keep setup errors actionable and preserve entered data; never replay a sensitive write after fresh-auth redirect. Test both desktop and the observed 390 × 844 mobile viewport. |
| Developer experience | Give the trusted runner a safe diagnostic receipt and one precise final result per acceptance plane. Keep local/synthetic/production/provider claims distinct. |
| Resource use | Refresh current source/config once, checkpoint progress, reuse valid unchanged results, and stop a paid/provider/cleanup hold rather than repeatedly retrying. No recurring model-driven audit or monitoring service. |

Do not rewrite the DO queue, raise timeouts, hide the CSP error, upgrade to a forced major, broadly relax cleanup, or label another successful retry a fix without supporting evidence. These were explicitly rejected during review.

## Verification, rollout and rollback

1. Install locked root and hosted dependencies in the isolated checkout; rebuild the existing auth bundle. Use current fork main and existing project tools. Read current AGENTS.md and release instructions.
2. For every behavior change, write the regression that demonstrates the wrong observable result, reproduce it before the fix when feasible, fix surgically, and rerun the affected checks. Fault-injection tests must distinguish their simulated provider failures from real provider evidence.
3. Run required typecheck, lint, engine verification, full tests, separate security/relay checks, all affected Worker dry runs and renderer builds. Audit the resulting dependency lock. Do not count overlapping focused/full test runs as additional unique coverage. Investigate actual failures; do not relax tests or suppress stderr merely to obtain green.
4. Focused review must cover stale callers, unknown create/upload outcomes, retry/backoff, late callbacks after cleanup, user-input/secret redaction, multi-tenant isolation and rollback compatibility. Record every changed timeout, retry, schema, validation rule and security setting with its reason.
5. Push coherent changes, open PRs, respect protection/review/CI gates and merge the checked head. Existing end-to-end authorization includes routine release steps. Use ship and land-and-deploy guidance; do not stop at PR creation.
6. Snapshot live modules/settings/schedules, account identities, encrypted credential fingerprints and publication revisions relevant to the rollout. Preserve unrelated dirty source, tenant identities, root/gateway keys, assets, secrets, quotas, publication state and feature flags. Never deploy placeholder public configs over live configuration.
7. Roll out only affected components. Gateway-only work does not justify a tenant fleet rollout. Provisioner changes preserve its current setup namespace, template, assets and two-minute cleanup cron. A genuinely changed engine follows the pinned-engine canary/fleet/template procedure and serving coordinator-header qualification.
8. Verify exact deployed module/source, preserved bindings/settings/data, scoped beacon absence and browser flows. A final managed import qualification on the final candidate must pass zero allocation on open/preview, one pair on Save, two idempotent retries, readback, independent absence/cleanup and customer preservation. Stop on unknown provider writes and reconcile before any replay.
9. Roll back only affected modules/settings using the captured exact prior artifact/config, retaining database schemas, journals, resource identities and security protections. Additive diagnostic/schema changes must remain backward readable. A rollback is not proof that an unknown provider write was undone.
10. Publish one consolidated final receipt: fixed/deployed items, all PRs and exact runtime revisions, actual test outcomes, customer/cleanup preservation, residual incidents and precise human/provider holds. Update project docs/AGENTS with durable release facts; do not update stored memories unless the user asks.

## Definition of done

The named dependency advisories and analytics/CSP conflict are resolved and verified on affected execution targets. Provisioning has a demonstrated root-cause repair or an evidenced external-incident disposition plus verified bounded recovery; instrumentation alone does not close it. All implemented changes are reviewed, green in required CI, merged and deployed with final-candidate evidence and complete QA cleanup. Acceptance tasks requiring unavailable physical devices, controlled provider accounts, CAPTCHA confirmation or external-message authorization remain explicitly held, rather than being counted as passed or silently abandoned. Continue every independent authorized task while awaiting a genuine boundary.

## Implementation handoff

Start in the new thread by reading this plan and current main's AGENTS.md. Create the isolated implementation checkout, inspect current open PRs and the exact existing tests, then begin work package A's reproduction/diagnostic changes and B's compatible dependency remediation. The plan has already been reviewed; do not restart a discovery interview or request generic approval. Carry the authorized work through the definition of done above, and make the first progress update identify the implementation checkout and concrete first change.
