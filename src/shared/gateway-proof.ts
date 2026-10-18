import { SignJWT, jwtVerify, decodeJwt } from 'jose';
import { salesAdmissionSchema, type SalesAdmission } from './sales-admission';

export const PROOF_HEADER = 'x-dombot-gateway-proof';
const encoder = new TextEncoder();
async function fingerprint(request: Request): Promise<string> {
  const url = new URL(request.url);
  const bytes =
    request.method === 'GET' || request.method === 'HEAD'
      ? new Uint8Array()
      : new Uint8Array(await request.clone().arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return `${request.method} ${url.pathname}${url.search} ${Array.from(digest, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}

export async function signGatewayRequest(
  secret: string,
  workspace: string,
  owner: string | null,
  request: Request,
  sales?: SalesAdmission,
): Promise<string> {
  if (secret.length < 32) throw new Error('Gateway key is not configured');
  return new SignJWT({
    owner,
    request: await fingerprint(request),
    ...(sales ? { version: 2, sales: salesAdmissionSchema.parse(sales) } : {}),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('domains-gateway')
    .setAudience(workspace)
    .setIssuedAt()
    .setExpirationTime('30s')
    .sign(encoder.encode(secret));
}

export async function verifyGatewayRequest(
  secret: string,
  workspace: string,
  request: Request,
  rejected?: (reason: string) => void,
): Promise<{ owner: string | null; sales?: SalesAdmission } | null> {
  if (!secret || secret.length < 32 || !workspace) return null;
  const token = request.headers.get(PROOF_HEADER);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, encoder.encode(secret), {
      algorithms: ['HS256'],
      issuer: 'domains-gateway',
      audience: workspace,
      maxTokenAge: '35s',
      // Gateway and coordinator run on separate Cloudflare hosts. A small
      // clock offset must not reject a correctly signed request as future-issued.
      // exp still bounds its lifetime to 30 + 5 seconds.
      clockTolerance: 5,
    });
    if (payload.request !== (await fingerprint(request))) return null;
    if (payload.owner !== null && typeof payload.owner !== 'string')
      return null;
    if (payload.version === 2) {
      const sales = salesAdmissionSchema.safeParse(payload.sales);
      if (!sales.success) return null;
      return { owner: payload.owner as string | null, sales: sales.data };
    }
    if (payload.sales !== undefined || payload.version !== undefined)
      return null;
    return { owner: payload.owner as string | null };
  } catch (error) {
    let reason = 'invalid';
    if (error && typeof error === 'object' && 'code' in error) {
      if (error.code === 'ERR_JWT_EXPIRED') reason = 'expired';
      if (error.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED')
        reason = 'signature';
      if (error.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
        reason = 'claims';
        try {
          const issuedAt = decodeJwt(token).iat;
          if (
            typeof issuedAt === 'number' &&
            issuedAt > Math.floor(Date.now() / 1000)
          )
            reason = 'issued_in_future';
        } catch {
          /* No untrusted claims or tokens enter diagnostics. */
        }
      }
    }
    rejected?.(reason);
    return null;
  }
}

/** A public edge key can admit only anonymous sales requests, never owners. */
export async function verifyTenantAdmission(
  env: {
    DOMBOT_GATEWAY_SECRET?: string;
    DOMBOT_SALES_EDGE_SECRET?: string;
    DOMBOT_WORKSPACE_ID?: string;
  },
  request: Request,
  rejected?: (reason: string) => void,
) {
  const main = await verifyGatewayRequest(
    env.DOMBOT_GATEWAY_SECRET ?? '',
    env.DOMBOT_WORKSPACE_ID ?? '',
    request,
    rejected,
  );
  if (main) return main;
  const edge = await verifyGatewayRequest(
    env.DOMBOT_SALES_EDGE_SECRET ?? '',
    env.DOMBOT_WORKSPACE_ID ?? '',
    request,
  );
  return edge?.owner === null && edge.sales?.purpose === 'sales-public'
    ? edge
    : null;
}
