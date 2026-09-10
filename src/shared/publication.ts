import { z } from 'zod';

/** Public content is an allowlist, never a serialized registrar domain. */
export function canonicalDomain(value: string): string {
  const input = value.trim().replace(/\.$/, '');
  if (/[\s/:@?#\\]/.test(input))
    throw new Error('Enter a domain name, without a URL.');
  const name = new URL(`https://${input}`).hostname.toLowerCase();
  if (
    name.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]*$/.test(name)
  ) {
    throw new Error('Enter a valid domain name.');
  }
  return name;
}

const domain = z
  .string()
  .max(253)
  .transform((value, ctx) => {
    try {
      return canonicalDomain(value);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid domain name',
      });
      return z.NEVER;
    }
  });
export const listingSchema = z
  .object({
    domain,
    collection: z.string().trim().max(200),
    description: z.string().trim().max(400),
    visibility: z.enum(['private', 'showcase', 'inquiry', 'historical']),
    askingPrice: z.number().finite().positive().max(1e12).nullable(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();
export const draftSchema = z
  .object({
    handle: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/),
    title: z.string().trim().min(1).max(100),
    intro: z.string().trim().max(600),
    contactEmail: z.union([z.literal(''), z.string().email().max(254)]),
    listings: z.array(listingSchema).max(20_000),
  })
  .strict()
  .superRefine((draft, ctx) => {
    if (
      new Set(draft.listings.map((item) => item.domain)).size !==
      draft.listings.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Each domain must appear only once.',
        path: ['listings'],
      });
    }
  });
export type PortfolioListing = z.infer<typeof listingSchema>;
export const publishedSchema = draftSchema
  .innerType()
  .extend({
    listings: z
      .array(
        listingSchema.extend({
          visibility: z.enum(['showcase', 'inquiry', 'historical']),
        }),
      )
      .max(20_000),
    publishedAt: z.number().int().positive(),
  })
  .strict();
export type PortfolioDraft = z.infer<typeof draftSchema>;
export type PublicListing = Omit<PortfolioListing, 'visibility'> & {
  visibility: 'showcase' | 'inquiry' | 'historical';
};
export interface PublishedPortfolio {
  handle: string;
  title: string;
  intro: string;
  contactEmail: string;
  listings: PublicListing[];
  publishedAt: number;
}
export type OwnershipStatus = 'owned' | 'stale' | 'unmatched' | 'conflict';
export interface ReconciledListing extends PortfolioListing {
  ownership: OwnershipStatus;
  accountLabels: string[];
  lastSyncedAt: number | null;
}
export interface PublicationState {
  draft: PortfolioDraft;
  revision: string | null;
  published: {
    handle: string;
    publishedAt: number;
    count: number;
    revision: string;
  } | null;
  /** Already-public fields, returned only to the owner for an exact change review. */
  publishedSnapshot: PublishedPortfolio | null;
  review: ReconciledListing[];
  accounts: {
    label: string;
    count: number;
    healthy: boolean;
    lastSyncedAt: number | null;
  }[];
}
export const emptyDraft = (): PortfolioDraft => ({
  handle: 'portfolio',
  title: 'My domain collection',
  intro: '',
  contactEmail: '',
  listings: [],
});
export const privateListing = (domain: string): PortfolioListing => ({
  domain,
  collection: '',
  description: '',
  visibility: 'private',
  askingPrice: null,
  currency: 'USD',
});
