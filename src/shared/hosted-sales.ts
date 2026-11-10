import { buyerDetailsSchema } from './inquiry-identity';
import { z } from 'zod';
import { canonicalDomain } from './publication';
import { toCurrencyCode, CURRENCIES, type CurrencyCode } from './currencies';
import { parseCanonicalAmount, formatAmountInput } from './money';

export const saleDomainSchema = z
  .string()
  .max(253)
  .transform((value, ctx) => {
    try {
      const name = canonicalDomain(value);
      if (name.split('.').some((label) => label.length > 63))
        throw new Error('Label too long');
      return name;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid domain name.' });
      return z.NEVER;
    }
  });
/** Exact, bounded checkout money; no floating point or implicit rounding. */
export const saleMoneySchema = z
  .object({
    amount: z.string().regex(/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,4})?$/),
    currency: z
      .string()
      .refine((v) => toCurrencyCode(v) === v, 'Choose a supported currency.'),
  })
  .strict()
  .superRefine((money, ctx) => {
    try {
      const amount = parseCanonicalAmount(
        money.amount,
        money.currency,
        'Price',
      );
      if (!amount || !/[1-9]/.test(amount))
        throw new Error('Use a positive amount.');
    } catch (error) {
      ctx.addIssue({
        code: 'custom',
        message: String(error instanceof Error ? error.message : error),
      });
    }
  });
export function saleMinorUnits(money: {
  amount: string;
  currency: string;
}): bigint {
  const value = saleMoneySchema.parse(money);
  const decimals = CURRENCIES[value.currency as CurrencyCode];
  const [integer, fraction = ''] = value.amount.split('.');
  return BigInt(integer + fraction.padEnd(decimals, '0'));
}
export type SaleMoney = z.infer<typeof saleMoneySchema>;
export const saleModeSchema = z.enum([
  'inquiry',
  'offer',
  'buy-now',
  'external',
]);
export const availabilitySchema = z.enum([
  'available',
  'paused',
  'source-stale',
  'sale-pending',
  'sold',
  'ownership-uncertain',
  'control-lost',
]);
export const destinationSchema = z
  .object({
    id: z.string().uuid(),
    provider: z.enum(['Spaceship', 'Afternic', 'Sedo', 'Atom', 'Efty']),
    url: z.string().url().max(2048),
    revision: z.string().uuid(),
    check: z.enum(['manual', 'verified', 'mismatch', 'expired', 'unavailable']),
    checkedAt: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type SaleDestination = z.infer<typeof destinationSchema>;
export const priceSourceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('market'),
      market: z.enum(['afternic', 'atom', 'sedo']),
      accountId: z.string().min(1).max(128),
      listingName: saleDomainSchema,
      fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      observedAt: z.number().int().nonnegative(),
      validUntil: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('portfolio'),
      fingerprint: z.string().min(1).max(128),
    })
    .strict(),
  z
    .object({
      kind: z.literal('override'),
      price: saleMoneySchema,
      reason: z.string().trim().min(1).max(200),
    })
    .strict(),
]);
export const saleDraftSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    id: z.string().uuid(),
    domain: saleDomainSchema,
    mode: saleModeSchema,
    displayName: z.string().trim().min(1).max(253),
    description: z.string().trim().max(400),
    categories: z.array(z.string().trim().min(1).max(40)).max(10),
    priceSource: priceSourceSchema.nullable(),
    minimumOffer: saleMoneySchema.nullable(),
    destinationId: z.string().uuid().nullable(),
    allowQuestions: z.boolean(),
    sellerDisplayName: z.string().trim().max(100),
    includeInShop: z.boolean(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (
      !saleDomainSchema.safeParse(d.displayName).success ||
      saleDomainSchema.safeParse(d.displayName).data !== d.domain
    )
      ctx.addIssue({
        code: 'custom',
        path: ['displayName'],
        message: 'Display name must be this domain.',
      });
    if (
      d.priceSource?.kind === 'market' &&
      d.priceSource.listingName !== d.domain
    )
      ctx.addIssue({
        code: 'custom',
        path: ['priceSource'],
        message: 'The selected market listing must be this domain.',
      });
    if (d.minimumOffer && d.mode !== 'offer')
      ctx.addIssue({
        code: 'custom',
        path: ['minimumOffer'],
        message: 'Minimum offer is only used for Make Offer.',
      });
  });
export type SaleDraft = z.infer<typeof saleDraftSchema>;
export const publishedSaleSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    id: z.string().uuid(),
    domain: saleDomainSchema,
    displayName: z.string().min(1).max(253),
    mode: saleModeSchema,
    description: z.string().max(400),
    categories: z.array(z.string().max(40)).max(10),
    sourceValidUntil: z.number().int().nonnegative().nullable().optional(),
    providerIntent: z.enum(['buy', 'offer', 'view']).optional(),
    publicPrice: saleMoneySchema.nullable(),
    publicMinimumOffer: saleMoneySchema.nullable(),
    destination: destinationSchema
      .pick({ provider: true, url: true, check: true, checkedAt: true })
      .nullable(),
    allowQuestions: z.boolean(),
    sellerDisplayName: z.string().max(100),
    revision: z.string().uuid(),
    publishedAt: z.number().int().nonnegative(),
  })
  .strict();
export type PublishedSale = z.infer<typeof publishedSaleSchema>;
export const shopDraftSchema = z
  .object({
    version: z.literal(1),
    handle: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
    title: z.string().trim().min(1).max(100),
    intro: z.string().trim().max(600),
    listingIds: z.array(z.string().uuid()).max(20_000),
  })
  .strict()
  .refine(
    (s) => new Set(s.listingIds).size === s.listingIds.length,
    'Select each listing once.',
  );
export type SaleShop = z.infer<typeof shopDraftSchema>;
export const inquirySchema = z
  .object({
    observedRevision: z.string().uuid(),
    idempotencyKey: z.string().uuid(),
    name: z.string().trim().min(1).max(100),
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    offer: saleMoneySchema.nullable(),
    message: z.string().trim().max(4000),
    buyerDetails: buyerDetailsSchema
      .optional()
      .transform((value) =>
        value && Object.values(value).some(Boolean) ? value : undefined,
      ),
    turnstileToken: z.string().max(2048),
    website: z.literal(''),
  })
  .strict()
  .refine((v) => !!v.offer || !!v.message, 'Enter a message or offer.');
export type SaleInquiry = z.infer<typeof inquirySchema>;
export const conversationStatusSchema = z.enum([
  'new',
  'negotiating',
  'awaiting-buyer',
  'agreed',
  'closed',
  'spam',
]);
export const messageSchema = z
  .object({
    direction: z.enum(['reply', 'private-note']),
    body: z.string().trim().min(1).max(4000),
    revision: z.string().uuid(),
    idempotencyKey: z.string().uuid(),
  })
  .strict();
export const deliveryStateSchema = z.enum([
  'queued',
  'leased',
  'accepted',
  'retryable',
  'unknown',
  'failed',
  'suppressed',
  'bounced',
  'delivered',
]);
export type DeliveryState = z.infer<typeof deliveryStateSchema>;
export function emptySale(domain: string, priceFingerprint: string): SaleDraft {
  domain = canonicalDomain(domain);
  return {
    version: 2,
    id: crypto.randomUUID(),
    domain,
    displayName: domain,
    mode: 'inquiry',
    description: '',
    categories: [],
    priceSource: { kind: 'portfolio', fingerprint: priceFingerprint },
    minimumOffer: null,
    destinationId: null,
    allowQuestions: true,
    sellerDisplayName: '',
    includeInShop: false,
  };
}
export function salePriceLabel(price: SaleMoney | null): string {
  return price
    ? `${price.currency} ${formatAmountInput(price.amount, price.currency, 'us')}`
    : 'Request price';
}

/** Public and owner UI use the same reader-facing names; stored modes stay stable. */
export function saleModeLabel(mode: string): string {
  return (
    (
      {
        inquiry: 'Domain inquiry',
        offer: 'Make an offer',
        'buy-now': 'Buy now',
        external: 'Marketplace link',
      } as Record<string, string>
    )[mode] ?? mode
  );
}
