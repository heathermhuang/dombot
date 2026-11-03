import { z } from 'zod';
export const journeyEventSchema = z.enum([
  'page-rendered',
  'provider-opened',
  'inquiry-verified',
  'sale-evidence-linked',
]);
export type JourneyEvent = z.infer<typeof journeyEventSchema>;
export const journeyRowSchema = z
  .object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    listingId: z.string().uuid(),
    event: journeyEventSchema,
    count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();
