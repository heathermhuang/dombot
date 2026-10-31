import { z } from 'zod';
const count = z.number().int().nonnegative().safe();
export const adminInventoryQuerySchema = z.object({
  q: z.string().max(120).default(''),
  offset: count.max(1_000_000).default(0),
  limit: z.number().int().min(1).max(100).default(50),
  state: z.enum(['owned', 'archived', 'all']).default('owned'),
});
export type AdminInventoryQuery = z.infer<typeof adminInventoryQuerySchema>;
export const adminInventoryRowSchema = z.object({
  domain: z.string().max(253),
  registrar: z.string().max(120),
  accountId: z.string().max(160),
  accountLabel: z.string().max(160),
  source: z.enum(['registrar', 'imported']),
  archived: z.boolean(),
  departed: z.boolean(),
  ambiguous: z.boolean(),
  expiresAt: count.nullable(),
  inventoryAt: count.nullable(),
  inventoryStale: z.boolean(),
  renewal: z
    .string()
    .regex(/^\d+(?:\.\d+)?$/)
    .nullable(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  priceSource: z.enum([
    'api',
    'portal',
    'tld',
    'base',
    'manual',
    'unavailable',
  ]),
  quoteAt: count.nullable(),
  priceAge: z.enum([
    'current',
    'stale',
    'unknown',
    'estimate',
    'manual',
    'unavailable',
  ]),
});
export type AdminInventoryRow = z.infer<typeof adminInventoryRowSchema>;
export const adminInventorySchema = z.object({
  at: count,
  available: z.boolean(),
  owned: count,
  archived: count,
  unobservedAccounts: count,
  failedAccounts: count,
  staleAccounts: count,
  priced: count,
  unpriced: count,
  ambiguous: count,
  stalePrices: count,
  totals: z
    .array(
      z.object({
        currency: z.string().regex(/^[A-Z]{3}$/),
        amount: z.string().regex(/^\d+(?:\.\d+)?$/),
        domains: count,
      }),
    )
    .max(200),
  query: adminInventoryQuerySchema,
  matched: count,
  rows: z.array(adminInventoryRowSchema).max(100),
});
export type AdminInventory = z.infer<typeof adminInventorySchema>;
