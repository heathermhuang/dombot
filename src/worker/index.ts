import {
  clearLoginAttempts,
  loginSource,
  reserveLoginAttempt,
} from './login-rate-limit';
import { Hono, type Context, type MiddlewareHandler } from 'hono';
import { delegatedMcpAuth } from '../shared/gateway-proof';
import { ApiValidationError, invoke, type ApiMethodName } from '../core/api';
import { MCP_PUBLIC_PATHS, createMcpRoutes } from '../core/mcp/routes';
import { setAppIdentity } from '../core/app-info';
import { syncAll } from '../core/services/auto-sync';
import {
  configureIncrementalRenewalPricing,
  stepRenewalPricing,
} from '../core/services/registrars';
import { resetBulkMemory } from '../core/services/bulk-jobs';
import { getSettings } from '../core/services/settings';
import { BundleError } from '../core/storage/bundle';
import { EncryptedDocStore, aesGcmCipher } from '../core/storage/encrypted';
import {
  configureStore,
  flushWrites,
  hydrateStores,
} from '../core/storage/namespace';
import { APP_VERSION, webApi } from './api';
import {
  buildAuthConfig,
  checkPassword,
  clearSessionCookie,
  createSession,
  isAuthenticated,
  readCookie,
  revokeSession,
  sameOrigin,
  SESSION_COOKIE,
  sessionCookie,
  type AuthConfig,
} from './auth';
import { deriveEncryptionKey, parseRootSecret } from './keys';
import { withRequestLock } from './lock';
import { D1DocStore } from './storage/d1-doc-store';
import { runMigrations } from '../core/storage/migrations';
import { configureProxyTransport } from '../core/services/proxy-transport';
import { migrateLegacyProxies } from '../core/services/proxies';
import { workerProxyFetch } from './proxy-transport';
import { configureManagedProxy } from '../core/services/managed-proxy';
import { createPublicPortfolioRoutes } from './public-portfolio';
import { createPublicationRoutes } from './publication-routes';
import { PublicationStore } from './publication-store';
import { publicationBackupMethods } from './publication-backup';
import { createPublicSalesRoutes } from './public-sales';
import { createSalesInternalRoutes } from './sales-internal';
import { createSalesRoutes } from './sales-routes';
import { SalesStore } from './sales-store';
import { hasSales } from './sales-backup';
import {
  createVerifiedSaleObserver,
  salesControlState,
  changedSalesDomains,
} from './sales-observation';
import { SalesInquiryStore } from './sales-inquiry-store';
import { reconcileSalesOutcomes } from './sales-reconciliation';

// The Cloudflare Worker host: the same core (services, API table, storage
// façade) as the desktop app behind an HTTP transport. See
// docs/web-deployment.md.
//
// Per-isolate: the DocStore and derived keys are built once from env (bindings
// are stable for an isolate's life). Per-request: every namespace is
// re-hydrated from D1 — one query — so two isolates (or a cron and a request)
// never serve each other stale memory, and writes are flushed before the
// response goes out. Requests that touch state run one at a time within the
// isolate (src/worker/lock.ts), so that cycle can't interleave with another
// request's.

interface Boot {
  auth: AuthConfig;
}

let boot: Boot | null = null;
let bootFor = '';

/** The env values boot depends on. If they change under a live isolate
 *  (wrangler dev reloading .dev.vars; a secret rotated in place), the cached
 *  keys and auth config must not outlive them. */
function bootFingerprint(env: Env): string {
  return [
    env.DOMBOT_SECRET,
    env.DOMBOT_GATEWAY_SECRET,
    env.DOMBOT_WORKSPACE_ID,
    env.DOMBOT_PASSWORD,
    env.DOMBOT_AUTH,
    env.DOMBOT_MANAGED_PROXY_URL,
    env.DOMBOT_MANAGED_PROXY_IP,
    env.CF_ACCESS_TEAM_DOMAIN,
    env.CF_ACCESS_AUD,
  ].join('\u0000');
}

/** Called under the request lock. Cache only completed initialization: an
 * in-flight migration belongs to its incoming Worker request. */
async function bootOnce(env: Env): Promise<Boot> {
  const fp = bootFingerprint(env);
  if (boot && bootFor === fp) return boot;
  boot = null;
  const initialized = await (async () => {
    setAppIdentity({ version: APP_VERSION, platform: 'web' });
    const root = parseRootSecret(env.DOMBOT_SECRET);
    const cipher = await aesGcmCipher(await deriveEncryptionKey(root));
    const raw = new D1DocStore(env.DB);
    const store = new EncryptedDocStore(raw, cipher);
    configureStore(store);
    // Once per isolate, before any request hydrates. Renames copy raw rows,
    // so values move still sealed.
    await runMigrations(raw, store);
    configureProxyTransport(workerProxyFetch);
    configureManagedProxy(
      env.DOMBOT_AUTH === 'gateway' ? env.DOMBOT_MANAGED_PROXY_URL : undefined,
      env.DOMBOT_AUTH === 'gateway' ? env.DOMBOT_MANAGED_PROXY_IP : undefined,
    );
    configureIncrementalRenewalPricing(true);
    return { auth: await buildAuthConfig(env, root) };
  })();
  bootFor = fp;
  boot = initialized;
  return boot;
}

/** Fresh view of the store for this request. */
async function hydrate(oauthOnly = false): Promise<void> {
  // OAuth emits approval revisions in meta so existing browser tabs can
  // discover a new pairing request without reloading.
  await hydrateStores(
    oauthOnly ? new Set(['settings', 'mcp', 'meta']) : undefined,
  );
  // Idempotent and a no-op once done; its writes flush with the request's.
  if (!oauthOnly) await migrateLegacyProxies();
  resetBulkMemory();
}

type Vars = { auth: AuthConfig };
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

function retainRequestWork(c: Context, work: Promise<unknown>): void {
  let context: Pick<ExecutionContext, 'waitUntil'>;
  try {
    context = c.executionCtx;
  } catch {
    // The same Hono app is exercised without a Worker context in Node tests.
    // Those callers still await the foreground work.
    return;
  }
  context.waitUntil(work.catch(() => {}));
}

// Anonymous access is limited to the published projection. Never hydrate the
// private store or decrypt credentials to serve these pages.
app.route('/', createPublicPortfolioRoutes());
app.route('/', createPublicSalesRoutes());
app.route('/sales-internal', createSalesInternalRoutes());

// ── boot on every request ───────────────────────────────────────────────────
app.use('*', async (c, next) => {
  let b: Boot;
  try {
    if (boot && bootFor === bootFingerprint(c.env)) b = boot;
    else {
      const initialize = withRequestLock(() => bootOnce(c.env));
      // A client disconnect must not discard initialization while another
      // request is waiting for its coordination gate to be released.
      retainRequestWork(c, initialize);
      b = await initialize;
    }
  } catch (err) {
    // Misconfigured instance: say exactly what's missing, to the operator
    // only (this page is reachable before any auth exists).
    const message = err instanceof Error ? err.message : String(err);
    console.error('[worker] boot failed:', message);
    return c.text(`DomBot isn't configured yet.\n\n${message}\n`, 503);
  }
  c.set('auth', b.auth);
  await next();
});

// ── hydrate → handle → flush, serialized, for handlers that have state ─────
// Applied per route, *after* the checks that need no portfolio store (session cookie,
// origin, auth mode), so an unauthenticated request never costs a full
// decrypt of D1 or a turn on the lock. Under the lock a bulk step can't be
// re-hydrated out from under by a poll, and a burst of logins counts every
// attempt.
const stateful: MiddlewareHandler<{ Bindings: Env; Variables: Vars }> = (
  c,
  next,
) => {
  const work = withRequestLock(async () => {
    const oauthOnly =
      c.req.path !== '/mcp' &&
      MCP_PUBLIC_PATHS.some((path) =>
        path.endsWith('*')
          ? c.req.path.startsWith(path.slice(0, -1))
          : path === c.req.path,
      );
    await hydrate(oauthOnly);
    const salesReady = !oauthOnly && (await hasSales(c.env.DB));
    const beforeSales = salesReady
      ? salesControlState(c.env)
      : new Map<string, string>();
    await next();
    try {
      if (salesReady)
        await reconcileSalesOutcomes(await SalesStore.from(c.env));
      await flushWrites();
      if (c.req.method !== 'GET' && salesReady)
        await (
          await SalesStore.from(c.env)
        ).reconcile(
          createVerifiedSaleObserver(c.env),
          changedSalesDomains(beforeSales, salesControlState(c.env)),
        );
    } catch (err) {
      // The handler already answered, but its data didn't land; the next
      // hydrate will show the pre-request state. Say so instead of 200.
      const message = err instanceof Error ? err.message : String(err);
      console.error('[worker] persist failed:', message);
      c.res = c.json({ error: `Could not save changes: ${message}` }, 500);
    }
  });
  // Finish the already-authorized work and release the queue even when the
  // browser aborts a timed-out read. Keep failures on the foreground promise.
  retainRequestWork(c, work);
  return work;
};
// The MCP surface is bearer-authenticated by its own routes, and the gate
// (Settings → MCP) and OAuth state live in the store, so those paths hydrate
// before their handlers run.
for (const path of MCP_PUBLIC_PATHS) app.use(path, stateful);

// ── security headers ────────────────────────────────────────────────────────
// Mirrors the desktop renderer's CSP (src/electron/index.ts): same-origin
// only. The renderer talks to /api on its own origin and nothing else.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

function secure(c: Context): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

// ── auth endpoints (password mode) ──────────────────────────────────────────

app.get('/auth/status', async (c) => {
  const auth = c.get('auth');
  return c.json({
    mode: auth.mode,
    authenticated: await isAuthenticated(auth, c.req.raw, c.env.DB),
    version: APP_VERSION,
    sales: c.env.DOMBOT_SALES_V1 === 'true',
  });
});

app.post(
  '/auth/login',
  async (c, next) => {
    const auth = c.get('auth');
    if (auth.mode !== 'password')
      return c.json({ error: 'No login in this mode' }, 404);
    if (!sameOrigin(c.req.raw)) return c.json({ error: 'Bad origin' }, 403);
    await next();
  },
  async (c) => {
    const auth = c.get('auth');
    const source = await loginSource(c.req.raw, auth.sessionKey!);
    if (!source) return c.json({ error: 'Cannot identify login source' }, 503);
    const wait = await reserveLoginAttempt(c.env.DB, source);
    if (wait > 0) {
      c.header('Retry-After', String(Math.ceil(wait / 1000)));
      return c.json(
        {
          error: `Too many attempts. Try again in ${Math.ceil(wait / 1000)}s.`,
        },
        429,
      );
    }
    const body = (await c.req.json().catch(() => ({}))) as {
      password?: string;
    };
    if (
      typeof body.password !== 'string' ||
      !(await checkPassword(auth, body.password))
    ) {
      return c.json({ error: 'Wrong password' }, 401);
    }
    await clearLoginAttempts(c.env.DB, source);
    c.header(
      'Set-Cookie',
      sessionCookie(await createSession(auth.sessionKey!), secure(c)),
    );
    return c.json({ ok: true });
  },
);

app.post('/auth/logout', async (c) => {
  if (!sameOrigin(c.req.raw)) return c.json({ error: 'Bad origin' }, 403);
  const auth = c.get('auth');
  if (auth.mode === 'password') {
    await revokeSession(
      c.env.DB,
      auth.sessionKey!,
      readCookie(c.req.header('cookie'), SESSION_COOKIE),
    );
  }
  c.header('Set-Cookie', clearSessionCookie(secure(c)));
  return c.json({ ok: true });
});

// ── the API: one route over the method table ────────────────────────────────

app.route('/publishing', createPublicationRoutes(stateful));
app.route('/sales', createSalesRoutes(stateful));

app.post(
  '/api/:method',
  async (c, next) => {
    // Gate first — session checks read no private portfolio documents — so an
    // unauthenticated call never hydrates.
    if (!(await isAuthenticated(c.get('auth'), c.req.raw, c.env.DB))) {
      return c.json({ error: 'Not signed in' }, 401);
    }
    if (!sameOrigin(c.req.raw)) return c.json({ error: 'Bad origin' }, 403);
    await next();
  },
  stateful,
  async (c) => {
    const name = c.req.param('method') as ApiMethodName;
    let entry = Object.prototype.hasOwnProperty.call(webApi, name)
      ? webApi[name]
      : undefined;
    if (!entry) return c.json({ error: `Unknown method ${name}` }, 404);

    const body = (await c.req.json().catch(() => null)) as {
      args?: unknown;
    } | null;
    const args = Array.isArray(body?.args) ? (body!.args as unknown[]) : [];
    try {
      if (name === 'exportData' || name === 'importData') {
        const cipher = await aesGcmCipher(
          await deriveEncryptionKey(parseRootSecret(c.env.DOMBOT_SECRET)),
        );
        entry = publicationBackupMethods(
          new PublicationStore(c.env.DB, cipher),
          c.env.DOMBOT_OWNER_SITE_V2 === 'true',
          (await hasSales(c.env.DB)) ? await SalesStore.from(c.env) : undefined,
        )[name];
      }
      const result = await invoke(name, entry, args);
      if (name === 'deleteDomains' && (await hasSales(c.env.DB)))
        await (await SalesStore.from(c.env)).removeNames(args[0] as string[]);
      return c.json({ result: result === undefined ? null : result });
    } catch (err) {
      if (err instanceof ApiValidationError || err instanceof BundleError) {
        return c.json({ error: err.message }, 400);
      }
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[api] ${name} failed:`, message);
      return c.json({ error: message }, 500);
    }
  },
);

app.all('/api/*', (c) => c.json({ error: 'Method not allowed' }, 405));

// ── MCP + its OAuth server ──────────────────────────────────────────────────
// Shared with the desktop (src/core/mcp/routes.ts). Bearer-authenticated on
// its own, so it sits outside the session gate above; it answers 404 until
// the user turns it on in Settings → MCP. Behind Cloudflare Access these
// paths must be excluded from the Access policy (docs/self-hosting.md).
for (const path of MCP_PUBLIC_PATHS) {
  app.all(path, (c) =>
    createMcpRoutes({
      version: APP_VERSION,
      basePath: c.env.DOMBOT_PUBLIC_BASE_PATH,
      enforceScopes: c.env.DOMBOT_AUTH === 'gateway',
      verifyStaticToken: (_token, request) => delegatedMcpAuth(request, c.env),
    }).fetch(c.req.raw),
  );
}

// ── the SPA ─────────────────────────────────────────────────────────────────
// Everything else is the renderer, served from the assets binding. In
// password mode the HTML itself is public (it has to be — it holds the login
// form) but carries no data; every data call is gated above. In the other
// modes the gate sits in front of the whole origin anyway.
app.get('*', async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  const headers = new Headers(res.headers);
  if ((headers.get('content-type') ?? '').includes('text/html')) {
    headers.set('Content-Security-Policy', CSP);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set('Cache-Control', 'no-store');
  }
  return new Response(res.body, { status: res.status, headers });
});

export default {
  fetch: app.fetch,

  // Hourly cron (wrangler.jsonc). syncAll() runs only when the cache is older
  // than the configured interval, so the setting decides the real cadence.
  async scheduled(_controller, env) {
    await withRequestLock(async () => {
      await bootOnce(env);
      await hydrate();
      if (await hasSales(env.DB))
        await reconcileSalesOutcomes(await SalesStore.from(env));
      if (await hasSales(env.DB))
        await new SalesInquiryStore(
          await SalesStore.from(env),
          env.DOMBOT_SALES_ORIGIN ?? 'https://unconfigured.invalid',
        ).cleanup();
      const beforeSales = salesControlState(env);
      const minutes = getSettings().autoSyncIntervalMinutes;
      if (minutes <= 0) {
        console.log('[cron] auto-sync disabled in settings');
        return;
      }
      const ran = await syncAll(minutes * 60_000);
      await stepRenewalPricing();
      if (await hasSales(env.DB))
        await (
          await SalesStore.from(env)
        ).reconcile(
          createVerifiedSaleObserver(env),
          changedSalesDomains(beforeSales, salesControlState(env)),
        );
      console.log(
        ran ? '[cron] portfolio synced' : '[cron] cache fresh; skipped',
      );
      await flushWrites();
    });
  },
} satisfies ExportedHandler<Env>;
