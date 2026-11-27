import { z } from 'zod';
import { saleDomainSchema, saleMoneySchema } from '../shared/hosted-sales';

const text = z.string();
const url = z.url();
const buyerApproval = z.literal(true);
const route = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('provider-handoff'),
    method: z.literal('GET'),
    url,
    provider: text,
    humanApprovalRequired: buyerApproval,
  }),
  z.object({
    type: z.enum(['offer', 'broker-brief']),
    method: z.literal('POST'),
    url,
    browserUrl: url,
    humanApprovalRequired: buyerApproval,
    buyerVerificationRequired: z.literal(true),
  }),
]);

export const agentListingSchema = z.object({
  domain: saleDomainSchema,
  description: text,
  categories: z.array(text),
  forSale: z.literal(true),
  availability: z.literal('published'),
  askingPrice: saleMoneySchema.nullable(),
  minimumOffer: saleMoneySchema.nullable(),
  offerCurrency: text.nullable(),
  priceStatus: z.enum(['confirmed', 'request-price', 'needs-reconfirmation']),
  lastVerified: z.iso.datetime(),
  priceValidUntil: z.iso.datetime().nullable(),
  revision: z.uuid(),
  terms: z.enum(['buy-now', 'make-offer', 'broker-contact']),
  route: route.nullable(),
  urls: z.object({ listing: url, detail: url, discovery: url, mcp: url }),
  dnsRecord: z.object({ name: text, type: z.literal('TXT'), value: text }),
});

const string = { type: 'string' };
const priceBound = {
  ...string,
  pattern: '^(?:0|[1-9][0-9]{0,11})(?:\\.[0-9]{1,4})?$',
};
const listing = { $ref: '#/components/schemas/Listing' };
const response = (description: string, schema: object) => ({
  description,
  content: { 'application/json': { schema } },
});
const errors = {
  421: { description: 'Use the canonical service origin.' },
  429: { description: 'Rate limit reached.' },
  503: { description: 'Catalog temporarily unavailable.' },
};

export function agentOpenApi(origin: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Domains.Domains public catalog',
      version: '1.0.0',
      description:
        'Search published domains and retrieve seller-approved terms. Use urls.listing or route.browserUrl for buyer handoff.',
    },
    servers: [{ url: origin }],
    security: [],
    paths: {
      '/api/agent/listings': {
        get: {
          operationId: 'domain_search',
          summary: 'Search published domain listings',
          parameters: [
            {
              name: 'q',
              schema: { ...string, maxLength: 120 },
              description: 'Business type or keywords.',
            },
            {
              name: 'currency',
              schema: string,
              description:
                'Supported currency code. Required with either price filter.',
            },
            {
              name: 'minPrice',
              schema: priceBound,
              description: 'Minimum asking amount.',
            },
            {
              name: 'maxPrice',
              schema: priceBound,
              description: 'Maximum asking amount.',
            },
            {
              name: 'cursor',
              schema: { ...string, maxLength: 700 },
              description: 'Pass nextCursor with the same filters.',
            },
            {
              name: 'limit',
              schema: { type: 'integer', minimum: 1, maximum: 20, default: 10 },
            },
          ].map((parameter) => ({ in: 'query', ...parameter })),
          responses: {
            200: response('Published listings matching the search.', {
              type: 'object',
              required: ['listings', 'nextCursor', 'partial'],
              properties: {
                listings: { type: 'array', items: listing },
                nextCursor: { type: ['string', 'null'] },
                partial: {
                  type: 'boolean',
                  description: 'Some listings could not be checked.',
                },
              },
            }),
            400: { description: 'Invalid filters or cursor.' },
            404: { description: 'Catalog unavailable.' },
            ...errors,
          },
        },
      },
      '/api/agent/listings/{domain}': {
        get: {
          operationId: 'domain_price',
          summary: 'Read the published terms for one domain',
          parameters: [
            { name: 'domain', in: 'path', required: true, schema: string },
          ],
          responses: {
            200: response(
              'Current published terms and buyer handoff.',
              listing,
            ),
            404: { description: 'Listing or catalog unavailable.' },
            ...errors,
          },
        },
      },
    },
    components: {
      schemas: { Listing: z.toJSONSchema(agentListingSchema, { io: 'input' }) },
    },
  };
}
