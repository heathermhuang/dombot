import { z } from 'zod';
import { saleDomainSchema, saleMoneySchema } from '../shared/hosted-sales';
export const checkoutThreadToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const checkoutCaseSchema = z
  .object({
    caseId: z.uuid(),
    domain: saleDomainSchema,
    listing: z.uuid(),
    revision: z.uuid(),
    price: saleMoneySchema,
    thread: checkoutThreadToken.optional(),
  })
  .strict();
export type CheckoutCase = z.input<typeof checkoutCaseSchema>;

export const checkoutLookupSchema = z
  .object({ thread: checkoutThreadToken })
  .strict();

export const checkoutReviewSchema = z.object({ caseId: z.uuid() }).strict();
