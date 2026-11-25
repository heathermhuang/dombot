import {
  agentConnectPage,
  agentConnectPath,
  agentCopyScript,
  agentCopyScriptPath,
  agentOpenApiPath,
} from './agent-connect';
import { agentOpenApi } from './agent-openapi';
import { boundedText } from '../agent-readiness/scan';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  buyerDetailsSchema,
  captureInquiryRequest,
} from '../shared/inquiry-identity';
import { saleDomainSchema, saleMoneySchema } from '../shared/hosted-sales';
import { publicDomainRequest } from './public-domain-routes';
import {
  agentAdmission,
  AgentCursorError,
  agentCatalogEnabled,
  agentSource,
  readAgentListing,
  recordAgentEvent,
  searchAgentListings,
} from './agent-catalog';
import {
  agentSearchSchema,
  catalogHeaders,
  type AgentSearch,
} from './agent-projection';

const readHeaders = { ...catalogHeaders, 'Access-Control-Allow-Origin': '*' };
const error = (status: number, message: string) =>
  Response.json({ error: message }, { status, headers: catalogHeaders });

const offerBase = {
  observedRevision: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254),
  buyerDetails: buyerDetailsSchema.optional(),
  turnstileToken: z.string().min(1).max(2048),
};
const submission = z.discriminatedUnion('intent', [
  z
    .object({
      ...offerBase,
      intent: z.literal('offer'),
      offer: saleMoneySchema,
      message: z.string().trim().max(3800).default(''),
    })
    .strict(),
  z
    .object({
      ...offerBase,
      intent: z.literal('broker'),
      budget: saleMoneySchema,
      message: z.string().trim().min(10).max(3800),
    })
    .strict(),
]);

function track(
  context: {
    readonly executionCtx: { waitUntil(promise: Promise<unknown>): void };
  },
  promise: Promise<unknown>,
) {
  const done = promise.catch(() => {
    console.warn('Agent catalog activity could not be recorded');
  });
  try {
    context.executionCtx.waitUntil(done);
  } catch {
    return done;
  }
}

async function search(
  env: HostedEnv,
  filter: AgentSearch,
  source: string,
  context: {
    readonly executionCtx: { waitUntil(promise: Promise<unknown>): void };
  },
) {
  const result = await searchAgentListings(env, filter);
  await track(
    context,
    recordAgentEvent(env, result.matches, 'query', source, filter.q),
  );
  return {
    listings: result.matches.map((match) => match.listing),
    nextCursor: result.nextCursor,
    partial: result.partial,
  };
}

export const agentRoutes = new Hono<{ Bindings: HostedEnv }>();
for (const path of [
  '/api/agent',
  '/api/agent/*',
  '/mcp/catalog',
  agentConnectPath,
  agentCopyScriptPath,
]) {
  agentRoutes.use(path, async (c, next) => {
    if (!agentCatalogEnabled(c.env)) return error(404, 'Catalog unavailable.');
    if (new URL(c.req.url).origin !== c.env.CANONICAL_ORIGIN)
      return error(421, 'Use the canonical service origin.');
    if (
      !(await agentAdmission(
        c.env,
        c.req.raw,
        c.req.path.endsWith('/inquiries') ? 'submit' : 'read',
      ))
    )
      return error(429, 'Rate limit reached. Try again later.');
    await next();
  });
}
agentRoutes.onError((problem) =>
  problem instanceof AgentCursorError
    ? error(400, 'Start the search again with the current filters.')
    : error(503, 'The catalog is temporarily unavailable.'),
);

agentRoutes.get(agentConnectPath, (c) =>
  c.html(agentConnectPage(c.env.CANONICAL_ORIGIN!), 200, {
    'Cache-Control': 'no-store, no-transform',
  }),
);
agentRoutes.get(agentCopyScriptPath, (c) =>
  c.body(agentCopyScript, 200, {
    'Content-Type': 'text/javascript; charset=utf-8',
  }),
);
agentRoutes.get(agentOpenApiPath, (c) =>
  c.json(agentOpenApi(c.env.CANONICAL_ORIGIN!), 200, readHeaders),
);

agentRoutes.get('/api/agent', (c) =>
  c.json(
    {
      search: {
        method: 'GET',
        path: '/api/agent/listings',
        parameters: {
          q: 'Business type or keywords. Optional.',
          currency: 'ISO currency. Required for price filters.',
          minPrice: 'Minimum asking amount as a decimal string.',
          maxPrice: 'Maximum asking amount as a decimal string.',
          cursor:
            'Pass nextCursor from the preceding search with the same filters.',
          limit: 'Between 1 and 20. Default 10.',
        },
      },
      listing: { method: 'GET', path: '/api/agent/listings/{domain}' },
      mcp: { transport: 'streamable-http', path: '/mcp/catalog' },
      connect: agentConnectPath,
      openapi: agentOpenApiPath,
      inquiry: {
        method: 'POST',
        path: '/api/agent/listings/{domain}/inquiries',
        contentType: 'application/json',
        commonFields: {
          observedRevision: 'Current listing revision UUID',
          idempotencyKey: 'UUID for retrying the same submission',
          name: 'Buyer name',
          email: 'Buyer email for confirmation',
          buyerDetails:
            'Optional company, companyWebsite, profileUrl, inquiryRole',
          turnstileToken:
            'Token from a buyer-completed security check on the listing',
        },
        variants: {
          offer: {
            intent: 'offer',
            offer: '{ amount, currency }',
            message: 'Optional',
          },
          broker: {
            intent: 'broker',
            budget: '{ amount, currency }',
            message: 'Qualified buyer brief',
          },
        },
        handoff:
          'Use the published browserUrl for human-assisted submission. A submission starts email verification and seller review.',
      },
      activity:
        'Listing recipients can see bounded search terms, timestamps and client-reported product names for the last 30 days.',
      freshness:
        'lastVerified records the seller-approved publication time. Prices are withheld after 30 days or earlier source expiry.',
    },
    200,
    readHeaders,
  ),
);

agentRoutes.get('/api/agent/listings', async (c) => {
  const parsed = agentSearchSchema.safeParse(c.req.query());
  if (!parsed.success) return error(400, parsed.error.issues[0].message);
  return c.json(
    await search(c.env, parsed.data, agentSource(c.req.raw, 'API'), c),
    200,
    readHeaders,
  );
});
agentRoutes.get('/api/agent/listings/:domain', async (c) => {
  const domain = saleDomainSchema.safeParse(c.req.param('domain'));
  if (!domain.success) return error(404, 'Listing unavailable.');
  const live = await readAgentListing(c.env, domain.data);
  if (!live) return error(404, 'Listing unavailable.');
  if (c.req.method === 'GET')
    await track(
      c,
      recordAgentEvent(c.env, [live], 'price', agentSource(c.req.raw, 'API')),
    );
  return c.json(live.listing, 200, readHeaders);
});
agentRoutes.get('/api/agent/listings/:domain/provider', async (c) => {
  const domain = saleDomainSchema.safeParse(c.req.param('domain'));
  if (!domain.success) return error(404, 'Listing unavailable.');
  const live = await readAgentListing(c.env, domain.data);
  if (live?.listing.route?.type !== 'provider-handoff')
    return error(404, 'Provider handoff unavailable.');
  if (c.req.method === 'GET')
    await track(
      c,
      recordAgentEvent(
        c.env,
        [live],
        'provider',
        agentSource(c.req.raw, 'API'),
      ),
    );
  return new Response(null, {
    status: 303,
    headers: {
      ...catalogHeaders,
      Location: live.listing.urls.listing,
    },
  });
});

agentRoutes.post(
  '/api/agent/listings/:domain/inquiries',
  bodyLimit({ maxSize: 16384 }),
  async (c) => {
    const request = c.req.raw;
    const origin = new URL(request.url).origin;
    if (request.headers.get('Origin') !== origin)
      return error(403, 'Use the published browser handoff.');
    if (
      !/^application\/json(?:;|$)/i.test(
        request.headers.get('Content-Type') ?? '',
      )
    )
      return error(415, 'Send application/json.');
    const domain = saleDomainSchema.safeParse(c.req.param('domain'));
    if (!domain.success) return error(404, 'Listing unavailable.');
    const parsed = submission.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return error(400, 'Check the buyer details, terms and security token.');
    const input = parsed.data;
    const live = await readAgentListing(c.env, domain.data);
    const route = live?.listing.route;
    if (
      !live ||
      route?.type !== (input.intent === 'offer' ? 'offer' : 'broker-brief')
    )
      return error(404, 'This submission route is unavailable.');
    if (live.listing.revision !== input.observedRevision)
      return error(409, 'Read and review the latest terms before submitting.');
    const {
      observedRevision,
      idempotencyKey,
      name,
      email,
      buyerDetails,
      turnstileToken,
    } = input;
    const headers = new Headers(request.headers);
    for (const name of ['Content-Length', 'Cookie', 'Authorization'])
      headers.delete(name);
    const forwarded = new Request(
      new URL('/' + domain.data + '/inquiries', origin),
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          observedRevision,
          idempotencyKey,
          name,
          email,
          buyerDetails,
          turnstileToken,
          website: '',
          offer: input.intent === 'offer' ? input.offer : null,
          message:
            input.intent === 'broker'
              ? `Buyer budget: ${input.budget.amount} ${input.budget.currency}\n\n${input.message}`
              : input.message,
        }),
      },
    );
    const response = await publicDomainRequest(
      forwarded,
      c.env,
      captureInquiryRequest(request),
    );
    if (!response) return error(503, 'Inquiry intake unavailable.');
    if (response.status === 409) {
      await response.body?.cancel();
      return error(409, 'Read and review the latest terms before submitting.');
    }
    if (response.status === 202) {
      const receipt = z.object({ id: z.string().uuid() }).safeParse(
        await response
          .clone()
          .json()
          .catch(() => null),
      );
      if (receipt.success)
        await track(
          c,
          recordAgentEvent(
            c.env,
            [live],
            input.intent,
            agentSource(request, 'API'),
            '',
            receipt.data.id,
          ),
        );
    }
    return response;
  },
);

agentRoutes.post('/mcp/catalog', bodyLimit({ maxSize: 16384 }), async (c) => {
  if (
    c.req.header('Origin') &&
    c.req.header('Origin') !== new URL(c.req.url).origin
  )
    return error(403, 'Origin is unavailable.');
  const payload: unknown = await c.req.json().catch(() => null);
  if (!payload || Array.isArray(payload) || typeof payload !== 'object')
    return Response.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Invalid Request' },
      },
      { status: 400, headers: catalogHeaders },
    );
  const source = agentSource(c.req.raw, 'MCP');
  const server = new McpServer(
    {
      name: 'domains-domains-public-catalog',
      version: '1.0.0',
    },
    {
      instructions:
        'Search seller-approved domain listings and read fresh asking prices. Send a human to the published route to proceed.',
    },
  );
  const readOnly = {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
  };
  const result = (data: object) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(data) }],
  });
  server.registerTool(
    'domain_search',
    {
      description:
        'Find currently eligible published domains by business type, keywords or currency and asking price.',
      inputSchema: {
        query: z.string().max(120).optional(),
        currency: z.string().optional(),
        minPrice: z.string().optional(),
        maxPrice: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.number().int().optional(),
      },
      annotations: readOnly,
    },
    async ({ query, ...fields }) => {
      const parsed = agentSearchSchema.safeParse({ ...fields, q: query });
      if (!parsed.success)
        return {
          ...result({ error: parsed.error.issues[0].message }),
          isError: true,
        };
      return result(await search(c.env, parsed.data, source, c));
    },
  );
  server.registerTool(
    'domain_price',
    {
      description:
        'Check a published domain’s latest asking price, terms, confirmation time and buyer handoff route.',
      inputSchema: { domain: saleDomainSchema },
      annotations: readOnly,
    },
    async ({ domain }) => {
      const live = await readAgentListing(c.env, domain);
      if (!live)
        return { ...result({ error: 'Listing unavailable.' }), isError: true };
      await track(c, recordAgentEvent(c.env, [live], 'price', source));
      return result(live.listing);
    },
  );
  const transport = new WebStandardStreamableHTTPServerTransport({
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(c.req.raw, {
      parsedBody: payload,
    });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } finally {
    await server.close();
  }
});
agentRoutes.get(
  '/mcp/catalog',
  () =>
    new Response(null, {
      status: 405,
      headers: { ...catalogHeaders, Allow: 'POST' },
    }),
);
agentRoutes.delete(
  '/mcp/catalog',
  () =>
    new Response(null, {
      status: 405,
      headers: { ...catalogHeaders, Allow: 'POST' },
    }),
);

export async function agentDiscovery(
  request: Request,
  env: HostedEnv,
  domain: string,
) {
  const parsed = saleDomainSchema.safeParse(domain);
  if (
    !agentCatalogEnabled(env) ||
    !parsed.success ||
    new URL(request.url).origin !== env.CANONICAL_ORIGIN
  )
    return error(404, 'Listing unavailable.');
  if (!(await agentAdmission(env, request, 'read')))
    return error(429, 'Rate limit reached.');
  const live = await readAgentListing(env, parsed.data);
  if (!live) return error(404, 'Listing unavailable.');
  const { listing } = live;
  return new Response(
    request.method === 'HEAD'
      ? null
      : [
          '# ' + listing.domain,
          '',
          '> Public domain listing with seller-approved terms.',
          '',
          '## Listing',
          '- [Current listing JSON](' + listing.urls.detail + ')',
          '- [Domain inquiry page](' + listing.urls.listing + ')',
          '- [Public catalog API](' +
            new URL('/api/agent', env.CANONICAL_ORIGIN).href +
            ')',
          '- [Public MCP catalog](' + listing.urls.mcp + ')',
          '',
          'Price last reviewed: ' + listing.lastVerified,
          '',
        ].join('\n'),
    {
      headers: { ...readHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
    },
  );
}

/** Link the human-assisted offer to the Sales receipt without storing form values. */
export async function trackBrowserOffer(
  env: HostedEnv,
  request: Request,
  response: Response,
) {
  const url = new URL(request.url);
  const domain = saleDomainSchema.safeParse(url.pathname.split('/')[1]);
  if (!domain.success || response.status !== 202) return;
  const [form, body] = await Promise.all([
    request.formData(),
    boundedText(response, 65536),
  ]);
  const revision = form.get('observedRevision');
  if (form.get('intent') !== 'offer' || typeof revision !== 'string') return;
  const receipt = body.match(
    /<p class="receipt">Inquiry reference: ([a-f0-9-]{36})<\/p>/i,
  )?.[1];
  const id = z.string().uuid().safeParse(receipt);
  if (!id.success) return;
  const live = await readAgentListing(env, domain.data);
  if (
    !live ||
    live.listing.revision !== revision ||
    live.listing.terms !== 'make-offer'
  )
    return;
  await recordAgentEvent(env, [live], 'offer', 'Browser handoff', '', id.data);
}
