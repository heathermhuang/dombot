import { z } from 'zod';
import { openPlatformKey } from './platform-keys';

// Operator configuration, never a caller-selected Worker/database binding.
export const workspaceSchema = z
  .array(
    z.object({
      id: z.string().uuid(),
      binding: z.string().regex(/^WORKSPACE_(?:[0-9]|[12][0-9]|3[01])$/),
      label: z.string().min(1).max(120),
    }),
  )
  .max(32)
  .superRefine((rows, context) => {
    for (const field of ['id', 'binding'] as const)
      if (new Set(rows.map((row) => row[field])).size !== rows.length)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate workspace ${field}`,
        });
  });
export function workspaceService(
  env: HostedEnv,
  binding: string,
): Pick<Fetcher, 'fetch'> {
  if (/^PLATFORM:[0-9a-f-]{36}$/.test(binding)) {
    const id = z.string().uuid().parse(binding.slice(9));
    if (env.PLATFORM_ENABLED !== 'true' || !env.DISPATCHER)
      throw Error('Platform dispatcher unavailable');
    return env.DISPATCHER.get(`dombot-wfp-${id}`);
  }
  const service: unknown = Reflect.get(env, binding);
  if (
    !service ||
    typeof service !== 'object' ||
    !('fetch' in service) ||
    typeof service.fetch !== 'function'
  )
    throw new Error('Configured workspace service is unavailable');
  return service as Pick<Fetcher, 'fetch'>;
}
export function gatewayKey(env: HostedEnv, id: string): string {
  const schema = z.record(z.string().min(32));
  const existing = schema.parse(JSON.parse(env.GATEWAY_KEYS));
  const added = schema.parse(JSON.parse(env.EXTRA_GATEWAY_KEYS ?? '{}'));
  if (Object.keys(added).some((key) => key in existing))
    throw new Error('Workspace key configuration overlaps');
  const key = existing[id] ?? added[id];
  if (!key) throw new Error('Workspace gateway key is unavailable');
  return key;
}

/** Immutable legacy mappings take precedence; no existing customer is migrated. */
export async function workspaceFor(env: HostedEnv, id: string) {
  const legacy = workspaceSchema
    .parse(JSON.parse(env.WORKSPACES))
    .find((w) => w.id === id);
  if (legacy) return legacy;
  if (
    env.PLATFORM_ENABLED !== 'true' ||
    !env.DISPATCHER ||
    !z.string().uuid().safeParse(id).success
  )
    return null;
  const row = await env.CONTROL_DB.prepare(
    'SELECT w.id,w.label FROM platform_workspaces p JOIN workspaces w ON w.id=p.workspace_id WHERE p.workspace_id=?1 AND p.qualified_at>0 AND w.enabled=1',
  )
    .bind(id)
    .first<{ id: string; label: string }>();
  return row ? { ...row, binding: `PLATFORM:${row.id}` } : null;
}
export async function workspaceKey(
  env: HostedEnv,
  id: string,
): Promise<string> {
  if (
    workspaceSchema.parse(JSON.parse(env.WORKSPACES)).some((w) => w.id === id)
  )
    return gatewayKey(env, id);
  if (!(await workspaceFor(env, id)))
    throw Error('Workspace gateway key unavailable');
  const row = await env.CONTROL_DB.prepare(
    'SELECT gateway_key_box FROM platform_workspaces WHERE workspace_id=?1 AND qualified_at>0',
  )
    .bind(id)
    .first<{ gateway_key_box: string }>();
  if (!row) throw Error('Workspace gateway key unavailable');
  return openPlatformKey(env.AUTH_PEPPER, id, row.gateway_key_box);
}
