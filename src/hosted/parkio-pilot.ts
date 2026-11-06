import type { BrowserRun } from '../../hosted/browser-run-types';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { isAdmin } from './admin';
import type { SessionUser } from './accounts';
import { Passkeys } from './passkeys';
import { page, escapeHtml as e } from './views';
import { evaluatePilot, withPilotPage } from './parkio-pilot-cdp';
import {
  PARKIO_ORIGIN,
  PILOT_LOGIN_MS,
  PILOT_RETENTION_MS,
  PILOT_MAX_BYTES,
  PilotError,
  exportUrl,
  qualifiedCookies,
  cookieHeader,
  parsePilotCsv,
  readBounded,
  sealPilot,
  openPilot,
  type PilotCookie,
  type PilotHolding,
} from './parkio-pilot-contract';

type Phase =
  | 'creating'
  | 'login'
  | 'checking'
  | 'closing'
  | 'ready'
  | 'passed'
  | 'blocked'
  | 'cancelled'
  | 'cleanup_required';
interface Attempt {
  id: string;
  phase: Phase;
  createdAt: number;
  expiresAt: number;
  day: string;
  starts: number;
  sessionId?: string;
  targetId?: string;
  browserClosed: boolean;
  error?: string;
  headers?: string[];
  cookieNames?: string[];
  activeExport?: string;
  cookies?: PilotCookie[];
  baseline?: PilotHolding[];
  expiryAvailable?: boolean;
  checkedAt?: number;
  checks?: number;
  cleanupAttempts?: number;
  result?: {
    count: number;
    namesMatch: boolean;
    expiriesMatch: boolean;
    cookieRotationObserved: boolean;
  };
}

function pilotEnabled(env: HostedEnv, now = Date.now()): boolean {
  const expiry = Date.parse(env.PARKIO_PILOT_EXPIRES_AT ?? '');
  return (
    env.PARKIO_PILOT_ENABLED === 'true' &&
    Boolean(env.PARKIO_PILOT_OWNER_ID) &&
    (env.PARKIO_PILOT_SECRET?.length ?? 0) >= 32 &&
    Number.isFinite(expiry) &&
    expiry > now
  );
}

function safeState(a: Attempt | null) {
  if (!a) return { phase: 'not_started' };
  return {
    phase: a.phase,
    attemptId: a.id,
    expiresAt: a.expiresAt,
    browserClosed: a.browserClosed,
    error: a.error ?? null,
    headers: a.headers ?? [],
    cookieNames: a.cookieNames ?? [],
    count: a.baseline?.length ?? null,
    expiryAvailable: a.expiryAvailable ?? false,
    checkedAt: a.checkedAt ?? null,
    result: a.result ?? null,
    // This single-owner feasibility test is not qualification of multi-account identity.
    accountIdentityQualified: false,
  };
}

/** One encrypted, temporary owner test. Never touches customer inventory or control D1. */
export class ParkioPilot {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: HostedEnv,
  ) {}
  /** Internal Fetcher boundary keeps storage helpers unexposed and the
   * gateway importable by the existing Node-based regression tests. */
  async fetch(request: Request): Promise<Response> {
    if (
      request.method !== 'POST' ||
      new URL(request.url).origin !== 'https://parkio-pilot.internal' ||
      request.headers.get('X-Pilot-Owner') !== this.env.PARKIO_PILOT_OWNER_ID
    )
      return new Response('Forbidden', { status: 403 });
    const action = new URL(request.url).pathname.slice(1);
    if (
      ![
        'status',
        'start',
        'view',
        'inspect',
        'capture',
        'retest',
        'cancel',
      ].includes(action)
    )
      return new Response('Not found', { status: 404 });
    try {
      return Response.json(
        await this[
          action as
            | 'status'
            | 'start'
            | 'view'
            | 'inspect'
            | 'capture'
            | 'retest'
            | 'cancel'
        ](),
      );
    } catch (error) {
      return Response.json(
        {
          error: error instanceof PilotError ? error.code : 'pilot_unavailable',
        },
        { status: 409 },
      );
    }
  }
  #tail: Promise<unknown> = Promise.resolve();
  #serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.#tail.then(work);
    this.#tail = run.catch(() => {});
    return run;
  }
  async #load(): Promise<Attempt | null> {
    const sealed = await this.ctx.storage.get<string>('sealed');
    return sealed
      ? openPilot<Attempt>(
          this.env.PARKIO_PILOT_SECRET ?? '',
          this.env.PARKIO_PILOT_OWNER_ID ?? '',
          sealed,
        )
      : null;
  }
  async #save(a: Attempt): Promise<void> {
    await this.ctx.storage.put(
      'sealed',
      await sealPilot(
        this.env.PARKIO_PILOT_SECRET ?? '',
        this.env.PARKIO_PILOT_OWNER_ID ?? '',
        a,
      ),
    );
  }
  #browser(): BrowserRun {
    if (!this.env.PARKIO_BROWSER) throw new PilotError('not_configured');
    return this.env.PARKIO_BROWSER;
  }
  #assertLive(a: Attempt) {
    if (
      !pilotEnabled(this.env) ||
      Date.now() >= a.expiresAt ||
      !a.sessionId ||
      !a.targetId ||
      a.browserClosed ||
      !['login', 'checking'].includes(a.phase)
    )
      throw new PilotError('login_expired');
  }
  async #close(a: Attempt): Promise<boolean> {
    if (!a.sessionId || a.browserClosed) return true;
    if ((a.cleanupAttempts ?? 0) >= 3) {
      const remaining = await this.#browser().getSession(a.sessionId);
      if (remaining && !remaining.endTime)
        throw new PilotError('browser_cleanup_failed');
      a.browserClosed = true;
      delete a.sessionId;
      delete a.targetId;
      await this.#save(a);
      return true;
    }
    a.cleanupAttempts = (a.cleanupAttempts ?? 0) + 1;
    await this.#save(a);
    await this.#browser().closeSession(a.sessionId);
    const remaining = await this.#browser().getSession(a.sessionId);
    if (remaining && !remaining.endTime) {
      a.phase = 'closing';
      await this.#save(a);
      return false;
    }
    a.browserClosed = true;
    delete a.sessionId;
    delete a.targetId;
    await this.#save(a);
    return true;
  }
  async status() {
    return safeState(await this.#load());
  }
  async start() {
    return this.#serial(async () => {
      if (!pilotEnabled(this.env)) throw new PilotError('not_configured');
      const old = await this.#load();
      if (old?.sessionId && !old.browserClosed) {
        if (old.expiresAt <= Date.now()) {
          await this.#close(old);
          throw new PilotError('login_expired');
        }
        return safeState(old);
      }
      if (old?.phase === 'creating' || old?.phase === 'cleanup_required')
        throw new PilotError('cleanup_required');
      const day = new Date().toISOString().slice(0, 10);
      const starts = old?.day === day ? old.starts + 1 : 1;
      if (starts > 3) throw new PilotError('daily_browser_budget');
      const a: Attempt = {
        id: crypto.randomUUID(),
        phase: 'creating',
        createdAt: Date.now(),
        expiresAt: Date.now() + PILOT_LOGIN_MS,
        day,
        starts,
        browserClosed: false,
      };
      // A durable marker/alarm precedes acquisition. An uncertain launch cannot be blindly retried.
      await this.#save(a);
      await this.ctx.storage.setAlarm(a.expiresAt);
      try {
        const created = await this.#browser().acquire({
          keepAlive: 180_000,
          recording: false,
          guardrails: {
            allowedDomains: [
              'park.io',
              'www.park.io',
              'challenges.cloudflare.com',
            ],
          },
        });
        a.sessionId = created.sessionId;
        await this.#save(a);
        const target = await this.#browser().devtools.newTarget(
          a.sessionId,
          PARKIO_ORIGIN + '/users/login',
        );
        a.targetId = target.id;
        a.phase = 'login';
        await this.#save(a);
        return safeState(a);
      } catch {
        a.error = 'browser_start_failed';
        a.phase = 'cleanup_required';
        if (a.sessionId) {
          try {
            if (await this.#close(a)) a.phase = 'blocked';
          } catch {
            /* alarm retains cleanup ownership */
          }
        }
        await this.#save(a);
        throw new PilotError(a.error);
      }
    });
  }
  async view() {
    return this.#serial(async () => {
      const a = await this.#load();
      if (!a) throw new PilotError('not_started');
      this.#assertLive(a);
      const view = await this.#browser().getLiveView(a.sessionId!, {
        mode: 'tab',
        targetId: a.targetId!,
        expiresInMs: 120_000,
      });
      const url = new URL(view.devtoolsFrontendUrl);
      if (url.origin !== 'https://live.browser.run')
        throw new PilotError('browser_unavailable');
      return url.href;
    });
  }
  async inspect() {
    return this.#serial(async () => {
      const a = await this.#load();
      if (!a) throw new PilotError('not_started');
      this.#assertLive(a);
      const observed = await withPilotPage(
        this.#browser(),
        a.sessionId!,
        a.targetId!,
        async (command) => {
          const dom = await evaluatePilot<{
            origin: string;
            path: string;
            hasPassword: boolean;
            links: string[];
            headers: string[];
          }>(
            command,
            `(() => ({origin:location.origin,path:location.pathname,hasPassword:!!document.querySelector('input[type="password"]'),links:[...document.querySelectorAll('a[href]')].filter(a=>/csv|export/i.test(a.textContent||'')).map(a=>a.href).slice(0,20),headers:[...document.querySelectorAll('table thead th')].map(h=>(h.textContent||'').trim()).filter(h=>h.length>0&&h.length<=80).slice(0,30)}))()`,
          );
          if (
            dom.origin !== PARKIO_ORIGIN ||
            !/^\/orders(?:\/|$)/.test(dom.path) ||
            dom.hasPassword
          )
            throw new PilotError('open_active_orders');
          const links = [
            ...new Set(
              dom.links.flatMap((link) => {
                try {
                  return [exportUrl(link)];
                } catch {
                  return [];
                }
              }),
            ),
          ];
          if (links.length !== 1)
            throw new PilotError('export_contract_required');
          const jar = await command<{ cookies: PilotCookie[] }>(
            'Storage.getCookies',
          );
          return {
            activeExport: links[0],
            headers: dom.headers,
            cookieNames: qualifiedCookies(jar.cookies).map((c) => c.name),
          };
        },
      );
      Object.assign(a, observed);
      a.error = undefined;
      await this.#save(a);
      return safeState(a);
    });
  }
  async capture() {
    return this.#serial(async () => {
      const a = await this.#load();
      if (!a) throw new PilotError('not_started');
      this.#assertLive(a);
      if (!a.activeExport) throw new PilotError('inspect_required');
      a.phase = 'checking';
      a.error = undefined;
      await this.#save(a);
      try {
        const captured = await withPilotPage(
          this.#browser(),
          a.sessionId!,
          a.targetId!,
          async (command) => {
            const current = await evaluatePilot<{
              origin: string;
              path: string;
            }>(command, `({origin:location.origin,path:location.pathname})`);
            if (
              current.origin !== PARKIO_ORIGIN ||
              !/^\/orders(?:\/|$)/.test(current.path)
            )
              throw new PilotError('open_active_orders');
            const download = await evaluatePilot<{
              ok: boolean;
              status: number;
              contentType: string;
              text: string;
            }>(
              command,
              `(async()=>{const r=await fetch(${JSON.stringify(exportUrl(a.activeExport!))},{credentials:'include',redirect:'manual',signal:AbortSignal.timeout(12000)});if(!r.ok||!r.body)return {ok:false,status:r.status,contentType:'',text:''};const reader=r.body.getReader();const parts=[];let size=0;try{for(;;){const v=await reader.read();if(v.done)break;size+=v.value.length;if(size>${PILOT_MAX_BYTES})throw Error('limit');parts.push(v.value)}}finally{await reader.cancel()}const all=new Uint8Array(size);let offset=0;for(const v of parts){all.set(v,offset);offset+=v.length}return {ok:r.ok,status:r.status,contentType:r.headers.get('content-type')||'',text:new TextDecoder('utf-8',{fatal:true}).decode(all)}})()`,
            );
            if (!download.ok || /text\/html/i.test(download.contentType))
              throw new PilotError('export_rejected');
            const parsed = parsePilotCsv(download.text);
            // Read cookies after the baseline fetch so response-driven rotation is included.
            const jar = await command<{ cookies: PilotCookie[] }>(
              'Storage.getCookies',
            );
            return { parsed, cookies: qualifiedCookies(jar.cookies) };
          },
        );
        this.#assertLive(a);
        a.cookies = captured.cookies;
        a.cookieNames = captured.cookies.map((c) => c.name);
        a.baseline = captured.parsed.holdings;
        a.headers = captured.parsed.headers;
        a.expiryAvailable = captured.parsed.expiryAvailable;
        a.phase = 'closing';
        a.expiresAt = Date.now() + PILOT_RETENTION_MS;
        await this.#save(a);
        // Browser cleanup is verified before allowing a post-browser HTTP test.
        await this.ctx.storage.setAlarm(Date.now() + 15_000);
        if (await this.#close(a)) a.phase = 'ready';
        await this.#save(a);
        await this.ctx.storage.setAlarm(
          a.browserClosed ? a.expiresAt : Date.now() + 15_000,
        );
        return safeState(a);
      } catch (error) {
        // Once credentials have been staged, failure to close must stay a
        // cleanup obligation; it must never extend an interactive login to 24h.
        a.phase = a.cookies ? 'closing' : 'login';
        a.error = error instanceof PilotError ? error.code : 'capture_failed';
        await this.#save(a);
        if (a.cookies) await this.ctx.storage.setAlarm(Date.now() + 15_000);
        throw new PilotError(a.error);
      }
    });
  }
  async retest() {
    return this.#serial(async () => {
      const a = await this.#load();
      if (
        !a?.cookies ||
        !a.baseline ||
        !a.activeExport ||
        !a.browserClosed ||
        !['ready', 'passed'].includes(a.phase)
      )
        throw new PilotError('close_browser_first');
      if (!pilotEnabled(this.env) || a.expiresAt <= Date.now())
        throw new PilotError('pilot_expired');
      if (
        (a.checks ?? 0) >= 3 ||
        (a.checkedAt && Date.now() - a.checkedAt < 60_000)
      )
        throw new PilotError('check_budget');
      a.checks = (a.checks ?? 0) + 1;
      a.checkedAt = Date.now();
      await this.#save(a);
      try {
        const response = await fetch(exportUrl(a.activeExport), {
          method: 'GET',
          headers: {
            Cookie: cookieHeader(a.cookies, a.activeExport),
            Accept: 'text/csv',
          },
          redirect: 'manual',
          cache: 'no-store',
          signal: AbortSignal.timeout(15_000),
        });
        const cookieRotationObserved = response.headers
          .getSetCookie()
          .some((c) => a.cookieNames?.includes(c.slice(0, c.indexOf('='))));
        const parsed = parsePilotCsv(await readBounded(response));
        a.result = {
          count: parsed.holdings.length,
          namesMatch:
            JSON.stringify(parsed.holdings.map((h) => h.domain)) ===
            JSON.stringify(a.baseline.map((h) => h.domain)),
          expiriesMatch:
            JSON.stringify(parsed.holdings) === JSON.stringify(a.baseline),
          cookieRotationObserved,
        };
        // Rotation needs a qualified persistence contract before a second use of this jar.
        a.phase =
          a.result.namesMatch &&
          a.result.expiriesMatch &&
          !cookieRotationObserved
            ? 'passed'
            : 'blocked';
        a.error = cookieRotationObserved
          ? 'rotation_contract_required'
          : a.phase === 'passed'
            ? undefined
            : 'holdings_differ';
        await this.#save(a);
        return safeState(a);
      } catch (error) {
        a.phase = 'blocked';
        a.error =
          error instanceof PilotError ? error.code : 'worker_read_failed';
        await this.#save(a);
        throw new PilotError(a.error);
      }
    });
  }
  async cancel() {
    return this.#serial(() => this.#clear());
  }
  async #clear() {
    const a = await this.#load();
    if (!a) return safeState(null);
    a.phase = 'cancelled';
    delete a.cookies;
    delete a.baseline;
    delete a.activeExport;
    await this.#save(a);
    try {
      if (!(await this.#close(a))) a.phase = 'cleanup_required';
    } catch {
      a.phase = 'cleanup_required';
    }
    await this.#save(a);
    if (a.browserClosed || !a.sessionId || (a.cleanupAttempts ?? 0) >= 3)
      await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Date.now() + 30_000);
    return safeState(a);
  }
  async alarm() {
    return this.#serial(() => this.#expire());
  }
  async #expire() {
    const a = await this.#load();
    if (!a) return;
    if (
      a.phase === 'closing' &&
      Date.now() < a.expiresAt &&
      (a.cleanupAttempts ?? 0) < 3
    ) {
      try {
        if (await this.#close(a)) {
          a.phase = 'ready';
          await this.#save(a);
          await this.ctx.storage.setAlarm(a.expiresAt);
        } else await this.ctx.storage.setAlarm(Date.now() + 30_000);
      } catch {
        await this.ctx.storage.setAlarm(Date.now() + 30_000);
      }
      return;
    }
    if (
      Date.now() >= a.expiresAt ||
      !pilotEnabled(this.env) ||
      a.phase === 'cleanup_required' ||
      (a.cleanupAttempts ?? 0) >= 3
    )
      await this.#clear();
    else await this.ctx.storage.setAlarm(a.expiresAt);
  }
}

const base = '/admin/parkio-pilot';
export function parkioPilotRoutes(
  session: (request: Request, env: HostedEnv) => Promise<SessionUser | null>,
) {
  const app = new Hono<{
    Bindings: HostedEnv;
    Variables: { owner: SessionUser };
  }>();
  app.use('*', bodyLimit({ maxSize: 2048 }));
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    if (!pilotEnabled(c.env) || !c.env.PARKIO_PILOT || !c.env.PARKIO_BROWSER)
      return c.notFound();
    const user = await session(c.req.raw, c.env);
    if (!user)
      return c.redirect('/login?next=' + encodeURIComponent(base), 303);
    if (!isAdmin(c.env, user) || user.id !== c.env.PARKIO_PILOT_OWNER_ID)
      return c.text('Forbidden', 403);
    if (!(await new Passkeys(c.env).fresh(user)))
      return c.redirect(
        '/account/reauth?next=' + encodeURIComponent(base),
        303,
      );
    if (
      c.req.method !== 'GET' &&
      c.req.header('origin') !== new URL(c.req.url).origin
    )
      return c.text('Bad origin', 403);
    c.set('owner', user);
    await next();
  });
  const stub = (env: HostedEnv, owner: SessionUser) => {
    const object = env.PARKIO_PILOT!.get(
      env.PARKIO_PILOT!.idFromName('owner/' + owner.id),
    );
    const run = async <T>(action: string): Promise<T> => {
      const response = await object.fetch(
        'https://parkio-pilot.internal/' + action,
        { method: 'POST', headers: { 'X-Pilot-Owner': owner.id } },
      );
      const value = (await response.json()) as T & { error?: string };
      if (!response.ok)
        throw new PilotError(value.error ?? 'pilot_unavailable');
      return value;
    };
    return {
      status: () => run<ReturnType<typeof safeState>>('status'),
      start: () => run('start'),
      view: () => run<string>('view'),
      inspect: () => run('inspect'),
      capture: () => run('capture'),
      retest: () => run('retest'),
      cancel: () => run('cancel'),
    };
  };
  app.onError((error, c) =>
    c.json(
      { error: error instanceof PilotError ? error.code : 'pilot_unavailable' },
      409,
    ),
  );
  app.get('/', async (c) => {
    const state = await stub(c.env, c.get('owner')).status();
    const form = (action: string, label: string, blank = false) =>
      `<form method="post" action="${base}/${action}"${blank ? ' target="_blank" rel="noreferrer"' : ''}><button type="submit">${label}</button></form>`;
    return c.html(
      page(
        'Park.io private feasibility test',
        `<section class="account"><span class="eyebrow">Owner-only pilot</span><h1>Connect Park.io</h1><p>Sign in on Park.io in a temporary hosted browser. This test checks whether saved login access works after that browser closes. No domain settings are changed.</p><p>For this first qualification, open <strong>Orders → Active</strong> after signing in. Return here to inspect the export, then save the session and close the browser.</p><p>Passwords and MFA are entered in Park.io. Session recording is off. Encrypted test state expires after 24 hours; capture is available for ten minutes.</p>${form('start', 'Open Park.io sign-in', true)}${form('view', 'Reopen current sign-in window', true)}${form('inspect', 'Inspect Active export')}${form('capture', 'Save session and close browser')}${form('retest', 'Test saved session from Worker')}${form('cancel', 'Close browser and clear test session')}<p><a href="${base}">Refresh test status</a> · <a href="/admin">Back to administration</a></p><pre style="white-space:pre-wrap;font-size:13px">${e(JSON.stringify(state, null, 2))}</pre><p class="note">This pilot reports matching counts, schema and errors. It does not import domains into your portfolio or establish permanent login or multi-account identity support.</p></section>`,
      ),
    );
  });
  for (const action of [
    'start',
    'view',
    'inspect',
    'capture',
    'retest',
    'cancel',
  ] as const) {
    app.post('/' + action, async (c) => {
      const target = stub(c.env, c.get('owner'));
      if (action === 'start') {
        await target.start();
        return c.redirect(await target.view(), 303);
      }
      if (action === 'view') return c.redirect(await target.view(), 303);
      await target[action]();
      return c.redirect(base, 303);
    });
  }
  return app;
}
