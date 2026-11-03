import { z } from 'zod';
import { isRateCurrency } from '../shared/currencies';
import { assertDomainName } from '../shared/domain-name';
import { readDomain } from '../shared/import-values';
import { parseCanonicalAmount, parsePurchaseDate } from '../shared/money';
import { toListPrice } from '../shared/list-prices';

// Mirror the pinned engine API shape at the hosted boundary. Semantic checks
// below are stricter so malformed first imports cannot allocate infrastructure.
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const decimal = z.string().regex(/^\d{1,15}(\.\d{1,3})?$/);
// One of the 30 DomBot converts: an import enters new amounts.
const currencyCode = z.string().refine(isRateCurrency, {
  message: 'Not one of the 30 currencies DomBot converts.',
});

const importRow = z
  .object({
    line: z.number().int().min(0),
    domain: z.string().trim().min(1).max(253),
    status: z.enum(['sold', 'ignored']).optional(),
    folder: z.string().trim().min(1).max(100).optional(),
    notes: z.string().max(4000).optional(),
    registration: z
      .object({
        registrar: z.string().max(40).optional(),
        registrarLabel: z.string().max(100).optional(),
        createdDate: day.optional(),
        expirationDate: day.optional(),
        autoRenew: z.boolean().optional(),
      })
      .strict()
      .optional(),
    renewal: z
      .object({ amount: decimal, currency: currencyCode })
      .strict()
      .optional(),
    listPrice: z
      .object({
        amount: decimal.optional(),
        minOffer: decimal.optional(),
        floor: decimal.optional(),
        currency: currencyCode,
      })
      .strict()
      .optional(),
    purchase: z
      .object({
        type: z.enum(['registered', 'purchased']).optional(),
        date: day.optional(),
        amount: decimal.optional(),
        currency: currencyCode.optional(),
        years: z.number().int().min(1).max(10).optional(),
      })
      .strict()
      .refine((p) => !p.amount || p.currency, 'An amount needs a currency.')
      .optional(),
    sale: z
      .object({
        date: day.optional(),
        amount: decimal.optional(),
        currency: currencyCode.optional(),
      })
      .strict()
      .refine((s) => !s.amount || s.currency, 'An amount needs a currency.')
      .optional(),
  })
  .strict();

const importRows = z.array(importRow).max(10000);

const importApply = z.object({ importId: z.string().min(1).max(80) }).strict();

const submission = z
  .object({ args: z.tuple([importRows.min(1), importApply]) })
  .strict();

/** Validate before any setup request or provider mutation. Raw CSV stays in the
 * browser; these are the same normalized rows accepted by the tenant API. */
export function validFirstImport(value: unknown): boolean {
  const parsed = submission.safeParse(value);
  if (!parsed.success) return false;
  try {
    for (const row of parsed.data.args[0]) {
      if (readDomain(row.domain) !== assertDomainName(row.domain)) return false;
      for (const date of [
        row.registration?.createdDate,
        row.registration?.expirationDate,
        row.purchase?.date,
        row.sale?.date,
      ])
        if (date) parsePurchaseDate(date);
      for (const money of [row.renewal, row.purchase, row.sale])
        if (money?.amount)
          parseCanonicalAmount(money.amount, money.currency!, 'Amount');
      if (row.listPrice)
        toListPrice(
          {
            amount: row.listPrice.amount,
            minOffer: row.listPrice.minOffer,
            floor: row.listPrice.floor,
            currency: row.listPrice.currency,
          },
          0,
          { kept: null },
        );
    }
    return true;
  } catch {
    return false;
  }
}
