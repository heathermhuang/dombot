import { z } from 'zod';
import { sealPlatformKey } from './platform-keys';
import type { SessionUser } from './accounts';

export const ON_DEMAND = '@on-demand-workspace';
export function accountLimit(env: HostedEnv): number {
  const value = Number(env.ON_DEMAND_ACCOUNT_LIMIT ?? '500');
  return Number.isSafeInteger(value) && value > 0 && value <= 10000 ? value : 0;
}
export function onDemandReady(env: HostedEnv): boolean {
  return (
    accountLimit(env) > 0 &&
    env.ON_DEMAND_ENABLED === 'true' &&
    !!env.PROVISIONER &&
    env.PLATFORM_ENABLED === 'true' &&
    !!env.DISPATCHER &&
    /^[a-f0-9]{64}$/.test(env.ON_DEMAND_TEMPLATE_SHA256 ?? '')
  );
}

export function onDemandSchemaReady(env: HostedEnv) {
  return (
    env.ON_DEMAND_ENABLED === 'true' ||
    /^[a-f0-9]{64}$/.test(env.ON_DEMAND_TEMPLATE_SHA256 ?? '')
  );
}
export async function pendingWorkspace(env: HostedEnv, id: string) {
  if (!onDemandSchemaReady(env)) return false;
  return !!(await env.CONTROL_DB.prepare(
    'SELECT 1 FROM pending_workspaces q JOIN workspaces w ON w.id=q.workspace_id WHERE q.workspace_id=? AND q.activated_at IS NULL AND w.enabled=1',
  )
    .bind(id)
    .first());
}

export const provisionReceipt = z.object({
  workspace: z.string().uuid(),
  databaseId: z.string().uuid(),
  gatewayKey: z.string().regex(/^[a-f0-9]{64}$/),
  engine: z.string().min(1).max(100),
  templateSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ProvisionReceipt = z.infer<typeof provisionReceipt>;

/** Called only after an authenticated, same-origin owner mutation. No registrar
 * credentials or imports enter the provisioner or the control database. */
export async function activateWorkspace(
  env: HostedEnv,
  user: SessionUser,
  reason: 'registrar' | 'import',
) {
  if (!onDemandReady(env))
    throw Error(
      'Portfolio setup is temporarily unavailable. Please try again later.',
    );
  const requested = await env.CONTROL_DB.prepare(
    'UPDATE pending_workspaces SET requested_at=COALESCE(requested_at,?),reason=COALESCE(reason,?) WHERE workspace_id=? AND activated_at IS NULL AND EXISTS(SELECT 1 FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE u.id=? AND w.id=pending_workspaces.workspace_id AND w.enabled=1) RETURNING workspace_id',
  )
    .bind(Date.now(), reason, user.workspace_id, user.id)
    .first();
  if (!requested) throw Error('Portfolio setup is unavailable. Sign in again.');
  const receipt = provisionReceipt.parse(
    await env.PROVISIONER!.provision(user.workspace_id, user.id),
  );
  if (
    receipt.workspace !== user.workspace_id ||
    receipt.templateSha256 !== env.ON_DEMAND_TEMPLATE_SHA256
  )
    throw Error(
      'Portfolio setup needs operator attention. Please contact support.',
    );
  const box = await sealPlatformKey(
    env.AUTH_PEPPER,
    user.workspace_id,
    receipt.gatewayKey,
  );
  // Admission and activation commit together. A closure that wins the race
  // prevents admission. No existing registry row or customer key is overwritten.
  const now = Date.now();
  await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare(
      'INSERT INTO platform_workspaces(workspace_id,database_id,gateway_key_box,engine_version,qualified_at,signup_enabled,created_at) SELECT q.workspace_id,?,?,?, ?,0,? FROM pending_workspaces q JOIN workspaces w ON w.id=q.workspace_id JOIN users u ON u.workspace_id=w.id WHERE q.workspace_id=? AND q.activated_at IS NULL AND u.id=? AND w.enabled=1 ON CONFLICT(workspace_id) DO NOTHING',
    ).bind(
      receipt.databaseId,
      box,
      receipt.engine,
      now,
      now,
      user.workspace_id,
      user.id,
    ),
    env.CONTROL_DB.prepare(
      'UPDATE pending_workspaces SET activated_at=? WHERE workspace_id=? AND EXISTS(SELECT 1 FROM platform_workspaces p JOIN workspaces w ON w.id=p.workspace_id WHERE p.workspace_id=pending_workspaces.workspace_id AND p.database_id=? AND p.qualified_at>0 AND w.enabled=1)',
    ).bind(now, user.workspace_id, receipt.databaseId),
  ]);
  const admitted = await env.CONTROL_DB.prepare(
    'SELECT 1 FROM pending_workspaces q JOIN platform_workspaces p ON p.workspace_id=q.workspace_id JOIN workspaces w ON w.id=p.workspace_id WHERE q.workspace_id=? AND q.activated_at IS NOT NULL AND p.database_id=? AND w.enabled=1',
  )
    .bind(user.workspace_id, receipt.databaseId)
    .first();
  if (!admitted) throw Error('Portfolio setup could not finish. Please retry.');
}
