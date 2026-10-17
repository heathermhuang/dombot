import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { Accounts } from './accounts';
import { brandFontBytes, brandFontPath } from './brand-font';
import { sourcePage } from './source';
import { requestAccess, closeWorkspace } from './lifecycle';
import { legalPage, legalReady, legalVersion } from './legal';
import {
  Registration,
  registrationReady,
  registrationIds,
  emailReady,
  sendAccountEmail,
  issueRecovery,
} from './registration';
import {
  signupStart,
  signupFinish,
  recoveryStart,
  checkEmail,
} from './registration-views';
import { mcpPolicyDenial } from './mcp-policy';
import {
  accountForm,
  accountSecurity,
  home,
  page,
  recoveryForm,
} from './views';
import { PROOF_HEADER, signGatewayRequest } from '../shared/gateway-proof';
import { canonicalRedirect, portfolioAlias } from './launch';
import { gatewayKey, workspaceSchema, workspaceService } from './workspaces';
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
  const redirect = canonicalRedirect(c.req.raw, c.env.CANONICAL_ORIGIN);
  if (redirect) return redirect;
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  // Native POST forms may send Origin:null under no-referrer. same-origin
  // preserves their CSRF signal while suppressing cross-origin referrers.
  c.header('Referrer-Policy', 'same-origin');
  if (
    c.req.path !== '/' &&
    c.req.path !== '/domains' &&
    !/^\/w\/[a-f0-9-]+\/p\//.test(c.req.path)
  )
    c.header('X-Robots-Tag', 'noindex, nofollow');
  c.header(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
  await next();
});
app.onError((_error, c) =>
  c.json(
    { error: 'The request could not be completed. Please try again.' },
    500,
  ),
);
app.get(brandFontPath, (c) => {
  c.header('Content-Type', 'font/woff2');
  c.header('Cache-Control', 'public, max-age=31536000, immutable');
  return c.body(brandFontBytes);
});
app.get('/', (c) =>
  c.html(
    home(
      Boolean(
        c.env.PUBLIC_PORTFOLIO_ORIGIN === 'https://alternative.domains' ||
        portfolioAlias(c.env.PUBLIC_PORTFOLIO_PATH),
      ),
      registrationReady(c.env),
    ),
  ),
);
app.get('/source', (c) => c.html(sourcePage(c.env.SOURCE_COMMIT)));
app.get('/domains', (c) => {
  const path =
    c.env.PUBLIC_PORTFOLIO_ORIGIN === 'https://alternative.domains'
      ? 'https://alternative.domains/'
      : portfolioAlias(c.env.PUBLIC_PORTFOLIO_PATH);
  return path
    ? c.redirect(path + new URL(c.req.url).search, 302)
    : c.notFound();
});
app.get('/robots.txt', (c) =>
  c.text(
    'User-agent: *\nAllow: /\nDisallow: /login\nDisallow: /join\nDisallow: /account\nDisallow: /session\nDisallow: /app\n',
  ),
);
app.get('/terms', (c) =>
  c.html(legalPage('terms', c.env), legalReady(c.env) ? 200 : 503),
);
app.get('/privacy', (c) =>
  c.html(legalPage('privacy', c.env), legalReady(c.env) ? 200 : 503),
);
app.get('/signup', (c) =>
  c.html(
    registrationReady(c.env)
      ? signupStart()
      : page(
          'Request free access',
          `<form action="/signup" method="post"><span class="eyebrow">Free early access</span><h1>Request an account.</h1><p>Accounts are free during early access, by invitation and subject to capacity. We review requests before issuing a private invitation. Registrar charges are separate.</p><label>Email<input name="email" type="email" autocomplete="email" maxlength="254" required></label><button type="submit">Request free access</button><p class="note">We use this address to review your request and arrange an invitation. Pending requests expire after 30 days. No account is created by submitting this form.</p><p><a href="/login">Already have an account? Sign in</a></p></form>`,
        ),
  ),
);
app.post('/signup', bodyLimit({ maxSize: 4096 }), async (c) => {
  if (!sameOrigin(c.req.raw)) return c.json({ error: 'Bad origin' }, 403);
  const accounts = account(c.env);
  if (
    !(await accounts.rateLimit('signup:global', 20)) ||
    !(await accounts.rateLimit(
      `signup:${c.req.header('cf-connecting-ip') ?? 'local'}`,
      3,
    ))
  )
    return c.text('Too many access requests. Try again later.', 429);
  const parsed = z
    .object({
      email: z
        .string()
        .trim()
        .email()
        .max(254)
        .transform((x) => x.toLowerCase()),
    })
    .safeParse(await c.req.parseBody());
  if (!parsed.success)
    return c.html(
      page(
        'Check your email address',
        '<h1>Enter a valid email address.</h1><p><a href="/signup">Return to your request</a></p>',
      ),
      400,
    );
  if (registrationReady(c.env)) {
    const registration = new Registration(
      c.env.CONTROL_DB,
      c.env.AUTH_PEPPER,
      registrationIds(c.env),
    );
    if (!(await registration.hasCapacity()))
      return c.html(
        page(
          'Early access is full',
          '<h1>Early access is full.</h1><p>All available accounts are currently in use. Please check back later. Existing customers can still sign in.</p><p><a href="/login">Sign in</a></p>',
        ),
        503,
      );
    if (!(await accounts.rateLimit(`signup:email:${parsed.data.email}`, 2)))
      return c.text('Please wait before requesting another link.', 429);
    const code = await registration.issue(parsed.data.email);
    if (
      code &&
      !(await sendAccountEmail(c.env, parsed.data.email, code, 'signup'))
    )
      return c.html(
        page(
          'Email temporarily unavailable',
          '<h1>Email is temporarily unavailable.</h1><p>No account has been created. Please try again later.</p>',
        ),
        503,
      );
    return c.html(checkEmail('signup'), 202);
  }
  if (!(await requestAccess(c.env.CONTROL_DB, parsed.data.email))) {
    c.header('Retry-After', '3600');
    return c.html(
      page(
        'Access requests at capacity',
        '<h1>Access requests are at capacity.</h1><p>Please try again later or contact domains@domains.domains. No account has been created.</p>',
      ),
      503,
    );
  }
  return c.html(
    page(
      'Access request received',
      '<h1>Request received.</h1><p>Access is by invitation and subject to capacity. If an account is available, we will arrange an invitation after review. If you already have an account, sign in or use account recovery.</p><p><a href="/login">Sign in</a> · <a href="/">Return home</a></p>',
    ),
    202,
  );
});
app.get('/signup/verify', async (c) => {
  if (!registrationReady(c.env)) return c.redirect('/signup', 303);
  const code = c.req.query('code') ?? '';
  const email = await new Registration(
    c.env.CONTROL_DB,
    c.env.AUTH_PEPPER,
    registrationIds(c.env),
  ).emailFor(code);
  return email
    ? c.html(signupFinish(code, email))
    : c.html(
        page(
          'Verification link unavailable',
          '<h1>This link is unavailable.</h1><p>It may have expired or already been used.</p><p><a href="/signup">Request a new verification link</a></p>',
        ),
        400,
      );
});
app.post('/signup/verify', bodyLimit({ maxSize: 4096 }), async (c) => {
  if (!sameOrigin(c.req.raw)) return c.text('Bad origin', 403);
  if (!registrationReady(c.env))
    return c.text('Registration is temporarily unavailable.', 503);
  const accounts = account(c.env);
  if (
    !(await accounts.rateLimit(
      `signup:claim:${c.req.header('cf-connecting-ip') ?? 'local'}`,
      10,
    ))
  )
    return c.text('Too many attempts. Try again later.', 429);
  const form = z
    .object({
      code: z.string().regex(/^[a-f0-9]{64}$/),
      password: z.string().min(12).max(256),
      confirm: z.string().min(12).max(256),
      accept: z.literal('yes'),
      legalVersion: z.literal(legalVersion),
    })
    .safeParse(await c.req.parseBody());
  if (!form.success || form.data.password !== form.data.confirm)
    return c.html(
      page(
        'Check your details',
        '<h1>Check your details.</h1><p>Use matching passwords of at least 12 characters and accept the Terms and acknowledge the Privacy Policy. Return to your verification link to try again; your link has not been used.</p>',
      ),
      400,
    );
  const registration = new Registration(
    c.env.CONTROL_DB,
    c.env.AUTH_PEPPER,
    registrationIds(c.env),
  );
  let user;
  try {
    user = await registration.claim(form.data.code, form.data.password);
  } catch {
    return c.html(
      page(
        'Account not created',
        '<h1>No account was created.</h1><p>The link may have expired or already been used, or early access may be full.</p><p><a href="/signup">Try registration again</a> · <a href="/login">Sign in</a></p>',
      ),
      409,
    );
  }
  const token = await accounts.newSession(user);
  if (!token) return c.redirect('/login', 303);
  c.header('Set-Cookie', sessionCookie(c.req.url, token));
  return c.redirect('/app', 303);
});
app.post('/recover/request', bodyLimit({ maxSize: 4096 }), async (c) => {
  if (!sameOrigin(c.req.raw)) return c.text('Bad origin', 403);
  if (!emailReady(c.env))
    return c.text(
      'Email recovery is temporarily unavailable. Contact domains@domains.domains.',
      503,
    );
  const accounts = account(c.env);
  if (
    !(await accounts.rateLimit(
      `recovery:ip:${c.req.header('cf-connecting-ip') ?? 'local'}`,
      3,
    )) ||
    !(await accounts.rateLimit('recovery:global', 20))
  )
    return c.text('Too many requests. Try again later.', 429);
  const form = await c.req.parseBody();
  const email = z
    .string()
    .trim()
    .email()
    .max(254)
    .transform((s) => s.toLowerCase())
    .safeParse(form.email);
  if (!email.success)
    return c.html(recoveryStart('Enter a valid email address.'), 400);
  if (!(await accounts.rateLimit(`recovery:email:${email.data}`, 2)))
    return c.text('Please wait before requesting another link.', 429);
  const code = await issueRecovery(c.env.CONTROL_DB, email.data);
  if (code) await sendAccountEmail(c.env, email.data, code, 'recovery');
  // Match unknown, disabled, and known accounts, including provider failures.
  return c.html(checkEmail('recovery'), 202);
});
app.get('/account/close', async (c) => {
  const user = await account(c.env).session(readSession(c.req.raw));
  if (!user) return c.redirect('/login', 303);
  return c.html(
    page(
      'Close your account',
      `<form action="/account/close" method="post"><h1>Close your account.</h1><p>Export your backup in Settings first. Closing disables browser, API, paired-agent and public-collection access immediately. Your registrar accounts and domain registrations are not changed.</p><p>We retain your portfolio data for 30 days so support can help recover an accidental closure. Physical erasure is then handled by the operator. Your account identity is never assigned to another person.</p><label>Current password<input type="password" name="password" autocomplete="current-password" required maxlength="256"></label><label>Type CLOSE MY ACCOUNT<input name="confirmation" required></label><button type="submit">Close my account</button><p><a href="/account">Keep my account</a></p></form>`,
    ),
  );
});
app.post('/account/close', bodyLimit({ maxSize: 4096 }), async (c) => {
  if (!sameOrigin(c.req.raw)) return c.json({ error: 'Bad origin' }, 403);
  const accounts = account(c.env),
    user = await accounts.session(readSession(c.req.raw));
  if (!user) return c.json({ error: 'Not signed in' }, 401);
  if (!(await accounts.rateLimit(`closure:${user.id}`, 6)))
    return c.text('Too many attempts. Try again later.', 429);
  const form = await c.req.parseBody();
  if (
    form.confirmation !== 'CLOSE MY ACCOUNT' ||
    typeof form.password !== 'string' ||
    form.password.length > 256
  )
    return c.text(
      'Enter your current password and the exact confirmation.',
      400,
    );
  const verified = await accounts.login(user.email, form.password);
  if (!verified)
    return c.text(
      'Your password was not recognized. Return to account settings and try again.',
      401,
    );
  const configured = workspaceSchema
    .parse(JSON.parse(c.env.WORKSPACES))
    .find((w) => w.id === user.workspace_id);
  if (!configured)
    return c.text('Account is unavailable. Contact support.', 503);
  // Serialize behind current tenant operations and pause scheduled sync before
  // disabling ingress. This changes only the two requested settings.
  const pause = new Request(new URL('/api/updateSettings', c.req.url), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: new URL(c.req.url).origin,
    },
    body: JSON.stringify({
      args: [{ autoSyncIntervalMinutes: 0, mcpEnabled: false }],
    }),
  });
  pause.headers.set(
    PROOF_HEADER,
    await signGatewayRequest(
      gatewayKey(c.env, user.workspace_id),
      user.workspace_id,
      user.id,
      pause,
    ),
  );
  const paused = await workspaceService(c.env, configured.binding).fetch(pause);
  if (!paused.ok)
    return c.text(
      'Closure could not pause background activity. Your account remains accessible; try again or contact support.',
      503,
    );
  if (!(await closeWorkspace(c.env.CONTROL_DB, user, verified.credentialHash)))
    return c.text(
      'Your account changed during closure. Sign in and try again.',
      409,
    );
  c.header('Set-Cookie', sessionCookie(c.req.url, ''));
  return c.html(
    page(
      'Account closed',
      '<h1>Your account is closed.</h1><p>Browser, agent and public access are disabled. Contact domains@domains.domains within 30 days if you need help recovering an accidental closure.</p><p><a href="/">Return home</a></p>',
    ),
  );
});

app.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'domains-staging',
    version: 'hosted-foundation-1',
  }),
);
app.get('/login', (c) => {
  const notice =
    c.req.query('notice') === 'signed-out-all'
      ? 'Every browser session has been signed out. Sign in to continue.'
      : c.req.query('notice') === 'password-updated'
        ? 'Your password was updated and every browser session was signed out. Sign in with your new password.'
        : '';
  return c.html(
    accountForm('login', '', '', safeNext(c.req.query('next')), { notice }),
  );
});
app.get('/join', (c) =>
  c.html(accountForm('join', '', c.req.query('code') ?? '')),
);
app.get('/recover', (c) => {
  return c.html(
    !c.req.query('code') && emailReady(c.env)
      ? recoveryStart()
      : recoveryForm(c.req.query('code') ?? ''),
  );
});
app.post('/recover', bodyLimit({ maxSize: 16_384 }), async (c) => {
  if (!sameOrigin(c.req.raw)) return c.json({ error: 'Bad origin' }, 403);
  const accounts = account(c.env);
  if (
    !(await accounts.rateLimit(
      `recovery:${c.req.header('cf-connecting-ip') ?? 'local'}`,
      12,
    ))
  )
    return c.text('Too many attempts. Try again later.', 429);
  const body = await c.req.parseBody();
  const form = z
    .object({
      code: z.string().regex(/^[a-f0-9]{64}$/),
      password: z.string().min(12).max(256),
      confirm: z.string(),
    })
    .safeParse(body);
  if (!form.success || form.data.password !== form.data.confirm)
    return c.html(
      recoveryForm(
        typeof body.code === 'string' && /^[a-f0-9]{64}$/.test(body.code)
          ? body.code
          : '',
        'Use matching passwords of at least 12 characters. Your link has not been used. Enter both passwords again.',
      ),
      400,
    );
  if (!(await accounts.recoverPassword(form.data.code, form.data.password)))
    return c.html(
      recoveryForm(
        '',
        'This recovery link is invalid, expired, or already used. Contact support for a new link.',
      ),
      400,
    );
  c.header('Set-Cookie', sessionCookie(c.req.url, ''));
  return c.html(
    page(
      'Password updated',
      '<h1>Password updated.</h1><p>Every browser session has been signed out. Sign in with your new password. Paired agents are managed separately in MCP settings.</p><p><a class="button" href="/login">Sign in</a></p>',
    ),
  );
});
app.post('/session/:kind', bodyLimit({ maxSize: 16_384 }), async (c) => {
  if (!sameOrigin(c.req.raw)) return c.json({ error: 'Bad origin' }, 403);
  const accounts = account(c.env);
  const kind = c.req.param('kind');
  // Signing out must remain available after login throttling, including when
  // several customers share a public IP. Revoke durably before clearing cookies.
  if (kind === 'logout') {
    await accounts.logout(readSession(c.req.raw));
    c.header('Set-Cookie', sessionCookie(c.req.url, ''));
    return c.redirect('/login', 303);
  }
  if (kind !== 'login' && kind !== 'join') return c.notFound();
  if (
    !(await accounts.rateLimit(
      `ip:${c.req.header('cf-connecting-ip') ?? 'local'}`,
      30,
    ))
  )
    return c.text('Too many attempts. Try again later.', 429);
  const form = await c.req.parseBody();
  const next = safeNext(form.next);
  const emailInput =
    typeof form.email === 'string' ? form.email.trim().slice(0, 254) : '';
  const parsed = z
    .object({
      email: z
        .string()
        .trim()
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
        next,
        { email: emailInput },
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
          next,
          { email },
        ),
        400,
      );
    }
  } else user = await accounts.login(email, password);
  if (!user)
    return c.html(
      accountForm(
        'login',
        'Email or password was not recognized. Check your details and try again.',
        '',
        next,
        { email },
      ),
      401,
    );
  const token = await accounts.newSession(user);
  if (!token)
    return c.html(
      accountForm(
        'login',
        'Your credentials changed during sign-in. Please sign in again.',
        '',
        next,
        { email },
      ),
      401,
    );
  c.header('Set-Cookie', sessionCookie(c.req.url, token));
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
  return c.html(accountSecurity(user));
});
app.post('/account/sessions/logout', async (c) => {
  if (!sameOrigin(c.req.raw)) return c.json({ error: 'Bad origin' }, 403);
  const accounts = account(c.env);
  const user = await accounts.session(readSession(c.req.raw));
  if (!user) return c.json({ error: 'Not signed in' }, 401);
  // Derive the affected identity from the session, never a posted user/workspace.
  await accounts.logoutAll(user);
  c.header('Set-Cookie', sessionCookie(c.req.url, ''));
  return c.redirect('/login?notice=signed-out-all', 303);
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
    return c.html(
      accountSecurity(
        user,
        'Use a new password of at least 12 characters. Enter your current password again to retry.',
      ),
      400,
    );
  if (
    !(await accounts.changePassword(
      user,
      parsed.data.oldPassword,
      parsed.data.newPassword,
    ))
  )
    return c.html(
      accountSecurity(
        user,
        'Your current password was not recognized, or your credentials changed. Enter your current password again to retry.',
      ),
      401,
    );
  c.header('Set-Cookie', sessionCookie(c.req.url, ''));
  return c.redirect('/login?notice=password-updated', 303);
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
  if (!configured) return c.json({ error: 'Portfolio not found' }, 404);
  const workspace = await c.env.CONTROL_DB.prepare(
    'SELECT id FROM workspaces WHERE id=?1 AND enabled=1',
  )
    .bind(id)
    .first();
  if (!workspace) return c.json({ error: 'Portfolio not found' }, 404);
  const url = new URL(c.req.url);
  const base = `/w/${id}`;
  const path = url.pathname.slice(base.length) || '/';
  const publicRequest = mcpPath(path) || /^\/p\/[a-z0-9-]+$/.test(path);
  // Polls have their own allowance, separate from registration/issuance.
  // Bound public metadata/status traffic before it can enter the tenant.
  if (
    (path === '/oauth/status' ||
      path === '/revoke' ||
      path.startsWith('/.well-known/')) &&
    !(await account(c.env).rateLimit(
      `public-oauth:${id}:${path}:${c.req.header('cf-connecting-ip') ?? 'local'}`,
      path === '/oauth/status' ? 900 : 60,
    ))
  )
    return c.json({ error: 'Too many authorization requests' }, 429);
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
      { error: user ? 'Account access denied' : 'Not signed in' },
      user ? 403 : 401,
    );
  }
  if (
    [
      '/api/getPortfolio',
      '/api/syncRegistrar',
      '/api/stepRenewalPricing',
      '/api/lookupRegistrations',
    ].includes(path) &&
    !(await account(c.env).rateLimit(`provider:${id}`, 20))
  )
    return c.json(
      {
        error:
          'Provider refresh limit reached. Use cached inventory and try later.',
      },
      429,
    );
  if (path === '/api/updateSettings' && c.req.method === 'POST') {
    const body = (await c.req.raw.clone().json()) as {
      args?: { autoSyncIntervalMinutes?: number }[];
    };
    const interval = body.args?.[0]?.autoSyncIntervalMinutes;
    if (typeof interval === 'number' && interval > 0 && interval < 60)
      return c.json(
        {
          error:
            'Free accounts support automatic sync once an hour or less often. Use 0 to disable it.',
        },
        400,
      );
  }
  if (path === '/mcp' && c.req.method === 'POST') {
    if (
      !(await account(c.env).rateLimit(
        `mcp:${id}:${c.req.header('cf-connecting-ip') ?? 'local'}`,
        600,
      ))
    )
      return c.json(
        { error: 'Account agent request limit reached. Try again later.' },
        429,
      );
    let rpc: unknown;
    try {
      rpc = await c.req.raw.clone().json();
    } catch {
      return c.json({ error: 'Invalid MCP request' }, 400);
    }
    const denied = mcpPolicyDenial(rpc, id, c.env.MCP_POLICIES);
    if (denied)
      return c.json(
        {
          jsonrpc: '2.0',
          id: rpc && typeof rpc === 'object' && 'id' in rpc ? rpc.id : null,
          error: { code: -32003, message: denied },
        },
        403,
      );
  }
  if (
    !publicRequest &&
    path.startsWith('/api/') &&
    !(await account(c.env).rateLimit(`api:${id}`, 3000))
  )
    return c.json(
      { error: 'Account request limit reached. Try again later.' },
      429,
    );
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
  request.headers.set(
    PROOF_HEADER,
    await signGatewayRequest(gatewayKey(c.env, id), id, owner, request),
  );
  const response = await workspaceService(c.env, configured.binding).fetch(
    request,
  );
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
      env.CONTROL_DB.prepare(
        'DELETE FROM signup_proofs WHERE expires_at<?1',
      ).bind(Date.now()),
      env.CONTROL_DB.prepare(
        'DELETE FROM email_budgets WHERE expires_at<?1',
      ).bind(Date.now()),
      env.CONTROL_DB.prepare(
        'DELETE FROM signup_requests WHERE created_at<?1',
      ).bind(Date.now() - 30 * 86400_000),
      env.CONTROL_DB.prepare('DELETE FROM sessions WHERE expires_at<?1').bind(
        Date.now(),
      ),
      env.CONTROL_DB.prepare(
        'DELETE FROM rate_limits WHERE expires_at<?1',
      ).bind(Date.now()),
      env.CONTROL_DB.prepare(
        'DELETE FROM password_resets WHERE expires_at<?1',
      ).bind(Date.now()),
    ]);
  },
} satisfies ExportedHandler<HostedEnv>;
