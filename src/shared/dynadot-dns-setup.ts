import { z } from 'zod';
import { saleDomainSchema } from './hosted-sales';
export const dynadotDnsSetupScopeSchema = z
  .object({
    workspace: z.string().uuid(),
    domain: saleDomainSchema,
    accountId: z.string().min(1).max(128),
    requestId: z.string().uuid(),
    expiresAt: z.number().int().positive(),
    qualifyConnection: z.literal(true).optional(),
  })
  .strict();
export type DynadotDnsSetupScope = z.infer<typeof dynadotDnsSetupScopeSchema>;
export function dynadotDnsSetupScope(
  raw: string | undefined,
  workspace: string,
  now = Date.now(),
) {
  if (!raw) return null;
  try {
    const parsed = dynadotDnsSetupScopeSchema.safeParse(JSON.parse(raw));
    return parsed.success &&
      parsed.data.workspace === workspace &&
      parsed.data.expiresAt > now &&
      parsed.data.expiresAt <= now + 86400000
      ? parsed.data
      : null;
  } catch {
    return null;
  }
}
