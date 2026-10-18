import { z } from 'zod';
import { publishedSaleSchema } from './sales';

export const salesReviewSchema = z
  .object({
    version: z.literal(1),
    id: z.string().uuid(),
    expiresAt: z.number().int(),
    shopRevision: z.string().uuid().nullable(),
    items: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            revision: z.string().uuid(),
            priceFingerprint: z.string(),
            ownershipFingerprint: z.string(),
            destinationRevision: z.string().uuid().nullable(),
            operationalRevision: z.string().uuid(),
            includeInShop: z.boolean(),
            beforeIncludeInShop: z.boolean(),
            controlObservedAt: z.number().int().nonnegative(),
            before: publishedSaleSchema.nullable(),
            after: publishedSaleSchema,
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export type SalesReview = z.infer<typeof salesReviewSchema>;
export class SalesError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: 400 | 403 | 404 | 409 | 429 | 503 = 400,
  ) {
    super(message);
  }
}
export const conflict = (
  message = 'This record changed. Review the saved version before trying again.',
) => new SalesError('REVISION_CHANGED', message, 409);
