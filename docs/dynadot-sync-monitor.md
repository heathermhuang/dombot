# Production Dynadot sync monitoring

The gateway's existing two-minute Cloudflare cron reads an indexed, encrypted diagnostics document from up to 25 enabled, occupied portfolios per run. It never starts registrar requests. At 39 enabled portfolios a fleet cycle is approximately four minutes; the admin page computes the current estimate. Check `/admin/sync-monitor` for actual coverage and the last completed collector run. A stopped cron cannot email about its own outage; stale coverage is shown in the dashboard.

From engine `1.5.2-hosted.14`, the common Dynadot inventory-sync path records completed browser/manual, MCP and scheduled attempts. Each event includes an immutable attempt ID, monotonic sequence, account ID, start/completion time, duration, last successful sync, domain count, trigger, route class, allowlisted failure category, numeric HTTP status when available, engine version and exact source hash. Raw messages, provider responses, credentials, URLs, account labels and domain names are never recorded. Unknown causes remain `unknown`; classification is evidence, not a definitive root-cause claim. A process terminated before recording its outcome is outside completed-attempt coverage.

A local, non-cache namespace survives cache clearing and data imports. A single encrypted document atomically pairs its revision and up to 200 attempts for 30 days. Collection archives attempts in the control database for 30 days. It detects retention gaps or sequence resets instead of treating lost diagnostics as healthy. A successful retry cannot erase the preceding failure.

## Incident and email policy

`SYNC_MONITOR_ENABLED=true` enables collection and dispatch. The production recipient is `heathermhuang@gmail.com`; sending additionally requires that address to resolve to an enabled account in `ADMIN_USER_IDS`. The existing verified transactional `EMAIL` binding sends from `accounts@mail.domains.domains`. Authentication-email quotas and customer settings are unchanged. Other deployments default to disabled.

A new actual Dynadot sync failure or a changed failure cause creates an email-eligible alert. Identical continuing failures retain every attempt without repeat incident alerts. Successful recovery, monitoring availability and retention gaps remain dashboard-only. This also applies to health/recovery notices queued under the earlier policy: they never drain into email after the fix. Previously unseen failures remain recorded even when recovery occurred before the next poll.

Incident identity uses the failure category, HTTP status and route class. Engine versions and source hashes remain diagnostic evidence, but a deployment alone does not reopen an incident. The collector also recognizes the older fingerprints that included build identity, without resetting the incident or failure count.

A leased collector, atomic fleet-wide email reservation and transactionally claimed outbox group up to 50 failure alerts into **one email at most every 30 minutes**, including concurrent collectors and ambiguous-send retries. New failures during the cooldown wait for the next digest. Provider acceptance and message IDs are retained for every included alert. An uncertain send can be retried up to three times under the same 30-minute cooldown; duplicates remain possible after ambiguous acceptance. Exhausted uncertain alerts remain visible for follow-up. Sent alerts and dashboard-only notices expire after 30 days; outstanding actual-failure emails remain queued.

Observer failures retain a classified stage, duration, numeric HTTP status when available and timestamps. Raw exception text is excluded. Historical availability notices from before this fix did not retain the detailed observation cause; it cannot be reconstructed from those notices alone.

## Access, verification and rollback

The dashboard uses the existing sole-admin allowlist and five-minute fresh authentication, with audited views and no-store responses. Diagnostics endpoints require signed private gateway proof with no owner, sales or MCP delegation. Browser traffic cannot reach platform-internal endpoints.

Regression checks cover real inventory-sync recording and all triggers, failure followed by recovery before polling, repeated-cause suppression, changed causes, sequence retention/gaps, corrupt ciphertext, concurrent delivery claims, bounded uncertain retries, fleet-wide cooldown, outage fan-out suppression, disabled monitoring and non-admin access. For production acceptance, enqueue one explicitly labelled synthetic test alert in the control outbox, observe ordinary cron delivery and verify the expected mailbox receipt. Do not break a real registrar or occupy its outgoing-IP queue to test alerts.

To stop collection and sending, set only `SYNC_MONITOR_ENABLED=false`, preserving all other gateway bindings. The additive control tables and encrypted diagnostics can remain for investigation. Reverting engine code stops new capture without changing credentials, portfolio cache or existing diagnostic records.
