import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { Accounts, type SessionUser } from './accounts';
import { opaqueToken, tokenHash } from './crypto';
import { Passkeys } from './passkeys';
import { escapeHtml as e, page } from './views';
import { workspaceFor, workspaceKey, workspaceService } from './workspaces';
import { mcpPolicyDenial } from './mcp-policy';
import {
  MCP_DELEGATION_TOKEN,
  PROOF_HEADER,
  signGatewayRequest,
} from '../shared/gateway-proof';

const scope = 'portfolio:read';
const accessLifetime = 30 * 86400_000;
const registration = z.object({
  client_name: z.string().trim().min(1).max(160).default('MCP client'),
  redirect_uris: z
    .array(
      z
        .string()
        .url()
        .max(2048)
        .refine((value) => {
          const url = new URL(value);
          return (
            !url.hash &&
            !url.username &&
            !url.password &&
            (url.protocol === 'https:' ||
              (url.protocol === 'http:' &&
                ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
          );
        }),
    )
    .min(1)
    .max(10),
  token_endpoint_auth_method: z
    .enum(['none', 'client_secret_post'])
    .default('none'),
  grant_types: z
    .array(z.literal('authorization_code'))
    .default(['authorization_code']),
  response_types: z.array(z.literal('code')).default(['code']),
});
type Metadata = z.infer<typeof registration>;
type Client = { id: string; metadata: string; secret_hash: string | null };
type Authorization = {
  id: string;
  client_id: string;
  redirect_uri: string;
  resource: string;
  state: string | null;
  challenge: string;
  expires_at: number;
  user_id: string | null;
  session_hash: string | null;
  csrf_hash: string | null;
  code_hash: string | null;
  code_expires_at: number | null;
  consumed_at: number | null;
};
type Grant = {
  id: string;
  client_id: string;
  workspace_id: string;
  expires_at: number;
};
export const sharedMcpNext = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\/oauth\/consent\?id=[a-f0-9]{64}$/.test(value);
const origin = (c: Context) => new URL(c.req.url).origin;
const resource = (c: Context) => origin(c) + '/mcp';
const session = (request: Request) =>
  request.headers
    .get('cookie')
    ?.split(';')
    .map((s) => s.trim())
    .find((s) =>
      s.startsWith(
        new URL(request.url).protocol === 'https:'
          ? '__Host-dd_session='
          : 'dd_session=',
      ),
    )
    ?.split('=')[1];
const fail = (
  c: Context,
  error: string,
  description: string,
  status: 400 | 401 | 403 | 404 | 429 = 400,
) => c.json({ error, error_description: description }, status);
const csrfOrigin = (c: Context) => c.req.header('origin') === origin(c);
async function form(c: Context): Promise<Record<string, string>> {
  const input: unknown = (c.req.header('content-type') ?? '').includes(
    'application/json',
  )
    ? await c.req.json().catch(() => null)
    : await c.req.parseBody().catch(() => null);
  const parsed = z.record(z.string().max(4096)).safeParse(input);
  return parsed.success ? parsed.data : {};
}
function redirectMatches(requested: string, registered: string) {
  if (requested === registered) return true;
  const req = new URL(requested),
    reg = new URL(registered);
  return (
    req.protocol === 'http:' &&
    reg.protocol === 'http:' &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(req.hostname) &&
    req.hostname === reg.hostname &&
    req.pathname === reg.pathname &&
    req.search === reg.search &&
    !req.hash &&
    !req.username &&
    !req.password
  );
}
async function pkce(verifier: string, challenge: string) {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
  );
  return (
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '') === challenge
  );
}
async function clientFor(env: HostedEnv, id: string) {
  return env.CONTROL_DB.prepare(
    'SELECT id,metadata,secret_hash FROM mcp_clients WHERE id=?',
  )
    .bind(id)
    .first<Client>();
}
async function authenticate(env: HostedEnv, body: Record<string, string>) {
  const client = await clientFor(env, body.client_id ?? '');
  if (
    !client ||
    (client.secret_hash &&
      (!body.client_secret ||
        (await tokenHash(body.client_secret)) !== client.secret_hash))
  )
    return null;
  return client;
}
async function tenantFetch(
  env: HostedEnv,
  user: SessionUser,
  request: Request,
) {
  const configured = await workspaceFor(env, user.workspace_id);
  if (!configured)
    return new Response('Portfolio unavailable', { status: 404 });
  request.headers.set(
    PROOF_HEADER,
    await signGatewayRequest(
      await workspaceKey(env, user.workspace_id),
      user.workspace_id,
      user.id,
      request,
    ),
  );
  return workspaceService(env, configured.binding).fetch(request);
}
async function mcpEnabled(env: HostedEnv, user: SessionUser, base: string) {
  const result = await tenantFetch(
    env,
    user,
    new Request(base + '/api/getSettings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ args: [] }),
    }),
  );
  if (!result.ok) return false;
  const json = (await result.json()) as { result?: { mcpEnabled?: boolean } };
  return json.result?.mcpEnabled === true;
}
export async function sharedMcpClients(env: HostedEnv, user: SessionUser) {
  const rows = await env.CONTROL_DB.prepare(
    'SELECT g.id,g.created_at,c.metadata FROM mcp_grants g JOIN mcp_clients c ON c.id=g.client_id WHERE g.user_id=? AND g.workspace_id=? AND g.revoked_at IS NULL AND g.expires_at>? ORDER BY g.created_at',
  )
    .bind(user.id, user.workspace_id, Date.now())
    .all<{ id: string; created_at: number; metadata: string }>();
  return rows.results.map((row) => ({
    clientId: 'shared:' + row.id,
    clientName: (JSON.parse(row.metadata) as Metadata).client_name,
    pairedAt: row.created_at,
  }));
}
export async function revokeSharedMcpClient(
  env: HostedEnv,
  user: SessionUser,
  id: string,
) {
  await env.CONTROL_DB.prepare(
    'UPDATE mcp_grants SET revoked_at=? WHERE id=? AND user_id=? AND workspace_id=? AND revoked_at IS NULL',
  )
    .bind(Date.now(), id.slice(7), user.id, user.workspace_id)
    .run();
}
export function sharedMcpRoutes() {
  const app = new Hono<{ Bindings: HostedEnv }>();
  const publicPaths = [
    '/mcp',
    '/register',
    '/token',
    '/revoke',
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-authorization-server/mcp',
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
  ];
  for (const path of publicPaths)
    app.use(
      path,
      cors({
        origin: '*',
        exposeHeaders: ['WWW-Authenticate'],
        allowHeaders: ['Authorization', 'Content-Type', 'Mcp-Protocol-Version'],
        allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      }),
    );
  app.use('*', bodyLimit({ maxSize: 16384 }));
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (
      !(await new Accounts(c.env.CONTROL_DB, c.env.AUTH_PEPPER).rateLimit(
        `shared-oauth:${c.req.path}:${c.req.header('cf-connecting-ip') ?? 'local'}`,
        c.req.path === '/mcp' ? 600 : 60,
      ))
    )
      return fail(c, 'slow_down', 'Too many requests. Try again later.', 429);
    await next();
  });
  for (const path of [
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-authorization-server/mcp',
  ])
    app.get(path, (c) =>
      c.json({
        issuer: origin(c),
        authorization_endpoint: origin(c) + '/authorize',
        token_endpoint: origin(c) + '/token',
        registration_endpoint: origin(c) + '/register',
        revocation_endpoint: origin(c) + '/revoke',
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code'],
        token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
        revocation_endpoint_auth_methods_supported: [
          'none',
          'client_secret_post',
        ],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: [scope],
        authorization_response_iss_parameter_supported: true,
      }),
    );
  for (const path of [
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
  ])
    app.get(path, (c) =>
      c.json({
        resource: resource(c),
        authorization_servers: [origin(c)],
        scopes_supported: [scope],
        resource_name: 'domains.domains',
      }),
    );
  app.post('/register', async (c) => {
    const parsed = registration.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success)
      return fail(
        c,
        'invalid_client_metadata',
        'Use HTTPS or a local HTTP callback and authorization_code with PKCE.',
      );
    const now = Date.now();
    await c.env.CONTROL_DB.batch([
      c.env.CONTROL_DB.prepare(
        'DELETE FROM mcp_authorizations WHERE expires_at<?',
      ).bind(now),
      c.env.CONTROL_DB.prepare(
        'DELETE FROM mcp_grants WHERE expires_at<?',
      ).bind(now),
      c.env.CONTROL_DB.prepare(
        'DELETE FROM mcp_clients WHERE created_at<? AND NOT EXISTS(SELECT 1 FROM mcp_grants WHERE client_id=mcp_clients.id) AND NOT EXISTS(SELECT 1 FROM mcp_authorizations WHERE client_id=mcp_clients.id)',
      ).bind(now - 3600_000),
    ]);
    const id = crypto.randomUUID(),
      secret =
        parsed.data.token_endpoint_auth_method === 'none'
          ? null
          : opaqueToken();
    const result = await c.env.CONTROL_DB.prepare(
      'INSERT INTO mcp_clients(id,metadata,secret_hash,created_at) SELECT ?,?,?,? WHERE (SELECT count(*) FROM mcp_clients)<10000 RETURNING id',
    )
      .bind(
        id,
        JSON.stringify(parsed.data),
        secret ? await tokenHash(secret) : null,
        now,
      )
      .first();
    if (!result)
      return fail(c, 'slow_down', 'Client registration capacity reached.', 429);
    return c.json(
      {
        ...parsed.data,
        client_id: id,
        client_id_issued_at: Math.floor(now / 1000),
        ...(secret
          ? { client_secret: secret, client_secret_expires_at: 0 }
          : {}),
      },
      201,
    );
  });
  app.get('/authorize', async (c) => {
    const q = c.req.query();
    const client = await clientFor(c.env, q.client_id ?? '');
    if (!client) return fail(c, 'invalid_client', 'Unknown client.');
    const metadata = JSON.parse(client.metadata) as Metadata;
    const redirect =
      q.redirect_uri ??
      (metadata.redirect_uris.length === 1 ? metadata.redirect_uris[0] : '');
    if (
      !redirect ||
      !z.string().url().safeParse(redirect).success ||
      !metadata.redirect_uris.some((uri) => redirectMatches(redirect, uri))
    )
      return fail(c, 'invalid_request', 'Unregistered redirect URI.');
    if (
      q.response_type !== 'code' ||
      q.code_challenge_method !== 'S256' ||
      !/^[A-Za-z0-9_-]{43}$/.test(q.code_challenge ?? '') ||
      (q.state?.length ?? 0) > 2048
    )
      return fail(
        c,
        'invalid_request',
        'Use an authorization code with S256 PKCE.',
      );
    if (q.resource !== resource(c))
      return fail(c, 'invalid_target', 'Use the shared MCP resource.');
    if (q.scope !== undefined && q.scope !== scope)
      return fail(c, 'invalid_scope', 'Only portfolio:read is available.');
    const id = opaqueToken(),
      now = Date.now();
    const inserted = await c.env.CONTROL_DB.prepare(
      'INSERT INTO mcp_authorizations(id,client_id,redirect_uri,resource,state,challenge,expires_at) SELECT ?,?,?,?,?,?,? WHERE (SELECT count(*) FROM mcp_authorizations WHERE expires_at>?)<5000 RETURNING id',
    )
      .bind(
        id,
        client.id,
        redirect,
        resource(c),
        q.state ?? null,
        q.code_challenge,
        now + 600_000,
        now,
      )
      .first();
    if (!inserted)
      return fail(c, 'slow_down', 'Authorization capacity reached.', 429);
    return c.redirect('/oauth/consent?id=' + id, 303);
  });
  app.get('/oauth/consent', async (c) => {
    const id = c.req.query('id') ?? '';
    if (!/^[a-f0-9]{64}$/.test(id))
      return fail(c, 'invalid_request', 'Invalid connection request.');
    const next = '/oauth/consent?id=' + id;
    const user = await new Accounts(
      c.env.CONTROL_DB,
      c.env.AUTH_PEPPER,
    ).session(session(c.req.raw));
    if (!user)
      return c.redirect('/login?next=' + encodeURIComponent(next), 303);
    const row = await c.env.CONTROL_DB.prepare(
      'SELECT * FROM mcp_authorizations WHERE id=? AND expires_at>? AND code_hash IS NULL AND consumed_at IS NULL',
    )
      .bind(id, Date.now())
      .first<Authorization>();
    if (!row)
      return fail(
        c,
        'invalid_request',
        'This connection request expired or was already used.',
      );
    if (!(await new Passkeys(c.env).fresh(user)))
      return c.redirect(
        '/account/reauth?next=' + encodeURIComponent(next),
        303,
      );
    if (!(await mcpEnabled(c.env, user, origin(c))))
      return c.html(
        page(
          'Enable MCP',
          `<section class="account"><h1>Enable AI access first.</h1><p>Turn on MCP in your portfolio settings, then return to approve this connection.</p><p><a class="button" href="/w/${user.workspace_id}/settings?tab=mcp">Open MCP settings</a></p><p><a href="${e(next)}">Continue connection →</a></p></section>`,
        ),
      );
    const csrf = opaqueToken();
    await c.env.CONTROL_DB.prepare(
      'UPDATE mcp_authorizations SET user_id=?,session_hash=?,csrf_hash=? WHERE id=? AND code_hash IS NULL AND consumed_at IS NULL',
    )
      .bind(
        user.id,
        await tokenHash(session(c.req.raw)!),
        await tokenHash(csrf),
        id,
      )
      .run();
    const client = await clientFor(c.env, row.client_id);
    if (!client) return fail(c, 'invalid_client', 'Client expired. Reconnect.');
    const metadata = JSON.parse(client.metadata) as Metadata;
    return c.html(
      page(
        'Connect your AI assistant',
        `<form action="/oauth/consent" method="post"><span class="eyebrow">AI assistant access</span><h1>Connect ${e(metadata.client_name)}?</h1><p>Signed in as <strong>${e(user.email)}</strong><br>Portfolio: <strong>${e(user.label)}</strong></p><p>This connection can read your portfolio and refresh registrar information. It cannot change domain settings, transfer domains, renew domains, or make purchases.</p><p class="note">Client name supplied by the application. Access returns to <strong>${e(new URL(row.redirect_uri).origin)}</strong>.</p><input type="hidden" name="id" value="${id}"><input type="hidden" name="csrf" value="${csrf}"><button name="decision" value="approve" type="submit">Allow portfolio access</button> <button name="decision" value="deny" type="submit">Cancel</button><p class="note">Expires after 30 days. Revoke access any time in MCP settings.</p></form>`,
      ),
    );
  });
  app.post('/oauth/consent', async (c) => {
    if (!csrfOrigin(c)) return fail(c, 'access_denied', 'Invalid origin.', 403);
    const user = await new Accounts(
      c.env.CONTROL_DB,
      c.env.AUTH_PEPPER,
    ).session(session(c.req.raw));
    if (!user) return fail(c, 'access_denied', 'Sign in again.', 401);
    if (!(await new Passkeys(c.env).fresh(user)))
      return fail(c, 'access_denied', 'Confirm your identity again.', 403);
    const body = await form(c);
    if (!['approve', 'deny'].includes(body.decision))
      return fail(c, 'invalid_request', 'Choose allow or cancel.');
    if (
      body.decision === 'approve' &&
      !(await mcpEnabled(c.env, user, origin(c)))
    )
      return fail(c, 'access_denied', 'MCP is disabled.', 403);
    const code = opaqueToken(),
      now = Date.now();
    const row = await c.env.CONTROL_DB.prepare(
      'UPDATE mcp_authorizations SET code_hash=?,code_expires_at=?,csrf_hash=NULL,consumed_at=? WHERE id=? AND user_id=? AND session_hash=? AND csrf_hash=? AND expires_at>? AND code_hash IS NULL AND consumed_at IS NULL RETURNING *',
    )
      .bind(
        await tokenHash(code),
        now + 300_000,
        body.decision === 'deny' ? now : null,
        body.id ?? '',
        user.id,
        await tokenHash(session(c.req.raw)!),
        await tokenHash(body.csrf ?? ''),
        now,
      )
      .first<Authorization>();
    if (!row)
      return fail(
        c,
        'access_denied',
        'This consent form expired, changed accounts, or was already used.',
        403,
      );
    const target = new URL(row.redirect_uri);
    target.searchParams.set(
      body.decision === 'approve' ? 'code' : 'error',
      body.decision === 'approve' ? code : 'access_denied',
    );
    if (row.state !== null) target.searchParams.set('state', row.state);
    target.searchParams.set('iss', origin(c));
    return c.redirect(target.href, 303);
  });
  app.post('/token', async (c) => {
    const body = await form(c),
      client = await authenticate(c.env, body);
    if (!client) return fail(c, 'invalid_client', 'Invalid client.', 401);
    if (body.grant_type !== 'authorization_code')
      return fail(
        c,
        'unsupported_grant_type',
        'Only authorization_code is supported.',
      );
    const now = Date.now(),
      hash = await tokenHash(body.code ?? '');
    const row = await c.env.CONTROL_DB.prepare(
      'SELECT * FROM mcp_authorizations WHERE code_hash=? AND client_id=? AND consumed_at IS NULL AND code_expires_at>? AND expires_at>?',
    )
      .bind(hash, client.id, now, now)
      .first<Authorization>();
    if (
      !row ||
      row.redirect_uri !== body.redirect_uri ||
      row.resource !== body.resource ||
      row.resource !== resource(c) ||
      !(await pkce(body.code_verifier ?? '', row.challenge))
    )
      return fail(
        c,
        'invalid_grant',
        'Invalid or expired code, redirect, resource, or PKCE verifier.',
      );
    const token = opaqueToken(),
      id = crypto.randomUUID(),
      claim = crypto.randomUUID();
    const results = await c.env.CONTROL_DB.batch([
      c.env.CONTROL_DB.prepare(
        'UPDATE mcp_authorizations SET consumed_at=?,consumption_id=? WHERE code_hash=? AND consumed_at IS NULL AND code_expires_at>? AND expires_at>? AND EXISTS(SELECT 1 FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE u.id=mcp_authorizations.user_id AND w.enabled=1) RETURNING id',
      ).bind(now, claim, hash, now, now),
      c.env.CONTROL_DB.prepare(
        'INSERT INTO mcp_grants(id,token_hash,client_id,user_id,workspace_id,resource,created_at,expires_at) SELECT ?,?,a.client_id,u.id,u.workspace_id,a.resource,?,? FROM mcp_authorizations a JOIN users u ON u.id=a.user_id JOIN workspaces w ON w.id=u.workspace_id WHERE a.code_hash=? AND a.consumption_id=? AND w.enabled=1 RETURNING id',
      ).bind(
        id,
        await tokenHash(token),
        now,
        now + accessLifetime,
        hash,
        claim,
      ),
    ]);
    if (results[0].results.length !== 1 || results[1].results.length !== 1)
      return fail(
        c,
        'invalid_grant',
        'Code already used or account unavailable.',
      );
    return c.json({
      access_token: token,
      token_type: 'Bearer',
      expires_in: accessLifetime / 1000,
      scope,
    });
  });
  app.post('/revoke', async (c) => {
    const body = await form(c),
      client = await authenticate(c.env, body);
    if (!client) return fail(c, 'invalid_client', 'Invalid client.', 401);
    if (!body.token) return fail(c, 'invalid_request', 'Token required.');
    await c.env.CONTROL_DB.prepare(
      'UPDATE mcp_grants SET revoked_at=? WHERE token_hash=? AND client_id=?',
    )
      .bind(Date.now(), await tokenHash(body.token), client.id)
      .run();
    return c.json({});
  });
  app.on(['GET', 'POST', 'DELETE'], '/mcp', async (c) => {
    const unauthorized = () => {
      c.header(
        'WWW-Authenticate',
        `Bearer resource_metadata="${origin(c)}/.well-known/oauth-protected-resource/mcp", scope="${scope}"`,
      );
      return fail(
        c,
        'invalid_token',
        'Connect and authorize your portfolio.',
        401,
      );
    };
    const match = /^Bearer ([a-f0-9]{64})$/i.exec(
      c.req.header('authorization') ?? '',
    );
    if (!match) return unauthorized();
    const grant = await c.env.CONTROL_DB.prepare(
      'SELECT g.id,g.client_id,g.workspace_id,g.expires_at FROM mcp_grants g JOIN users u ON u.id=g.user_id AND u.workspace_id=g.workspace_id JOIN workspaces w ON w.id=g.workspace_id WHERE g.token_hash=? AND g.resource=? AND g.revoked_at IS NULL AND g.expires_at>? AND w.enabled=1',
    )
      .bind(await tokenHash(match[1]), resource(c), Date.now())
      .first<Grant>();
    if (!grant) return unauthorized();
    const configured = await workspaceFor(c.env, grant.workspace_id);
    if (!configured) return unauthorized();
    if (
      !(await new Accounts(c.env.CONTROL_DB, c.env.AUTH_PEPPER).rateLimit(
        'shared-mcp:' + grant.workspace_id,
        600,
      ))
    )
      return fail(c, 'slow_down', 'Portfolio request limit reached.', 429);
    if (c.req.method === 'POST') {
      let rpc: unknown;
      try {
        rpc = await c.req.raw.clone().json();
      } catch {
        return fail(c, 'invalid_request', 'Invalid MCP request.');
      }
      const denied = mcpPolicyDenial(
        rpc,
        grant.workspace_id,
        c.env.MCP_POLICIES,
      );
      if (denied) return fail(c, 'access_denied', denied, 403);
    }
    const headers = new Headers(c.req.raw.headers);
    for (const key of [...headers.keys()])
      if (
        key.toLowerCase().startsWith('x-dombot-') ||
        key.toLowerCase() === 'cookie'
      )
        headers.delete(key);
    headers.set('authorization', `Bearer ${MCP_DELEGATION_TOKEN}`);
    const forwarded = new Request(c.req.url, {
      method: c.req.method,
      headers,
      body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : c.req.raw.body,
      redirect: 'manual',
    });
    forwarded.headers.set(
      PROOF_HEADER,
      await signGatewayRequest(
        await workspaceKey(c.env, grant.workspace_id),
        grant.workspace_id,
        null,
        forwarded,
        undefined,
        {
          clientId: grant.client_id,
          scopes: [scope],
          expiresAt: Math.floor(grant.expires_at / 1000),
        },
      ),
    );
    const response = await workspaceService(c.env, configured.binding).fetch(
      forwarded,
    );
    const output = new Headers(response.headers);
    output.delete('set-cookie');
    if (response.status === 401)
      output.set(
        'WWW-Authenticate',
        `Bearer resource_metadata="${origin(c)}/.well-known/oauth-protected-resource/mcp", scope="${scope}"`,
      );
    return new Response(response.body, {
      status: response.status,
      headers: output,
    });
  });
  return app;
}
