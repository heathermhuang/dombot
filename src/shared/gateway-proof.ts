import { SignJWT, jwtVerify } from 'jose';

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
): Promise<string> {
  if (secret.length < 32) throw new Error('Gateway key is not configured');
  return new SignJWT({ owner, request: await fingerprint(request) })
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
): Promise<{ owner: string | null } | null> {
  if (!secret || secret.length < 32 || !workspace) return null;
  const token = request.headers.get(PROOF_HEADER);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, encoder.encode(secret), {
      algorithms: ['HS256'],
      issuer: 'domains-gateway',
      audience: workspace,
      maxTokenAge: '35s',
    });
    if (payload.request !== (await fingerprint(request))) return null;
    if (payload.owner !== null && typeof payload.owner !== 'string')
      return null;
    return { owner: payload.owner as string | null };
  } catch {
    return null;
  }
}
