import { z } from 'zod';

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
