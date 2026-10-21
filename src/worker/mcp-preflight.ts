import { z } from 'zod';
import { hashToken } from '../core/mcp/oauth';
import { EncryptedDocStore, aesGcmCipher } from '../core/storage/encrypted';
import { deriveEncryptionKey, parseRootSecret } from './keys';
import { D1DocStore } from './storage/d1-doc-store';
import { delegatedMcpAuth } from '../shared/gateway-proof';

/** Reject unpaired callers before the coordinator's stateful request queue.
 * Read at most the enable flag and one hashed token row, never the portfolio
 * or registrar credentials. The core rechecks both under its lock, so a
 * concurrent disable/revoke cannot be bypassed by a successful preflight. */
export async function mcpPreflight(
  request: Request,
  env: Env,
): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/mcp') return null;
  const resource =
    new URL(request.url).origin + env.DOMBOT_PUBLIC_BASE_PATH + '/mcp';
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'WWW-Authenticate',
    'Cache-Control': 'no-store',
  };
  if (request.method === 'OPTIONS')
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers':
          'Authorization, Content-Type, Mcp-Protocol-Version',
      },
    });
  const fail = () =>
    Response.json(
      { error: 'invalid_token' },
      {
        status: 401,
        headers: {
          ...cors,
          'WWW-Authenticate': `Bearer error="invalid_token", resource_metadata="${resource.replace(/\/mcp$/, '')}/.well-known/oauth-protected-resource/mcp"`,
        },
      },
    );
  const match = /^Bearer ([a-f0-9]{64})$/i.exec(
    request.headers.get('authorization') ?? '',
  );
  const delegated = await delegatedMcpAuth(request, env);
  if (!match && !delegated) return fail();
  const store = new EncryptedDocStore(
    new D1DocStore(env.DB),
    await aesGcmCipher(
      await deriveEncryptionKey(parseRootSecret(env.DOMBOT_SECRET)),
    ),
  );
  if ((await store.get('settings', 'mcpEnabled')) !== true)
    return Response.json(
      { error: 'MCP server is disabled' },
      { status: 404, headers: cors },
    );
  if (delegated) return null;
  const token = z
    .object({ expiresAt: z.number(), resource: z.string() })
    .safeParse(await store.get('mcp', 'token:' + (await hashToken(match![1]))));
  if (
    !token.success ||
    token.data.expiresAt < Math.floor(Date.now() / 1000) ||
    token.data.resource !== resource
  )
    return fail();
  return null;
}
