import { z } from 'zod';
import { saleDomainSchema } from './sales';

/** Operator deployment metadata, never accepted from a seller request or backup. */
const lease = {
  observedAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
};
export const managedControlSchema = z
  .object({
    workspace: z.string().uuid(),
    domain: saleDomainSchema,
    proofId: z.string().regex(/^[a-f0-9]{64}$/),
    ...lease,
  })
  .strict()
  .refine(
    (v) =>
      v.expiresAt > v.observedAt && v.expiresAt - v.observedAt <= 86400_000,
    'Control observations last at most 24 hours.',
  );
export const managedHostSchema = z
  .object({
    workspace: z.string().uuid(),
    hostname: saleDomainSchema,
    domain: saleDomainSchema,
    providerId: z.string().min(1).max(100),
    service: z.literal('domains-sales-lander'),
    ...lease,
  })
  .strict()
  .refine(
    (v) =>
      v.expiresAt > v.observedAt && v.expiresAt - v.observedAt <= 86400_000,
    'Provider observations last at most 24 hours.',
  );
function read<T>(raw: string | undefined, schema: z.ZodType<T>): T[] {
  try {
    return z
      .array(schema)
      .max(10)
      .parse(JSON.parse(raw ?? '[]'));
  } catch {
    return [];
  }
}
export const managedControls = (raw?: string) =>
  read(raw, managedControlSchema);
export const managedHosts = (raw?: string) => read(raw, managedHostSchema);
export function managedControl(
  env: {
    DOMBOT_AUTH?: string;
    DOMBOT_WORKSPACE_ID?: string;
    DOMBOT_SALES_DNS_CONTROL?: string;
  },
  domain: string,
  now = Date.now(),
) {
  if (env.DOMBOT_AUTH !== 'gateway' || !env.DOMBOT_WORKSPACE_ID) return null;
  return (
    managedControls(env.DOMBOT_SALES_DNS_CONTROL).find(
      (v) =>
        v.workspace === env.DOMBOT_WORKSPACE_ID &&
        v.domain === domain &&
        v.observedAt <= now &&
        v.expiresAt > now,
    ) ?? null
  );
}
