# Production Dynadot sync monitoring

The gateway's existing two-minute Cloudflare cron reads an indexed, encrypted diagnostics document from up to 25 enabled, occupied portfolios per run. It never starts registrar requests. At 39 enabled portfolios a fleet cycle is approximately four minutes; the admin page computes the current estimate. Check `/admin/sync-monitor` for actual coverage and the last completed collector run. A stopped cron cannot email about its own outage; stale coverage is shown in the dashboard.

From engine `1.5.2-hosted.13`, the common Dynadot inventory-sync path records completed browser/manual, MCP and scheduled attempts. Each event includes an immutable attempt ID, monotonic sequence, account ID, start/completion time, duration, last successful sync, domain count, trigger, route class, allowlisted failure category, numeric HTTP status when available, engine version and exact source hash. Raw messages, provider responses, credentials, URLs, account labels and domain names are never recorded. Unknown causes remain `unknown`; classification is evidence, not a definitive root-cause claim. A process terminated before recording its outcome is outside completed-attempt coverage.

A local, non-cache namespace survives cache clearing and data imports. A single encrypted document atomically pairs its revision and up to 200 attempts for 30 days. Collection archives attempts in the control database for 30 days. It detects retention gaps or sequence resets instead of treating lost diagnostics as healthy. A successful retry cannot erase the preceding failure.

## Incident and email policy

`SYNC_MONITOR_ENABLED=true` enables collection and dispatch. The production recipient is `heathermhuang@gmail.com`; sending additionally requires that address to resolve to an enabled account in `ADMIN_USER_IDS`. The existing verified transactional `EMAIL` binding sends from `accounts@mail.domains.domains`. Authentication-email quotas and customer settings are unchanged. Other deployments default to disabled.

A new failure incident, a change in classified cause/status/route/engine, and successful recovery create durable alerts. Identical continuing failures retain every attempt without repeated incident alerts. Two failed collector observations create a monitoring-unavailable alert; recovery creates a restored alert. A retention gap creates its own alert. Previously unseen failures are alerted even when recovery occurred before the next poll.

A leased collector and transactionally claimed outbox prevent concurrent routine sends. Up to five messages are attempted per run, with a separate ten-attempt hourly budget. Excess alerts remain queued. Email binding acceptance is retained with its message ID. It does not prove inbox delivery. The binding provides no documented idempotency key: uncertain delivery is visible and retried after ten minutes, up to three attempts using the same alert ID; duplicates are possible after ambiguous acceptance. Exhausted uncertain alerts remain on the dashboard for follow-up. Sent alerts expire after 30 days; outstanding alerts remain until resolved operationally.

## Access, verification and rollback

The dashboard uses the existing sole-admin allowlist and five-minute fresh authentication, with audited views and no-store responses. Diagnostics endpoints require signed private gateway proof with no owner, sales or MCP delegation. Browser traffic cannot reach platform-internal endpoints.

Regression checks cover real inventory-sync recording and all triggers, failure followed by recovery before polling, repeated-cause suppression, changed causes, sequence retention/gaps, corrupt ciphertext, concurrent delivery claims, bounded uncertain retries, disabled monitoring and non-admin access. For production acceptance, enqueue one explicitly labelled synthetic test alert in the control outbox, observe ordinary cron delivery and verify the expected mailbox receipt. Do not break a real registrar or occupy its outgoing-IP queue to test alerts.

To stop collection and sending, set only `SYNC_MONITOR_ENABLED=false`, preserving all other gateway bindings. The additive control tables and encrypted diagnostics can remain for investigation. Reverting engine code stops new capture without changing credentials, portfolio cache or existing diagnostic records.
