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
  const domain = canonicalDomain(
    new URL(request.url).searchParams.get('domain') ?? '',
  );
  const sale = await readPublicSale(env.DB, domain);
  return Response.json({ revision: sale?.revision ?? null }, { headers });
}
