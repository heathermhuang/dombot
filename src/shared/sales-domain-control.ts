import { z } from 'zod';
import { saleDomainSchema } from './sales';

export const domainControlLeaseSchema = z
  .object({
    listing: z.string().uuid(),
    domain: saleDomainSchema,
    epoch: z.number().int().positive(),
    reviewAfter: z.number().int().nonnegative().default(0),
    proofId: z.string().regex(/^[a-f0-9]{64}$/),
    observedAt: z.number().int().positive(),
    expiresAt: z.number().int().nonnegative(),
    valid: z.boolean(),
  })
  .strict()
  .refine(
    (v) =>
      v.reviewAfter <= v.epoch &&
      (!v.valid ||
        (v.expiresAt > v.observedAt &&
          v.expiresAt - v.observedAt <= 86400_000)),
    'Control observations last at most 24 hours.',
  );
