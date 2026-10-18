import { z } from 'zod';
import { saleMoneySchema, saleDomainSchema } from './sales';

export const saleOutcomeSchema = z
  .object({
    state: z.enum([
      'not-started',
      'handed-off',
      'payment-reported',
      'transfer-reported',
      'completed',
      'canceled',
      'unknown',
    ]),
    source: z.literal('seller-entered'),
    evidence: z.string().trim().min(1).max(1000),
    price: saleMoneySchema.nullable(),
    provider: z.string().max(100),
  })
  .strict();
export type SaleOutcome = z.infer<typeof saleOutcomeSchema>;
export const salesPublicationEventSchema = z
  .object({
    kind: z.literal('publication'),
    domain: saleDomainSchema,
    revision: z.string().uuid(),
  })
  .strict();
export const SALE_RETENTION = {
  pendingMs: 7 * 86400_000,
  conversationMs: 365 * 86400_000,
  abuseMs: 86400_000,
  suppressionMs: 90 * 86400_000,
} as const;
