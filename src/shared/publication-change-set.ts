import { z } from 'zod';
import { saleDomainSchema } from './sales';
export const changeSetScopeSchema = z
  .object({
    kind: z.literal('publish'),
    fullPage: z.boolean().default(false),
    domains: z.array(saleDomainSchema).max(100),
    collectionIds: z.array(z.string().max(80)).max(50),
    catalogue: z.boolean(),
    sales: z
      .array(
        z
          .object({ id: z.string().uuid(), revision: z.string().uuid() })
          .strict(),
      )
      .max(100),
    /** Only these exact listing IDs are added. Shop identity is never copied from a draft. */
    shopListingIds: z.array(z.string().uuid()).max(100),
  })
  .strict();
export const withdrawalScopeSchema = z
  .object({
    kind: z.literal('withdraw'),
    domains: z.array(saleDomainSchema).min(1).max(100),
  })
  .strict();
export const prepareChangeSetSchema = z
  .object({
    requestKey: z.string().uuid(),
    draftRevision: z.string().uuid().nullable(),
    operation: z.union([changeSetScopeSchema, withdrawalScopeSchema]),
  })
  .strict();
export type ChangeSetRequest = z.infer<typeof prepareChangeSetSchema>;
export interface PublicationReceipt {
  id: string;
  requestKey: string;
  committedAt: number;
  kind: 'publish' | 'withdraw';
  domains: string[];
  publicRevision: string | null;
  urls: string[];
  scope: string;
}
