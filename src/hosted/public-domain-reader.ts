import { z } from 'zod';
import { canonicalDomain } from '../shared/publication';
import { readPublicSale } from '../shared/read-public-sale';
import { verifyGatewayRequest } from '../shared/gateway-proof';

/** A narrow anonymous projection reader admitted only by the main gateway key. */
export async function publicDomainEligibility(
  request: Request,
  env: Pick<Env, 'DB' | 'DOMBOT_GATEWAY_SECRET' | 'DOMBOT_WORKSPACE_ID'>,
) {
  const proof = await verifyGatewayRequest(
    env.DOMBOT_GATEWAY_SECRET ?? '',
    env.DOMBOT_WORKSPACE_ID ?? '',
    request,
  );
  const headers = { 'Cache-Control': 'no-store' };
  if (
    request.method !== 'GET' ||
    !proof ||
    proof.owner !== null ||
    proof.sales ||
    proof.mcp
  )
    return new Response('Forbidden', { status: 403, headers });
  if (new URL(request.url).pathname.endsWith('/public-domain-backfill')) {
    const url = new URL(request.url);
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .parse(url.searchParams.get('limit') ?? 100);
    const cursor = z
      .string()
      .max(253)
      .parse(url.searchParams.get('cursor') ?? '');
    const rows = await env.DB.prepare(
      "SELECT p.domain,p.id AS listing,p.revision FROM published_sales p JOIN sale_drafts d ON d.id=p.id WHERE p.domain>? AND d.availability='available' AND d.control_expires_at>? ORDER BY p.domain LIMIT ?",
    )
      .bind(cursor, Date.now(), limit + 1)
      .all<{ domain: string; listing: string; revision: string }>();
    const items = rows.results.slice(0, limit);
    return Response.json(
      {
        items,
        cursor: rows.results.length > limit ? items.at(-1)!.domain : null,
      },
      { headers },
    );
  }
  const domain = canonicalDomain(
    new URL(request.url).searchParams.get('domain') ?? '',
  );
  const sale = await readPublicSale(env.DB, domain);
  return Response.json(
    { revision: sale?.revision ?? null, listing: sale?.id ?? null },
    { headers },
  );
}
