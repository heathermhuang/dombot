# Automatic hosted renewal pricing

Dynadot renewal pricing covers every currently held name, including uniform
TLDs. A cached inventory read projects missing or expired quotes into its pending
count; a pricing step persists the repaired queue before contacting the provider.
This also upgrades older queues without an inventory refresh or operator packet.
Current-generation failures, pending order, actual cooldowns and retry attempts
remain intact. A successful new inventory generation starts a new pricing job.
Valid recent quotes are reused for 24 hours; invalid provider amounts/currencies
cannot replace an existing quote. Manual overrides retain their precedence.

With control migration 0019 and `RENEWAL_PRICING_ENABLED=true`, the existing
two-minute gateway cron continues jobs without an open browser. It visits only
owned, enabled, admitted portfolios with recorded Dynadot sync activity. Empty
signup metadata and unused resources are not invoked. Per-portfolio durable
leases fence overlapping runs, including checkpoints selected before another
run finishes. No names, quote amounts or credentials enter the control ledger.

The browser and central continuation share the same 15 pricing steps per
10-minute bucket and 20 total provider-refresh slots, retaining five slots for
owner refreshes. Each step still processes at most one quote per active account,
uses the common global Dynadot lane, and honors saved provider cooldowns and
bounded retry limits. The central run starts at most 15 steps per portfolio and
stops starting work after 90 seconds across at most 25 portfolios. Checkpoints
rotate oldest first. Failed or uncertain requests stop that portfolio's batch;
there is no immediate replay of a possibly committed step.

The private null-owner gateway proof permits only status or a single read-only
pricing step. The tenant coordinator serializes the operation with browser and
scheduled work. Paused maintenance and disabled automatic sync stop central
continuation. A status read never rearms an empty or paused portfolio. Provider
work remains in the existing encrypted tenant job and detail namespaces.

Once `DOMBOT_CENTRAL_PRICING=true` is installed on a tenant, its old scheduled
handler skips the additional unmetered price step; inventory scheduling and the
saved interval remain unchanged. Standalone/desktop installations retain their
existing scheduling. During release, deploy compatible readers first, apply the
additive control migration, qualify a controlled tenant, update the fleet and
on-demand template, then enable central continuation. Preserve keys, database
identities, proxy routes, quotas, pauses and actual backoffs. Rollback disables
central continuation and removes the tenant opt-in if native steps are needed.

Production acceptance requires actual new provider quote timestamps under native
continuation with the browser driver stopped, plus coherent job generations,
preserved manual overrides, and independently checked app-facing price sources.
An empty queue alone does not establish complete or fresh quote coverage.
