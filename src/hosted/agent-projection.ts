import { z } from 'zod';
import {
  publishedSaleSchema,
  saleMinorUnits,
  saleMoneySchema,
} from '../shared/hosted-sales';
import { CURRENCIES } from '../shared/currencies';

export const listingProbeSchema = z
  .object({
    sale: publishedSaleSchema.nullable(),
    intake: z.boolean(),
    sales: z.number().int().nonnegative(),
  })
  .strict();
export type ListingProbe = z.infer<typeof listingProbeSchema>;
export const priceMaxAge = 30 * 86400_000;
export const agentRetention = 30 * 86400_000;
export const catalogHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export function agentUrls(origin: string, domain: string) {
  return {
    listing: new URL('/' + domain, origin).href,
    detail: new URL('/api/agent/listings/' + domain, origin).href,
    discovery: new URL('/' + domain + '/llms.txt', origin).href,
    mcp: new URL('/mcp/catalog', origin).href,
  };
}

export function agentListing(
  probe: ListingProbe,
  origin: string,
  now = Date.now(),
) {
  const sale = probe.sale;
  if (!sale) return null;
  const urls = agentUrls(origin, sale.domain);
  const priceValidUntil = Math.min(
    sale.sourceValidUntil ?? Infinity,
    sale.publishedAt + priceMaxAge,
  );
  const confirmed = sale.publishedAt <= now && priceValidUntil > now;
  const price = confirmed ? sale.publicPrice : null;
  const minimumOffer = confirmed ? sale.publicMinimumOffer : null;
  const intent =
    sale.mode === 'buy-now' && price && sale.destination
      ? 'buy-now'
      : sale.mode === 'offer' || (confirmed && sale.providerIntent === 'offer')
        ? 'make-offer'
        : 'broker-contact';
  const route =
    intent === 'buy-now' || (sale.destination && sale.mode === 'external')
      ? {
          type: 'provider-handoff' as const,
          method: 'GET' as const,
          url: urls.detail + '/provider',
          provider: sale.destination!.provider,
          humanApprovalRequired: true as const,
        }
      : probe.intake && (sale.mode === 'inquiry' || sale.mode === 'offer')
        ? {
            type:
              sale.mode === 'offer'
                ? ('offer' as const)
                : ('broker-brief' as const),
            method: 'POST' as const,
            url: urls.detail + '/inquiries',
            browserUrl: urls.listing + '?from=agent',
            humanApprovalRequired: true as const,
            buyerVerificationRequired: true as const,
          }
        : null;

  return {
    domain: sale.domain,
    description: sale.description,
    categories: sale.categories,
    forSale: true as const,
    availability: 'published' as const,
    askingPrice: price,
    minimumOffer,
    offerCurrency:
      sale.mode === 'offer'
        ? (sale.publicPrice?.currency ??
          sale.publicMinimumOffer?.currency ??
          'USD')
        : null,
    priceStatus: price
      ? 'confirmed'
      : confirmed
        ? 'request-price'
        : 'needs-reconfirmation',
    lastVerified: new Date(sale.publishedAt).toISOString(),
    priceValidUntil: price ? new Date(priceValidUntil).toISOString() : null,
    revision: sale.revision,
    terms: intent,
    route,
    urls,
    dnsRecord: {
      name: '_mcp.' + sale.domain,
      type: 'TXT',
      value:
        'v=mcp1; url=' + urls.mcp + '; proto=mcp; transport=streamable-http',
    },
  };
}

const optionalPrice = z
  .string()
  .regex(/^(?:0|[1-9][0-9]{0,11})(?:\.[0-9]{1,4})?$/)
  .optional();
export const agentSearchSchema = z
  .object({
    q: z.string().trim().max(120).default(''),
    currency: z
      .string()
      .refine((value) => Object.hasOwn(CURRENCIES, value))
      .optional(),
    minPrice: optionalPrice,
    maxPrice: optionalPrice,
    cursor: z.string().max(700).default(''),
    limit: z.coerce.number().int().min(1).max(20).default(10),
  })
  .superRefine((value, ctx) => {
    if ((value.minPrice || value.maxPrice) && !value.currency)
      ctx.addIssue({
        code: 'custom',
        message: 'Choose a currency for price filters.',
      });
    if (!value.currency) return;
    const bounds = [value.minPrice, value.maxPrice].map((amount) => {
      if (amount == null || Number(amount) === 0) return 0n;
      const money = saleMoneySchema.safeParse({
        amount,
        currency: value.currency,
      });
      if (money.success) return saleMinorUnits(money.data);
      ctx.addIssue({
        code: 'custom',
        message: 'Use an amount valid for the selected currency.',
      });
      return 0n;
    });
    if (
      value.minPrice != null &&
      value.maxPrice != null &&
      bounds[0] > bounds[1]
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Minimum price exceeds maximum price.',
      });
  });
export type AgentSearch = z.infer<typeof agentSearchSchema>;

export function priceMatches(
  listing: NonNullable<ReturnType<typeof agentListing>>,
  filter: AgentSearch,
) {
  if (!filter.currency) return true;
  const price = listing.askingPrice;
  if (price?.currency !== filter.currency) return false;
  const amount = saleMinorUnits(price);
  const bound = (value: string) =>
    Number(value) === 0
      ? 0n
      : saleMinorUnits({ amount: value, currency: price.currency });
  return (
    (filter.minPrice == null || amount >= bound(filter.minPrice)) &&
    (filter.maxPrice == null || amount <= bound(filter.maxPrice))
  );
}

// Inspectable concept expansion over seller-published text.
const concepts = [
  [
    'ai',
    'artificial intelligence',
    'machine learning',
    'automation',
    'agent',
    'robotics',
  ],
  [
    'finance',
    'fintech',
    'banking',
    'payments',
    'lending',
    'wealth',
    'investing',
    'insurance',
  ],
  [
    'health',
    'healthcare',
    'wellness',
    'medical',
    'clinic',
    'therapy',
    'fitness',
  ],
  ['travel', 'tourism', 'hotel', 'vacation', 'booking', 'hospitality'],
  ['education', 'edtech', 'learning', 'school', 'course', 'tutor', 'classroom'],
  ['property', 'real estate', 'realty', 'housing', 'rental', 'mortgage'],
  [
    'shop',
    'store',
    'commerce',
    'retail',
    'marketplace',
    'shopping',
    'ecommerce',
  ],
  ['security', 'cybersecurity', 'privacy', 'identity', 'authentication'],
  ['climate', 'energy', 'solar', 'sustainability', 'renewables', 'cleantech'],
  ['food', 'restaurant', 'dining', 'catering', 'grocery', 'meal'],
  ['developer', 'software', 'coding', 'platform', 'saas', 'cloud'],
];
export function catalogMatch(query: string) {
  const words =
    query
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu)
      ?.slice(0, 12) ?? [];
  if (!words.length) return '';
  const stop = new Set([
    'a',
    'an',
    'for',
    'the',
    'and',
    'or',
    'with',
    'by',
    'of',
    'to',
    'under',
    'domain',
    'domains',
    'name',
    'names',
    'business',
    'startup',
  ]);
  const terms = new Set(words.filter((word) => !stop.has(word)));
  const normalized = words.join(' ');
  for (const group of concepts) {
    if (
      group.some((term) => (' ' + normalized + ' ').includes(' ' + term + ' '))
    )
      group.forEach((term) => terms.add(term));
  }
  return [...(terms.size ? terms : words)]
    .slice(0, 35)
    .map(
      (term) =>
        '"' + term + '"' + (term.length >= 4 && !term.includes(' ') ? '*' : ''),
    )
    .join(' OR ');
}
