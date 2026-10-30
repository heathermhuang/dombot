import { z } from 'zod';
import { Accounts } from './accounts';
import { onDemandSchemaReady } from './on-demand';
import { workspaceFor, workspaceKey, workspaceService } from './workspaces';
import { PROOF_HEADER, signGatewayRequest } from '../shared/gateway-proof';

export const renewalContinuationSchema = z.object({
  remaining: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative().optional(),
  nextAt: z.number().finite().nonnegative().optional(),
  paused: z.boolean().optional(),
  disabled: z.boolean().optional(),
});
export type RenewalContinuation = z.infer<typeof renewalContinuationSchema>;

/** These exact counters are also used by browser pricing. Keep five of the
 * twenty provider slots available to owner-initiated refreshes. */
export async function reservePricingStep(env: HostedEnv, workspace: string) {
  const accounts = new Accounts(env.CONTROL_DB, env.AUTH_PEPPER);
  return (
    (await accounts.rateLimit(`pricing:${workspace}`, 15)) &&
    (await accounts.rateLimit(`provider:${workspace}`, 20))
  );
}

async function pricingRequest(
  env: HostedEnv,
  workspace: string,
  step: boolean,
) {
  const configured = await workspaceFor(env, workspace);
  if (!configured) throw Error('Pricing workspace unavailable');
  const request = new Request(
    'https://workspace.internal/platform-internal/renewal-pricing',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step }),
      signal: AbortSignal.timeout(135_000),
    },
  );
  request.headers.set(
    PROOF_HEADER,
    await signGatewayRequest(
      await workspaceKey(env, workspace),
      workspace,
      null,
      request,
    ),
  );
  const response = await workspaceService(env, configured.binding).fetch(
    request,
  );
  if (!response.ok) {
    await response.body?.cancel();
    throw Error('Pricing continuation unavailable');
  }
  return renewalContinuationSchema.parse(await response.json());
}

/** Existing two-minute gateway cron; durable claims fence overlapping runs.
 * Only owned, admitted portfolios with recorded Dynadot activity are visited.
 * An uncertain step is never immediately replayed. Tenant jobs remain the source
 * of truth, and all provider calls still enter the shared Dynadot lane. */
export async function continueRenewalPricing(env: HostedEnv): Promise<void> {
  if (env.RENEWAL_PRICING_ENABLED !== 'true') return;
  const started = Date.now();
  await env.CONTROL_DB.prepare(
    `INSERT OR IGNORE INTO renewal_pricing_checks(workspace_id)
    SELECT DISTINCT u.workspace_id FROM users u JOIN workspaces w ON w.id=u.workspace_id
    JOIN sync_monitor_accounts a ON a.workspace_id=w.id WHERE w.enabled=1
    ${onDemandSchemaReady(env) ? 'AND NOT EXISTS(SELECT 1 FROM pending_workspaces p WHERE p.workspace_id=w.id AND p.activated_at IS NULL)' : ''}`,
  ).run();
  const rows = (
    await env.CONTROL_DB.prepare(
      `SELECT c.workspace_id,MAX(COALESCE(a.last_good_at,0)) inventory_at
    FROM renewal_pricing_checks c JOIN workspaces w ON w.id=c.workspace_id
    JOIN users u ON u.workspace_id=w.id JOIN sync_monitor_accounts a ON a.workspace_id=w.id
    WHERE w.enabled=1 AND c.lease_until<?1
    ${onDemandSchemaReady(env) ? 'AND NOT EXISTS(SELECT 1 FROM pending_workspaces p WHERE p.workspace_id=w.id AND p.activated_at IS NULL)' : ''}
    GROUP BY c.workspace_id HAVING c.next_at<=?1 OR MAX(COALESCE(a.last_good_at,0))>c.inventory_at
    ORDER BY c.checked_at,c.workspace_id LIMIT 25`,
    )
      .bind(started)
      .all<{ workspace_id: string; inventory_at: number }>()
  ).results;
  for (const row of rows) {
    if (Date.now() - started >= 90_000) break;
    const lease = crypto.randomUUID();
    const claim = await env.CONTROL_DB.prepare(
      'UPDATE renewal_pricing_checks SET lease=?,lease_until=? WHERE workspace_id=? AND lease_until<? AND (next_at<=? OR inventory_at<?) RETURNING workspace_id',
    )
      .bind(
        lease,
        Date.now() + 300_000,
        row.workspace_id,
        Date.now(),
        Date.now(),
        row.inventory_at,
      )
      .first();
    if (!claim) continue;
    let status: RenewalContinuation | undefined;
    let nextAt = Date.now() + 600_000;
    let outcome = 'unavailable';
    try {
      status = await pricingRequest(env, row.workspace_id, false);
      for (let step = 0; step < 15 && Date.now() - started < 90_000; step++) {
        if (
          status.paused ||
          status.disabled ||
          !status.remaining ||
          (status.nextAt ?? 0) > Date.now()
        )
          break;
        if (!(await reservePricingStep(env, row.workspace_id))) {
          nextAt = (Math.floor(Date.now() / 600_000) + 1) * 600_000;
          break;
        }
        status = await pricingRequest(env, row.workspace_id, true);
      }
      outcome = status.paused
        ? 'paused'
        : status.disabled
          ? 'disabled'
          : status.blocked
            ? 'blocked'
            : status.remaining
              ? 'pending'
              : status.failed
                ? 'failed'
                : 'complete';
      nextAt =
        status.paused || status.disabled || !status.remaining
          ? Date.now() + 3600_000
          : Math.max(nextAt, status.nextAt ?? 0);
    } catch {
      // No raw provider messages, account credentials or holdings in diagnostics.
      outcome = 'unavailable';
    } finally {
      await env.CONTROL_DB.prepare(
        'UPDATE renewal_pricing_checks SET lease=NULL,lease_until=0,checked_at=?,next_at=?,inventory_at=?,outcome=?,remaining=?,failed=?,blocked=? WHERE workspace_id=? AND lease=?',
      )
        .bind(
          Date.now(),
          nextAt,
          row.inventory_at,
          outcome,
          status?.remaining ?? null,
          status?.failed ?? null,
          status?.blocked ?? null,
          row.workspace_id,
          lease,
        )
        .run();
    }
  }
}
