import { z } from 'zod';
import { canonicalDomain } from '../shared/publication';
import { readPublicSale } from '../shared/read-public-sale';
import { verifyGatewayRequest } from '../shared/gateway-proof';

/** A narrow anonymous projection reader admitted only by the main gateway key. */
export async function publicDomainEligibility(
  request: Request,
  env: Pick<
    Env,
    | 'DB'
    | 'DOMBOT_GATEWAY_SECRET'
    | 'DOMBOT_WORKSPACE_ID'
    | 'SALES_INQUIRIES_ENABLED'
    | 'SALES_PRIVACY_REVIEWED'
    | 'SALES_TURNSTILE_SECRET'
    | 'SALES_TURNSTILE_SITEKEY'
    | 'SALES_MAIL_ENABLED'
  >,
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
      "SELECT p.domain,p.id AS listing,p.revision FROM published_sales p JOIN sale_drafts d ON d.id=p.id WHERE p.domain>? AND d.availability IN ('available','source-stale') AND d.control_expires_at>? ORDER BY p.domain LIMIT ?",
    )
      .bind(cursor, Date.now(), limit + 1)
      .all<{ domain: string; listing: string; revision: string }>();
    const candidates = rows.results.slice(0, limit),
      items: typeof candidates = [];
    for (const candidate of candidates) {
      const sale = await readPublicSale(env.DB, candidate.domain);
      if (
        sale?.id === candidate.listing &&
        sale.revision === candidate.revision
      )
        items.push(candidate);
    }
    return Response.json(
      {
        items,
        cursor: rows.results.length > limit ? candidates.at(-1)!.domain : null,
      },
      { headers },
    );
  }
  const url = new URL(request.url);
  if (url.pathname === '/platform-internal/agent-activity') {
    const ids = z
      .array(z.string().uuid())
      .max(100)
      .parse(url.searchParams.getAll('receipt'));
    if (!ids.length)
      return Response.json({ verified: [], linked: [] }, { headers });
    const rows = await env.DB.prepare(
      `
      SELECT l.id, EXISTS(
        SELECT 1 FROM sales_events e JOIN sales_journey_receipts r ON r.receipt=e.id
        WHERE e.lead_id=l.id AND e.listing_id=l.listing_id AND e.kind='outcome'
        AND r.event='sale-evidence-linked'
      ) AS linked
      FROM sales_leads l
      WHERE l.verification='verified' AND l.status!='spam'
      AND l.id IN (SELECT value FROM json_each(?))
    `,
    )
      .bind(JSON.stringify(ids))
      .all<{ id: string; linked: number }>();
    return Response.json(
      {
        verified: rows.results.map((row) => row.id),
        linked: rows.results
          .filter((row) => row.linked === 1)
          .map((row) => row.id),
      },
      { headers },
    );
  }
  const domain = canonicalDomain(url.searchParams.get('domain') ?? '');
  const sale = await readPublicSale(env.DB, domain);
  if (url.pathname === '/platform-internal/agent-listing') {
    const since = Date.now() - 30 * 86400_000;
    const sales =
      sale && url.searchParams.get('metrics') === '1'
        ? await env.DB.prepare(
            "SELECT coalesce(sum(count),0) AS total FROM sales_journey_daily WHERE listing_id=? AND day>=? AND event='sale-evidence-linked'",
          )
            .bind(sale.id, new Date(since).toISOString().slice(0, 10))
            .first<{ total: number }>()
        : null;
    return Response.json(
      {
        sale,
        intake:
          env.SALES_INQUIRIES_ENABLED === 'true' &&
          env.SALES_PRIVACY_REVIEWED === 'true' &&
          env.SALES_MAIL_ENABLED === 'true' &&
          !!env.SALES_TURNSTILE_SITEKEY &&
          !!env.SALES_TURNSTILE_SECRET,
        sales: sales?.total ?? 0,
      },
      { headers },
    );
  }
  return Response.json(
    { revision: sale?.revision ?? null, listing: sale?.id ?? null },
    { headers },
  );
}
