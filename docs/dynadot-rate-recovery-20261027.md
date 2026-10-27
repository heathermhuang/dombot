# Dynadot inventory rate-limit recovery

## Evidence and cause

On 27 October 2026 four manual inventory syncs started together and returned real upstream HTTP 429 responses in 1.8–2.8 seconds. The current production checkpoint retained those failures with no later success. The shared relay admitted four concurrent requests; each account's separate provider only serialized its own calls. Offline regression tests reproduce concurrent cross-account admission and absence of shared upstream cooldown.

[Dynadot's official documentation](https://www.dynadot.com/domain/api-document#rate_limiting) lists one thread and 60 requests/minute for regular accounts. It does not establish the scope of these particular upstream limits. Shared-IP or account activity outside this service remains a possible external contributor; historical responses do not identify it.

## Implementation plan and behavior

1. Extend the existing fenced, durable proxy queue with a Dynadot lane. All managed inventory, pricing and other Dynadot calls share one in-flight request across accounts and tenants, with 1.1 seconds after close. Other registrar relay capacity and queue/transport budgets stay unchanged.
2. Report real HTTP 429 Retry-After under the active lease. Normalize numeric/date/missing headers, persist the cooldown and decline queued Dynadot traffic locally during it. Local cooldown responses are tagged; they do not create fictional upstream failures or email incidents. Queue admission errors retain their own classification.
3. Persist per-account inventory deferral and retry eligibility alongside last-good holdings. Manual requests during cooldown return cached state without contacting Dynadot. Existing native schedules retry due accounts independently of the aggregate cache age. Three actual upstream failures stop automatic recovery; a later explicit Sync can start another bounded cycle. Success clears the error and reports recovery. No new scheduler or email path is introduced.
4. Coalesce concurrent inventory requests for one account. Keep inventory independent of incremental per-name pricing. Preserve queued pricing while inventory is unavailable, retain upstream pricing cooldown on inventory refresh, and cap quote retries while preserving previous quotes and failed-refresh status.

## Verification and release

The before-fix probes failed on both queue cases and all three inventory recovery cases. Verify focused and full suites, type/lint/security/relay checks, pinned engine integrity and the CI build matrix. Release a new pinned engine through a scheduler-first canary, preserve tenant settings, credentials, explicit pauses and cached data, then verify exact artifacts and only occupied enabled runtimes. Temporarily serialize the whole relay while old clients lack provider tags; restore its prior capacity after the new fleet is verified.

Production provider acceptance is limited to the four previously affected founder accounts, with one read-only inventory request each and at most one due recovery per account if necessary. Stop on a real 429 and respect its cooldown. Do not deliberately provoke limits, run a blanket fleet sync, or execute any domain purchase, renewal, transfer, deletion or settings change. Preserve the existing quiet incident-email policy.

Production observations and remaining external conditions are recorded in the release report after deployment. CI, deployment, provider recovery, pricing completeness and browser acceptance are separate claims.
