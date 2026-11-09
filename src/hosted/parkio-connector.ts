import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { Accounts, type SessionUser } from './accounts';
import { workspaceFor, workspaceKey, workspaceService } from './workspaces';
import { activateWorkspace, pendingWorkspace } from './on-demand';
import { PROOF_HEADER, signGatewayRequest } from '../shared/gateway-proof';
import { page } from './views';
import { parkioNativeContent } from './parkio-native-view';
import {
  parkioCredentialSchema,
  type ParkioCredential,
  type ParkioSourceView,
} from '../shared/parkio';
const sameOrigin = (r: Request) =>
  r.headers.get('Origin') === new URL(r.url).origin;
const uuid = z.string().uuid();
const base = '/connectors/parkio';
export function parkioEnabled(env: HostedEnv, workspace: string) {
  try {
    const ids = z
      .array(z.string())
      .max(501)
      .parse(JSON.parse(env.PARKIO_CONNECTOR_WORKSPACES ?? '[]'));
    return (
      env.PARKIO_CONNECTOR_ENABLED === 'true' &&
      !!env.PARKIO_LOGIN &&
      !!env.PARKIO_BROWSER &&
      (env.PARKIO_LOGIN_SECRET?.length ?? 0) >= 32 &&
      (ids.includes('*') || ids.includes(workspace))
    );
  } catch {
    return false;
  }
}
async function sessionHash(token: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
async function broker(
  env: HostedEnv,
  user: SessionUser,
  token: string,
  action: string,
  body: unknown = {},
  intentId?: string,
) {
  const ns = env.PARKIO_LOGIN!;
  const response = await ns
    .get(ns.idFromName(user.workspace_id + '/' + user.id))
    .fetch('https://parkio-login.internal/' + action, {
      method: 'POST',
      headers: {
        'X-Parkio-Owner': user.id,
        'X-Parkio-Workspace': user.workspace_id,
        'X-Parkio-Session': await sessionHash(token),
        'Content-Type': 'application/json',
        ...(intentId ? { 'X-Parkio-Intent': intentId } : {}),
      },
      body: JSON.stringify(body),
    });
  return response;
}
export async function cancelParkioLogin(
  env: HostedEnv,
  user: SessionUser,
  token: string,
) {
  if (!env.PARKIO_LOGIN) return;
  const response = await broker(env, user, token, 'cancelSession');
  await response.body?.cancel();
}
async function tenant(
  env: HostedEnv,
  user: SessionUser,
  path: string,
  body?: unknown,
  allocate = false,
) {
  const available = await env.CONTROL_DB.prepare(
    'SELECT 1 FROM workspaces WHERE id=? AND enabled=1',
  )
    .bind(user.workspace_id)
    .first();
  if (!available) throw Error('portfolio_unavailable');
  let workspace = await workspaceFor(env, user.workspace_id);
  if (
    !workspace &&
    allocate &&
    (await pendingWorkspace(env, user.workspace_id))
  ) {
    await activateWorkspace(env, user, 'import', crypto.randomUUID());
    workspace = await workspaceFor(env, user.workspace_id);
  }
  if (!workspace) throw Error('portfolio_unavailable');
  const request = new Request('https://domains.domains' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: 'https://domains.domains',
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  request.headers.set(
    PROOF_HEADER,
    await signGatewayRequest(
      await workspaceKey(env, user.workspace_id),
      user.workspace_id,
      user.id,
      request,
    ),
  );
  return workspaceService(env, workspace.binding).fetch(request);
}
async function parse<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw Error(
      data.error && /^[a-z_]{1,80}$/.test(data.error)
        ? data.error
        : 'connection_unavailable',
    );
  return data;
}
export function parkioConnectorRoutes(
  session: (request: Request, env: HostedEnv) => Promise<SessionUser | null>,
  readToken: (request: Request) => string | undefined,
) {
  const app = new Hono<{
    Bindings: HostedEnv;
    Variables: { user: SessionUser; token: string; intentId: string };
  }>();
  app.use('*', bodyLimit({ maxSize: 4096 }));
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'same-origin');
    c.header('X-Robots-Tag', 'noindex,nofollow');
    const user = await session(c.req.raw, c.env),
      token = readToken(c.req.raw);
    if (!user || !token)
      return c.redirect('/login?next=' + encodeURIComponent(base), 303);
    if (new URL(c.req.url).pathname === base + '/availability')
      return c.json({ enabled: parkioEnabled(c.env, user.workspace_id) });
    if (!parkioEnabled(c.env, user.workspace_id)) return c.notFound();
    if (c.req.method !== 'GET' && !sameOrigin(c.req.raw))
      return c.json({ error: 'bad_origin' }, 403);
    c.set('user', user);
    c.set('token', token);
    const suffix = new URL(c.req.url).pathname.slice(base.length);
    if (
      !['', '/', '/start', '/saved-session', '/owner-session'].includes(suffix)
    ) {
      const expected = uuid.parse(
        c.req.header('X-Parkio-Intent') ?? c.req.query('intent'),
      );
      const current = await parse<{ id: string }>(
        await broker(c.env, user, token, 'intent', {}, expected),
      );
      if (current.id !== expected) throw Error('connection_replaced');
      c.set('intentId', expected);
    }

    return next();
  });
  app.onError((error, c) => {
    const code =
      error instanceof z.ZodError
        ? 'invalid_request'
        : /^[a-z_]{1,80}$/.test(error.message)
          ? error.message
          : 'connection_unavailable';
    if (c.req.method === 'GET' && c.req.header('accept')?.includes('text/html'))
      return c.html(
        page(
          'Park.io sign-in',
          '<section class="account"><h1>This sign-in could not continue.</h1><p>Your saved domains are kept. Return to Registrars and connect again.</p><a class="button" href="/app">Open your portfolio →</a></section>',
        ),
        409,
      );
    return c.json({ error: code }, 409);
  });
  app.get('/', async (c) =>
    c.html(
      page(
        'Connect Park.io',
        `<section class="account"><h1>Connect Park.io</h1><p>Bring your active Park.io domains and expiration dates into your private portfolio. Background updates run about once a day.</p><p>Sign in once using native fields. Your password is not saved. The encrypted login session is kept for up to 30 days, or until it expires or you disconnect.</p><form method="post" action="${base}/start"><input type="hidden" name="intentKey" value="${crypto.randomUUID()}"><button>Connect Park.io →</button></form><p><a href="/w/${c.get('user').workspace_id}/#/settings/registrars">Back to Registrars →</a></p></section>`,
      ),
    ),
  );
  app.post('/start', async (c) => {
    const input = c.req.header('content-type')?.includes('application/json')
      ? await c.req.json()
      : await c.req.parseBody();
    const p = z
      .object({
        sourceId: uuid.optional(),
        revision: uuid.optional(),
        intentKey: uuid,
      })
      .strict()
      .parse(input);
    const user = c.get('user');
    let expectedEpoch: number | null = null;
    const sourceId = p.sourceId ?? p.intentKey;
    if (p.sourceId) {
      const saved = await parse<ParkioSourceView | null>(
        await tenant(c.env, user, '/internal/parkio/state/' + p.sourceId),
      );
      if (!saved || saved.revision !== p.revision) throw Error('conflict');
      expectedEpoch = saved.epoch;
    }
    if (
      !(await new Accounts(c.env.CONTROL_DB, c.env.AUTH_PEPPER).rateLimit(
        'parkio:start:' + user.id,
        6,
      ))
    )
      return c.json({ error: 'request_limit' }, 429);
    const result = await parse<{ intentId: string }>(
      await broker(c.env, user, c.get('token'), 'start', {
        sourceId,
        expectedEpoch,
        intentKey: p.intentKey,
      }),
    );
    return c.req.header('accept')?.includes('application/json')
      ? c.json({
          url: base + '/native?intent=' + result.intentId,
          intentId: result.intentId,
        })
      : c.redirect(base + '/native?intent=' + result.intentId, 303);
  });
  app.get('/native', (c) => {
    c.header(
      'Content-Security-Policy',
      "default-src 'none';style-src 'unsafe-inline';font-src 'self';script-src 'self';connect-src 'self' wss://live.browser.run;form-action 'none';base-uri 'none';frame-ancestors 'none'",
    );
    const content = parkioNativeContent
      .replace(
        '<section id="parkio-native">',
        `<section id="parkio-native" data-native-base="${base}" data-native-mode="connector" data-native-intent="${c.get('intentId')}">`,
      )
      .replaceAll('/admin/parkio-pilot', base)
      .replace(
        'href="' + base + '/sign-in"',
        'href="' + base + '/sign-in?intent=' + c.get('intentId') + '"',
      )
      .replace('Owner-only connection proof', 'Connect Park.io')
      .replace('Initial proof passed', 'Connected')
      .replace(
        'This proof requires JavaScript',
        'Connecting requires JavaScript',
      )
      .replace(
        'The browser was closed before the Worker independently read matching domains and available expiration dates. This is a read-only preview, not a portfolio import.',
        'Your Park.io session is encrypted in your private portfolio. This connection only reads inventory; manage renewals, transfers and DNS in Park.io.',
      )
      .replace(
        'Stable provider-account identity, export completeness and daily session reliability still require qualification.',
        'If Park.io expires your session, your saved inventory stays visible and you can sign in again from Registrars.',
      )
      .replace(
        'Sign in to verify your holdings and background updates. This proof does not change your portfolio.',
        'Sign in to add your active domains and keep their expiry dates up to date.',
      )
      .replace(
        'Its encrypted session is retained for up to 24 hours for this proof.',
        'Its encrypted session is kept for up to 30 days, or until it expires or you disconnect.',
      );
    return c.html(page('Connect Park.io', content));
  });
  app.get('/status', async (c) => {
    const intent = await parse<{ id: string; sourceId: string }>(
      await broker(
        c.env,
        c.get('user'),
        c.get('token'),
        'intent',
        {},
        c.get('intentId'),
      ),
    );
    const state = await parse<{ phase: string; error?: string }>(
      await broker(
        c.env,
        c.get('user'),
        c.get('token'),
        'status',
        {},
        c.get('intentId'),
      ),
    );
    if (await workspaceFor(c.env, c.get('user').workspace_id)) {
      const saved = await parse<ParkioSourceView | null>(
        await tenant(
          c.env,
          c.get('user'),
          '/internal/parkio/state/' + intent.sourceId,
        ),
      );
      if (saved?.activationId === intent.id) {
        if (saved.sync === 'running')
          return c.json({ phase: 'rechecking', browserClosed: true });
        if (saved.connection === 'connected' && !saved.error)
          return c.json({ phase: 'connected', browserClosed: true });
        return c.json({
          phase: 'blocked',
          error: saved.error ?? 'connection_changed',
        });
      }
      if (state.phase === 'connected')
        return c.json({ phase: 'blocked', error: 'connection_changed' });
    }
    return c.json(state);
  });
  for (const [path, action] of [
    ['native-connection', 'mobile'],
    ['mobile-connection', 'mobile'],
    ['native-complete', 'complete'],
    ['cancel', 'cancel'],
  ] as const)
    app.post('/' + path, async (c) => {
      const r = await broker(
        c.env,
        c.get('user'),
        c.get('token'),
        action,
        {},
        c.get('intentId'),
      );
      return new Response(r.body, {
        status: r.status,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      });
    });
  app.get('/native-proof', async (c) => {
    const r = await broker(
      c.env,
      c.get('user'),
      c.get('token'),
      'proof',
      {},
      c.get('intentId'),
    );
    return new Response(r.body, {
      status: r.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  });
  app.get('/sign-in', async (c) => {
    const result = await parse<{ url?: string } | string>(
      await broker(
        c.env,
        c.get('user'),
        c.get('token'),
        'view',
        {},
        c.get('intentId'),
      ),
    );
    const url = typeof result === 'string' ? result : result.url;
    if (!url) throw Error('connection_unavailable');
    c.header('Referrer-Policy', 'no-referrer');
    return c.redirect(url, 303);
  });
  app.post('/native-activate', async (c) => {
    const user = c.get('user'),
      token = c.get('token');
    const intent = await parse<{
      id: string;
      sourceId: string;
      expectedEpoch: number | null;
      completed: boolean;
    }>(await broker(c.env, user, token, 'intent', {}, c.get('intentId')));
    let saved: ParkioSourceView | null = null;
    if (await workspaceFor(c.env, user.workspace_id))
      saved = await parse<ParkioSourceView | null>(
        await tenant(c.env, user, '/internal/parkio/state/' + intent.sourceId),
      );
    if (saved?.activationId === intent.id) {
      if (saved.sync === 'running') return c.json({ pending: true });
      if (saved.connection !== 'connected' || saved.error)
        throw Error(saved.error ?? 'connection_unavailable');
    } else {
      if ((saved?.epoch ?? null) !== intent.expectedEpoch)
        throw Error('conflict');
      const candidate = await parse<{ credential: ParkioCredential }>(
        await broker(c.env, user, token, 'candidate', {}, c.get('intentId')),
      );
      parkioCredentialSchema.parse(candidate.credential);
      saved = await parse<ParkioSourceView>(
        await tenant(
          c.env,
          user,
          '/internal/parkio/activate',
          {
            sourceId: intent.sourceId,
            operationId: intent.id,
            expectedRevision: saved?.revision ?? null,
            credential: candidate.credential,
          },
          true,
        ),
      );
    }
    if (saved?.sync === 'running') return c.json({ pending: true });
    if (!intent.completed)
      await parse(
        await broker(c.env, user, token, 'transferred', {}, c.get('intentId')),
      );
    return c.json({
      connected: true,
      source: saved,
      portfolio: '/w/' + user.workspace_id + '/',
    });
  });
  app.get('/saved-session', async (c) => {
    const user = c.get('user');
    if (user.id !== c.env.PARKIO_PILOT_OWNER_ID || !c.env.PARKIO_PILOT)
      return c.json({ available: false });
    const ns = c.env.PARKIO_PILOT;
    const r = await ns
      .get(ns.idFromName('owner/' + user.id))
      .fetch('https://parkio-pilot.internal/status', {
        method: 'POST',
        headers: { 'X-Pilot-Owner': user.id },
      });
    const s = (await r.json()) as {
      phase: string;
      browserClosed: boolean;
      expiresAt: number;
      count: number;
    };
    return c.json({
      available:
        s.phase === 'passed' && s.browserClosed && s.expiresAt > Date.now(),
      count: s.count,
    });
  });
  app.post('/owner-session', async (c) => {
    const user = c.get('user');
    if (user.id !== c.env.PARKIO_PILOT_OWNER_ID || !c.env.PARKIO_PILOT)
      throw Error('session_unavailable');
    z.object({ consent: z.literal('save_parkio_session_30_days') })
      .strict()
      .parse(await c.req.json());
    const ns = c.env.PARKIO_PILOT,
      actor = ns.get(ns.idFromName('owner/' + user.id));
    const legacy = (action: string) =>
      actor.fetch('https://parkio-pilot.internal/' + action, {
        method: 'POST',
        headers: { 'X-Pilot-Owner': user.id },
      });
    const status = await parse<{ attemptId: string }>(await legacy('status'));
    const sourceId = uuid.parse(status.attemptId);
    let saved: ParkioSourceView | null = null;
    if (await workspaceFor(c.env, user.workspace_id))
      saved = await parse<ParkioSourceView | null>(
        await tenant(c.env, user, '/internal/parkio/state/' + sourceId),
      );
    if (saved?.activationId === sourceId) {
      if (saved.sync === 'running') return c.json({ pending: true });
      if (saved.connection !== 'connected' || saved.error)
        throw Error(saved.error ?? 'connection_unavailable');
    } else {
      const proof = await parse<{
        credential: ParkioCredential;
        nextCheckAt: number | null;
      }>(await legacy('connectorCandidate'));
      saved = await parse<ParkioSourceView>(
        await tenant(
          c.env,
          user,
          '/internal/parkio/activate',
          {
            sourceId,
            operationId: sourceId,
            expectedRevision: null,
            credential: proof.credential,
            initialCheckAt: proof.nextCheckAt,
          },
          true,
        ),
      );
    }
    if (saved?.sync === 'running') return c.json({ pending: true, sourceId });
    await parse(await legacy('cancel'));
    return c.json({
      connected: true,
      source: saved,
      portfolio: '/w/' + user.workspace_id + '/',
    });
  });
  return app;
}
