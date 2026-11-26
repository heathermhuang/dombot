import { base64url } from 'jose';
import { verifyGatewayRequest } from '../shared/gateway-proof';
import {
  checkoutCaseSchema,
  checkoutLookupSchema,
  checkoutReviewSchema,
} from './checkout-case-schema';
import { readPublicSale } from '../shared/read-public-sale';

async function activeBuyerCase(db: D1Database, thread: string) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(thread),
  );
  return db
    .prepare(
      "SELECT l.id FROM sales_tokens t JOIN sales_leads l ON l.id=t.lead_id WHERE t.token_hash=? AND t.purpose='thread' AND t.revoked_at IS NULL AND t.expires_at>? AND l.verification='verified' AND l.status!='spam'",
    )
    .bind(base64url.encode(new Uint8Array(hash)), Date.now())
    .first<string>('id');
}

async function currentCaseQuote(db: D1Database, caseId: string) {
  const row = await db
    .prepare(
      "SELECT p.domain,p.id FROM sales_leads l JOIN published_sales p ON p.id=l.listing_id WHERE l.id=? AND l.verification='verified' AND l.status!='spam'",
    )
    .bind(caseId)
    .first<{ id: string; domain: string }>();
  if (!row) return null;
  const sale = await readPublicSale(db, row.domain);
  if (
    sale?.id !== row.id ||
    !sale.publicPrice ||
    sale.mode !== 'offer' ||
    sale.destination ||
    Date.now() - sale.publishedAt > 30 * 86400_000
  )
    return null;
  return {
    caseId,
    domain: sale.domain,
    listing: sale.id,
    revision: sale.revision,
    price: sale.publicPrice,
  };
}

export async function readCheckoutCase(request: Request, env: Env) {
  const headers = { 'Cache-Control': 'no-store' };
  const proof = await verifyGatewayRequest(
    env.DOMBOT_GATEWAY_SECRET ?? '',
    env.DOMBOT_WORKSPACE_ID ?? '',
    request,
  );
  const denied = () => new Response(null, { status: 404, headers });
  if (
    request.method !== 'POST' ||
    !proof ||
    proof.owner !== null ||
    proof.sales ||
    proof.mcp
  )
    return denied();
  const body = await request.json().catch(() => null);
  const lookup = checkoutLookupSchema.safeParse(body);
  if (lookup.success) {
    const caseId = await activeBuyerCase(env.DB, lookup.data.thread);
    return caseId ? Response.json({ caseId }, { headers }) : denied();
  }
  const review = checkoutReviewSchema.safeParse(body);
  if (review.success) {
    const quote = await currentCaseQuote(env.DB, review.data.caseId);
    return quote ? Response.json(quote, { headers }) : denied();
  }
  const input = checkoutCaseSchema.safeParse(body);
  if (!input.success) return denied();
  const { caseId, domain, listing, revision, price, thread } = input.data;
  const quote = await currentCaseQuote(env.DB, caseId);
  if (
    !quote ||
    quote.domain !== domain ||
    quote.listing !== listing ||
    quote.revision !== revision ||
    quote.price.amount !== price.amount ||
    quote.price.currency !== price.currency ||
    (thread && (await activeBuyerCase(env.DB, thread)) !== caseId)
  )
    return denied();
  return new Response(null, { status: 204, headers });
}
