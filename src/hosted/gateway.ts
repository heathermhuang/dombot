import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { Accounts } from './accounts';
import { accountForm, home, page } from './views';
import { PROOF_HEADER, signGatewayRequest } from '../shared/gateway-proof';

const workspaceSchema = z
  .array(
    z.object({
      id: z.string().uuid(),
      binding: z.enum(['WORKSPACE_0', 'WORKSPACE_1', 'WORKSPACE_2']),
      label: z.string(),
    }),
  )
  .max(3);
type GatewayVariables = { user: Awaited<ReturnType<Accounts['session']>> };
type GatewayEnv = { Bindings: HostedEnv; Variables: GatewayVariables };
const app = new Hono<GatewayEnv>();
const account = (env: HostedEnv) =>
  new Accounts(env.CONTROL_DB, env.AUTH_PEPPER);
const secure = (url: string) => new URL(url).protocol === 'https:';
const cookieName = (url: string) =>
  secure(url) ? '__Host-dd_session' : 'dd_session';
const readSession = (r: Request) =>
  r.headers
    .get('cookie')
    ?.split(';')
    .map((x) => x.trim())
    .find((x) => x.startsWith(`${cookieName(r.url)}=`))
    ?.split('=')[1];
const sessionCookie = (url: string, token: string) =>
  `${cookieName(url)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? 604800 : 0}${secure(url) ? '; Secure' : ''}`;
const sameOrigin = (r: Request) =>
  r.headers.get('origin') === new URL(r.url).origin;
const safeNext = (value: unknown) =>
  typeof value === 'string' &&
  /^\/w\/[a-f0-9-]{36}\//.test(value) &&
  !/[\r\n\\]/.test(value)
    ? value
    : '/app';
const mcpPath = (path: string) =>
  [
    '/mcp',
    '/authorize',
    '/token',
    '/register',
    '/revoke',
    '/oauth/status',
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-authorization-server/mcp',
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
  ].includes(path);

app.use(
  '*',
  bodyLimit({
    maxSize: 8 * 1024 * 1024,
    onError: (c) => c.json({ error: 'Request too large' }, 413),
  }),
);
app.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  // Native POST forms may send Origin:null under no-referrer. same-origin
  // preserves their CSRF signal while suppressing cross-origin referrers.
  c.header('Referrer-Policy', 'same-origin');
  c.header('X-Robots-Tag', 'noindex, nofollow');
  c.header(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
  await next();
});
app.onError((_error, c) =>
  c.json(
    { error: 'The request could not be completed. Please try again.' },
    500,
  ),
);
app.get('/', (c) => c.html(home()));
app.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'domains-staging',
    version: 'hosted-foundation-1',
  }),
);
app.get('/login', (c) =>
  c.html(accountForm('login', '', '', safeNext(c.req.query('next')))),
);
app.get('/join', (c) =>
  c.html(accountForm('join', '', c.req.query('code') ?? '')),
);
app.post('/session/:kind', bodyLimit({ maxSize: 16_384 }), async (c) => {
  if (!sameOrigin(c.req.raw)) return c.json({ error: 'Bad origin' }, 403);
  const accounts = account(c.env);
  if (
    !(await accounts.rateLimit(
      `ip:${c.req.header('cf-connecting-ip') ?? 'local'}`,
      30,
    ))
  )
    return c.text('Too many attempts. Try again later.', 429);
  const kind = c.req.param('kind');
  if (kind === 'logout') {
    await accounts.logout(readSession(c.req.raw));
    c.header('Set-Cookie', sessionCookie(c.req.url, ''));
    return c.redirect('/login', 303);
  }
  if (kind !== 'login' && kind !== 'join') return c.notFound();
  const form = await c.req.parseBody();
  const parsed = z
    .object({
      email: z
        .string()
        .email()
        .max(254)
        .transform((x) => x.trim().toLowerCase()),
      password: z.string().min(12).max(256),
      code: z.string().max(128).optional(),
      next: z.string().max(4096).optional(),
    })
    .safeParse(form);
  if (!parsed.success)
    return c.html(
      accountForm(
        kind,
        'Enter your email and a password of at least 12 characters.',
        typeof form.code === 'string' ? form.code : '',
      ),
      400,
    );
  const { email, password, code } = parsed.data;
  if (!(await accounts.rateLimit(`email:${email}`, 12)))
    return c.text('Too many attempts. Try again later.', 429);
  let user;
  if (kind === 'join') {
    try {
      user = await accounts.claimInvite(email, password, code ?? '');
    } catch {
      return c.html(
        accountForm(
          'join',
          'The invitation is invalid, expired, or already claimed.',
          code,
        ),
        400,
      );
    }
  } else user = await accounts.login(email, password);
  if (!user)
    return c.html(
      accountForm('login', 'Email or password was not recognized.'),
      401,
    );
  c.header(
    'Set-Cookie',
    sessionCookie(c.req.url, await accounts.newSession(user)),
  );
  return c.redirect(safeNext(parsed.data.next), 303);
});
app.get('/app', async (c) => {
  const user = await account(c.env).session(readSession(c.req.raw));
  return user
    ? c.redirect(`/w/${user.workspace_id}/`, 303)
    : c.redirect('/login', 303);
});
app.get('/session', async (c) => {
  const user = await account(c.env).session(readSession(c.req.raw));
  return user
    ? c.json({
        email: user.email,
        workspaceId: user.workspace_id,
        label: user.label,
      })
    : c.json({ error: 'Not signed in' }, 401);
});

app.get('/account', async (c) => {
  const user = await account(c.env).session(readSession(c.req.raw));
  if (!user) return c.redirect('/login', 303);
  return c.html(
    page(
      'Account security',
      `<form action="/account/password" method="post"><h1>Account security</h1><p>Changing your password signs out every browser session. Manage paired agents separately in your workspace’s MCP settings.</p><label>Current password<input name="oldPassword" type="password" autocomplete="current-password" required maxlength="256"></label><label>New password<input name="newPassword" type="password" autocomplete="new-password" required minlength="12" maxlength="256"></label><button type="submit">Change password</button><p><a href="/app">Back to workspace</a></p></form>`,
    ),
  );
});
app.post('/account/password', bodyLimit({ maxSize: 16384 }), async (c) => {
  if (!sameOrigin(c.req.raw)) return c.json({ error: 'Bad origin' }, 403);
  const accounts = account(c.env);
  const user = await accounts.session(readSession(c.req.raw));
  if (!user) return c.json({ error: 'Not signed in' }, 401);
  if (!(await accounts.rateLimit(`password:${user.id}`, 6)))
    return c.text('Too many attempts. Try again later.', 429);
  const parsed = z
    .object({
      oldPassword: z.string().max(256),
      newPassword: z.string().min(12).max(256),
    })
    .safeParse(await c.req.parseBody());
  if (!parsed.success)
    return c.text('Use a new password of at least 12 characters.', 400);
  if (
    !(await accounts.changePassword(
      user,
      parsed.data.oldPassword,
      parsed.data.newPassword,
    ))
  )
    return c.text('Current password was not recognized.', 401);
  c.header('Set-Cookie', sessionCookie(c.req.url, ''));
  return c.redirect('/login', 303);
});

// RFC 8414 and RFC 9728 issuer-path discovery forms.
app.get('/.well-known/:kind/w/:workspace/*', (c) => {
  const kind = c.req.param('kind');
  if (
    !['oauth-authorization-server', 'oauth-protected-resource'].includes(kind)
  )
    return c.notFound();
  return c.redirect(
    `/w/${c.req.param('workspace')}/.well-known/${kind}${kind === 'oauth-protected-resource' ? '/mcp' : ''}`,
    302,
  );
});

app.all('/w/:workspace/*', async (c) => {
  const id = c.req.param('workspace');
  const configured = workspaceSchema
    .parse(JSON.parse(c.env.WORKSPACES))
    .find((w) => w.id === id);
  if (!configured) return c.json({ error: 'Workspace not found' }, 404);
  const workspace = await c.env.CONTROL_DB.prepare(
    'SELECT id FROM workspaces WHERE id=?1 AND enabled=1',
  )
    .bind(id)
    .first();
  if (!workspace) return c.json({ error: 'Workspace not found' }, 404);
  const url = new URL(c.req.url);
  const base = `/w/${id}`;
  const path = url.pathname.slice(base.length) || '/';
  const publicRequest = mcpPath(path) || /^\/p\/[a-z0-9-]+$/.test(path);
  if (
    ['/register', '/authorize', '/token'].includes(path) &&
    !(await account(c.env).rateLimit(
      `oauth:${id}:${c.req.header('cf-connecting-ip') ?? 'local'}`,
      60,
    ))
  )
    return c.json({ error: 'Too many authorization requests' }, 429);
  const user = await account(c.env).session(readSession(c.req.raw));
  if (!publicRequest && (!user || user.workspace_id !== id)) {
    if (
      !user &&
      c.req.method === 'GET' &&
      !path.startsWith('/api') &&
      !path.startsWith('/publishing')
    )
      return c.redirect(
        `/login?next=${encodeURIComponent(base + path + url.search)}`,
        303,
      );
    return c.json(
      { error: user ? 'Workspace access denied' : 'Not signed in' },
      user ? 403 : 401,
    );
  }
  // Even a signed-in visitor to a different workspace's public MCP surface
  // must not receive that workspace's owner authority.
  const owner = user?.workspace_id === id ? user.id : null;
  if (path === '/auth/logout' && c.req.method === 'POST') {
    if (!sameOrigin(c.req.raw)) return c.json({ error: 'Bad origin' }, 403);
    await account(c.env).logout(readSession(c.req.raw));
    c.header('Set-Cookie', sessionCookie(c.req.url, ''));
    return c.json({ ok: true });
  }
  const headers = new Headers(c.req.raw.headers);
  for (const key of [...headers.keys()])
    if (
      key.toLowerCase().startsWith('x-dombot-') ||
      key.toLowerCase() === 'cookie'
    )
      headers.delete(key);
  url.pathname = path;
  const request = new Request(url, {
    method: c.req.method,
    headers,
    body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : c.req.raw.body,
    redirect: 'manual',
  });
  const keys = z
    .record(z.string().min(32))
    .parse(JSON.parse(c.env.GATEWAY_KEYS));
  request.headers.set(
    PROOF_HEADER,
    await signGatewayRequest(keys[id], id, owner, request),
  );
  const response = await c.env[configured.binding].fetch(request);
  const resultHeaders = new Headers(response.headers);
  resultHeaders.delete('set-cookie');
  const location = resultHeaders.get('location');
  if (location?.startsWith('/') && !location.startsWith('//'))
    resultHeaders.set('location', base + location);
  // Tenant HTML supplies its own CSP, including the existing app asset policy.
  c.header(
    'Content-Security-Policy',
    resultHeaders.get('content-security-policy') ?? "default-src 'none'",
  );
  return new Response(response.body, {
    status: response.status,
    headers: resultHeaders,
  });
});
app.get('*', (c) =>
  c.html(
    page(
      'Not found',
      '<h1>Page not found.</h1><p><a href="/">Return home</a></p>',
    ),
    404,
  ),
);

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: HostedEnv) {
    await env.CONTROL_DB.batch([
      env.CONTROL_DB.prepare('DELETE FROM sessions WHERE expires_at<?1').bind(
        Date.now(),
      ),
      env.CONTROL_DB.prepare(
        'DELETE FROM rate_limits WHERE expires_at<?1',
      ).bind(Date.now()),
    ]);
  },
} satisfies ExportedHandler<HostedEnv>;
