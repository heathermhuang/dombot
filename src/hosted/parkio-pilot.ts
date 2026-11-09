import type { BrowserRun } from '../../hosted/browser-run-types';
import {
  parkioMobileConnection,
  type ParkioMobileConnection,
} from '../../hosted/parkio-mobile-contract';
import {
  parkioNativeSnapshot,
  parkioOrdersPage,
  type ParkioNativeSnapshot,
} from '../../hosted/parkio-native-contract';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { isAdmin } from './admin';
import type { SessionUser } from './accounts';
import { Passkeys } from './passkeys';
import { page, escapeHtml as e } from './views';
import { parkioNativeContent } from './parkio-native-view';
import {
  callPilotFunction,
  evaluatePilot,
  withPilotPage,
} from './parkio-pilot-cdp';
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
  inspectPilotCsv,
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
  | 'rechecking'
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
  authenticationFlow?: 'native_credentials' | 'resumed_session';
  nextCheckAt?: number;
  firstCheckAt?: number;
  checkHistory?: Array<{
    number: number;
    startedAt: number;
    completedAt?: number;
    outcome: 'pending' | 'passed' | 'blocked' | 'failed' | 'unknown';
    count?: number;
    namesMatch?: boolean;
    expiriesMatch?: boolean;
    error?: string;
  }>;
  contractRequestedAt?: number;
  contractSummary?: ReturnType<typeof inspectPilotCsv> & {
    checkedAt: number;
    cookieRotationObserved: boolean;
  };
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
    authenticationFlow: a.authenticationFlow ?? 'unqualified',
    nextCheckAt: a.nextCheckAt ?? null,
    checkHistory: a.checkHistory ?? [],
    contractSummary: a.contractSummary ?? null,
    exportCompletenessQualified: false,
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
        'mobile',
        'complete',
        'proof',
        'followups',
        'contract',
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
            | 'mobile'
            | 'complete'
            | 'proof'
            | 'followups'
            | 'contract'
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
  #completion?: Promise<ReturnType<typeof safeState>>;
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
  async #session(sessionId: string) {
    try {
      return await this.#browser().getSession(sessionId);
    } catch (error) {
      // The deployed native binding throws here despite its nullable signature.
      // Only this exact provider absence response qualifies as a missing session.
      if (
        error instanceof Error &&
        error.message === 'BrowserBindingError: Session not found (status=404)'
      )
        return null;
      throw new PilotError('browser_unavailable');
    }
  }
  async #close(a: Attempt): Promise<boolean> {
    if (!a.sessionId || a.browserClosed) return true;
    const markClosed = async () => {
      a.browserClosed = true;
      delete a.sessionId;
      delete a.targetId;
      await this.#save(a);
      return true;
    };
    const existing = await this.#session(a.sessionId);
    if (!existing || existing.endTime) return markClosed();
    if ((a.cleanupAttempts ?? 0) >= 3)
      throw new PilotError('browser_cleanup_failed');
    a.cleanupAttempts = (a.cleanupAttempts ?? 0) + 1;
    await this.#save(a);
    try {
      await this.#browser().closeSession(a.sessionId);
    } catch {
      const reconciled = await this.#session(a.sessionId);
      if (!reconciled || reconciled.endTime) return markClosed();
      throw new PilotError('browser_cleanup_failed');
    }
    const remaining = await this.#session(a.sessionId);
    if (remaining && !remaining.endTime) {
      a.phase = 'closing';
      await this.#save(a);
      return false;
    }
    return markClosed();
  }
  async status() {
    return safeState(await this.#load());
  }
  async start() {
    return this.#serial(async () => {
      if (!pilotEnabled(this.env)) throw new PilotError('not_configured');
      const old = await this.#load();
      if (old?.sessionId && !old.browserClosed) {
        const current = await this.#session(old.sessionId);
        if (
          current &&
          !current.endTime &&
          old.expiresAt > Date.now() &&
          ['login', 'checking'].includes(old.phase)
        )
          return safeState(old);
        if (!(await this.#close(old))) throw new PilotError('cleanup_required');
      }
      if (
        old?.phase === 'creating' ||
        (old?.phase === 'cleanup_required' && !old.browserClosed)
      )
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
  async mobile(): Promise<ParkioMobileConnection> {
    return this.#serial(async () => {
      const a = await this.#load();
      if (!a) throw new PilotError('not_started');
      this.#assertLive(a);
      try {
        return parkioMobileConnection(
          await this.#browser().getLiveView(a.sessionId!, {
            mode: 'tab',
            targetId: a.targetId!,
            expiresInMs: 120_000,
          }),
        );
      } catch {
        throw new PilotError('browser_unavailable');
      }
    });
  }
  /** Idempotent owner proof orchestration; credentials never pass through this method. */
  async complete(): Promise<ReturnType<typeof safeState>> {
    if (this.#completion) return this.#completion;
    this.#completion = this.#finish().finally(() => {
      this.#completion = undefined;
    });
    return this.#completion;
  }
  async #finish(): Promise<ReturnType<typeof safeState>> {
    let state = await this.status();
    if (state.phase === 'passed') return state;
    if (state.phase === 'closing') {
      await this.#serial(async () => {
        const a = await this.#load();
        if (a?.phase === 'closing' && (await this.#close(a))) {
          a.phase = 'ready';
          await this.#save(a);
          await this.ctx.storage.setAlarm(a.expiresAt);
        }
      });
      state = await this.status();
    }
    if (state.phase === 'ready') return this.#initialRead();
    if (state.phase === 'closing' || state.phase === 'rechecking') return state;
    if (state.phase === 'blocked')
      throw new PilotError(
        'error' in state && state.error ? state.error : 'proof_not_ready',
      );
    await this.#prepareActive();
    await this.inspect();
    const captured = await this.capture();
    if (!captured.browserClosed) return captured;
    return this.#initialRead();
  }
  async #initialRead() {
    return this.#serial(async () => {
      const current = await this.status();
      if (current.phase === 'passed' || current.phase === 'rechecking')
        return current;
      if (current.phase === 'blocked')
        throw new PilotError(
          'error' in current && current.error
            ? current.error
            : 'proof_not_ready',
        );
      return this.#retest();
    });
  }
  async #prepareActive() {
    return this.#serial(async () => {
      const a = await this.#load();
      if (!a) throw new PilotError('not_started');
      this.#assertLive(a);
      await withPilotPage(
        this.#browser(),
        a.sessionId!,
        a.targetId!,
        async (command) => {
          for (let navigation = 0; navigation < 3; navigation++) {
            let snapshot = await evaluatePilot<ParkioNativeSnapshot>(
              command,
              parkioNativeSnapshot,
            );
            for (let n = 0; snapshot.kind === 'waiting' && n < 12; n++) {
              await new Promise((resolve) => setTimeout(resolve, 250));
              snapshot = await evaluatePilot<ParkioNativeSnapshot>(
                command,
                parkioNativeSnapshot,
              );
            }
            if (
              snapshot.origin !== PARKIO_ORIGIN ||
              snapshot.kind !== 'candidate'
            )
              throw new PilotError('authentication_required');
            if (snapshot.active) {
              a.authenticationFlow =
                snapshot.nativeAttemptId === a.id
                  ? 'native_credentials'
                  : 'resumed_session';
              await this.#save(a);
              return;
            }
            const next = snapshot.activeOrders ?? snapshot.orders;
            if (!next) throw new PilotError('active_view_required');
            let url;
            try {
              url = parkioOrdersPage(next);
            } catch {
              throw new PilotError('active_view_required');
            }
            await command('Page.navigate', { url });
            await new Promise((resolve) => setTimeout(resolve, 350));
          }
          throw new PilotError('active_view_required');
        },
      );
    });
  }
  async proof() {
    const a = await this.#load();
    if (
      !a ||
      a.phase !== 'passed' ||
      !a.browserClosed ||
      !a.result?.namesMatch ||
      !a.result.expiriesMatch ||
      a.expiresAt <= Date.now()
    )
      throw new PilotError('proof_not_ready');
    return { ...safeState(a), holdings: a.baseline ?? [] };
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
            const download = await callPilotFunction<{
              ok: boolean;
              status: number;
              contentType: string;
              text: string;
            }>(
              command,
              `async function(url, limit) {
                const r = await fetch(url, { credentials: 'include', redirect: 'manual', signal: AbortSignal.timeout(12000) });
                if (!r.ok || !r.body) return { ok: false, status: r.status, contentType: '', text: '' };
                const reader = r.body.getReader(); const parts = []; let size = 0;
                try {
                  for (;;) {
                    const part = await reader.read(); if (part.done) break;
                    size += part.value.length; if (size > limit) throw Error('limit');
                    parts.push(part.value);
                  }
                } finally { await reader.cancel(); }
                const all = new Uint8Array(size); let offset = 0;
                for (const part of parts) { all.set(part, offset); offset += part.length; }
                return { ok: r.ok, status: r.status, contentType: r.headers.get('content-type') || '', text: new TextDecoder('utf-8', {fatal: true}).decode(all) };
              }`,
              [exportUrl(a.activeExport!), PILOT_MAX_BYTES],
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
    return this.#serial(() => this.#retest());
  }
  async #retest() {
    const a = await this.#load();
    if (a?.phase === 'rechecking') throw new PilotError('check_in_progress');
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
    a.firstCheckAt ??= a.checkedAt;
    a.phase = 'rechecking';
    delete a.nextCheckAt;
    const entry: NonNullable<Attempt['checkHistory']>[number] = {
      number: a.checks,
      startedAt: a.checkedAt,
      outcome: 'pending',
    };
    a.checkHistory = [...(a.checkHistory ?? []), entry].slice(-3);
    await this.#save(a);
    // Recovery must observe this journal instead of replaying an uncertain read.
    await this.ctx.storage.setAlarm(Math.min(a.expiresAt, Date.now() + 30_000));
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
      if (a.expiresAt <= Date.now()) throw new PilotError('pilot_expired');
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
        a.result.namesMatch && a.result.expiriesMatch && !cookieRotationObserved
          ? 'passed'
          : 'blocked';
      a.error = cookieRotationObserved
        ? 'rotation_contract_required'
        : a.phase === 'passed'
          ? undefined
          : 'holdings_differ';
      Object.assign(entry, {
        completedAt: Date.now(),
        outcome: a.phase === 'passed' ? 'passed' : 'blocked',
        count: a.result.count,
        namesMatch: a.result.namesMatch,
        expiriesMatch: a.result.expiriesMatch,
        error: a.error,
      });
      await this.#schedule(a);
      return safeState(a);
    } catch (error) {
      a.phase = 'blocked';
      a.error = error instanceof PilotError ? error.code : 'worker_read_failed';
      Object.assign(entry, {
        completedAt: Date.now(),
        outcome: 'failed',
        error: a.error,
      });
      await this.#schedule(a);
      throw new PilotError(a.error);
    }
  }
  async #schedule(a: Attempt) {
    delete a.nextCheckAt;
    const gateExpiry = Date.parse(this.env.PARKIO_PILOT_EXPIRES_AT ?? '');
    if (
      a.phase === 'passed' &&
      a.authenticationFlow === 'native_credentials' &&
      (a.checks ?? 0) < 3
    ) {
      const due =
        (a.checks ?? 0) === 1
          ? (a.checkedAt ?? Date.now()) + 60_000
          : (a.firstCheckAt ?? a.checkedAt ?? Date.now()) + 23 * 3600_000;
      if (due < a.expiresAt && due < gateExpiry) a.nextCheckAt = due;
    }
    await this.#save(a);
    await this.ctx.storage.setAlarm(
      Math.min(
        a.expiresAt,
        Number.isFinite(gateExpiry) ? gateExpiry : a.expiresAt,
        a.nextCheckAt ?? a.expiresAt,
      ),
    );
  }
  async followups() {
    return this.#serial(async () => {
      const a = await this.#load();
      if (
        !a ||
        a.phase !== 'passed' ||
        !a.browserClosed ||
        !a.result?.namesMatch ||
        !a.result.expiriesMatch ||
        !pilotEnabled(this.env) ||
        a.expiresAt <= Date.now()
      )
        throw new PilotError('proof_not_ready');
      // Older completed proofs can opt into the same bounded schedule without a new login.
      a.firstCheckAt ??= a.checkedAt;
      if (!a.checkHistory?.length && a.checkedAt)
        a.checkHistory = [
          {
            number: a.checks ?? 1,
            startedAt: a.checkedAt,
            completedAt: a.checkedAt,
            outcome: 'passed',
            count: a.result.count,
            namesMatch: true,
            expiriesMatch: true,
          },
        ];
      await this.#schedule(a);
      return safeState(a);
    });
  }
  async cancel() {
    return this.#serial(() => this.#clear());
  }
  async contract() {
    return this.#serial(async () => {
      const a = await this.#load();
      if (a?.contractSummary) return a.contractSummary;
      if (a?.contractRequestedAt)
        throw new PilotError('contract_outcome_unknown');
      if (
        !a?.cookies ||
        !a.activeExport ||
        !a.browserClosed ||
        a.phase !== 'passed' ||
        !pilotEnabled(this.env) ||
        a.expiresAt <= Date.now()
      )
        throw new PilotError('proof_not_ready');
      a.contractRequestedAt = Date.now();
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
          signal: AbortSignal.timeout(15000),
        });
        const rotation = response.headers
          .getSetCookie()
          .some((c) => a.cookieNames?.includes(c.slice(0, c.indexOf('='))));
        if (rotation) {
          a.phase = 'blocked';
          a.error = 'rotation_contract_required';
          await this.#schedule(a);
        }
        a.contractSummary = {
          ...inspectPilotCsv(await readBounded(response)),
          checkedAt: Date.now(),
          cookieRotationObserved: rotation,
        };
        if (rotation) {
          a.phase = 'blocked';
          a.error = 'rotation_contract_required';
          await this.#schedule(a);
        } else await this.#save(a);
        return a.contractSummary;
      } catch (error) {
        a.phase = 'blocked';
        a.error =
          error instanceof PilotError ? error.code : 'contract_read_failed';
        await this.#schedule(a);
        throw new PilotError(a.error);
      }
    });
  }
  async #clear() {
    const a = await this.#load();
    if (!a) return safeState(null);
    a.phase = 'cancelled';
    delete a.cookies;
    delete a.baseline;
    delete a.activeExport;
    delete a.nextCheckAt;
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
    if (Date.now() >= a.expiresAt || !pilotEnabled(this.env))
      return this.#clear();
    if (a.phase === 'rechecking') {
      a.phase = 'blocked';
      a.error = 'check_outcome_unknown';
      delete a.nextCheckAt;
      const pending = a.checkHistory?.find((e) => e.outcome === 'pending');
      if (pending)
        Object.assign(pending, {
          outcome: 'unknown',
          completedAt: Date.now(),
          error: a.error,
        });
      await this.#schedule(a);
      return;
    }
    if (
      a.phase === 'passed' &&
      a.nextCheckAt !== undefined &&
      a.nextCheckAt <= Date.now()
    ) {
      try {
        await this.#retest();
      } catch {
        /* The durable failed/unknown receipt holds further scheduled checks. */
      }
      return;
    }
    if (
      a.phase === 'closing' &&
      Date.now() < a.expiresAt &&
      (a.cleanupAttempts ?? 0) < 3
    ) {
      try {
        if (await this.#close(a)) {
          a.phase = 'ready';
          await this.#save(a);
          if (a.authenticationFlow === 'native_credentials') {
            try {
              await this.#retest();
            } catch {
              /* The stored read receipt explains qualification failures. */
            }
          } else await this.ctx.storage.setAlarm(a.expiresAt);
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
      ((a.cleanupAttempts ?? 0) >= 3 && !a.browserClosed)
    )
      await this.#clear();
    else
      await this.ctx.storage.setAlarm(
        Math.min(a.expiresAt, a.nextCheckAt ?? a.expiresAt),
      );
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
    // Native POST forms need a non-null Origin for the strict CSRF check.
    c.header('Referrer-Policy', 'same-origin');
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
      start: () => run<ReturnType<typeof safeState>>('start'),
      view: () => run<string>('view'),
      mobile: () => run<ParkioMobileConnection>('mobile'),
      complete: () => run<ReturnType<typeof safeState>>('complete'),
      proof: () => run<{ holdings: PilotHolding[] }>('proof'),
      followups: () => run<ReturnType<typeof safeState>>('followups'),
      contract: () => run<ReturnType<typeof inspectPilotCsv>>('contract'),
      inspect: () => run('inspect'),
      capture: () => run('capture'),
      retest: () => run('retest'),
      cancel: () => run('cancel'),
    };
  };
  app.onError((error, c) => {
    const code = error instanceof PilotError ? error.code : 'pilot_unavailable';
    if (!c.req.header('accept')?.includes('text/html'))
      return c.json({ error: code }, 409);
    const message =
      code === 'daily_browser_budget'
        ? 'Today’s sign-in attempt limit has been reached. Please return tomorrow.'
        : code === 'cleanup_required' || code === 'browser_cleanup_failed'
          ? 'The previous sign-in browser has not finished closing. Your saved domains have not changed. Return to the test to check its status.'
          : 'We could not open the Park.io sign-in browser. Please try again. Your saved domains have not changed.';
    return c.html(
      page(
        'Park.io sign-in unavailable',
        `<section class="account"><h1>Could not open Park.io</h1><p role="alert">${message}</p><a class="button" href="${base}">Return to Park.io connection →</a></section>`,
      ),
      409,
    );
  });
  app.get('/status', async (c) =>
    c.json(await stub(c.env, c.get('owner')).status()),
  );
  app.get('/native', (c) => {
    c.header(
      'Content-Security-Policy',
      "default-src 'none';style-src 'unsafe-inline';font-src 'self';script-src 'self';connect-src 'self' wss://live.browser.run;form-action 'none';base-uri 'none';frame-ancestors 'none'",
    );
    return c.html(page('Park.io native connection proof', parkioNativeContent));
  });
  app.post('/native-open', (c) => c.redirect(base + '/native', 303));
  for (const path of [
    '/native-connection',
    '/native-complete',
    '/native-retest',
    '/native-followups',
    '/native-contract',
  ])
    app.use(path, async (c, next) => {
      if (
        c.req.method === 'POST' &&
        (!c.req.header('content-type')?.startsWith('application/json') ||
          (await c.req.text()).trim() !== '{}')
      )
        return c.json({ error: 'empty_control_payload_required' }, 400);
      await next();
    });
  app.post('/native-connection', async (c) => {
    const target = stub(c.env, c.get('owner'));
    const state = await target.start();
    return c.json({ ...(await target.mobile()), ...state });
  });
  app.post('/native-complete', async (c) =>
    c.json(await stub(c.env, c.get('owner')).complete()),
  );
  app.get('/native-proof', async (c) =>
    c.json(await stub(c.env, c.get('owner')).proof()),
  );
  app.post('/native-retest', async (c) =>
    c.json(await stub(c.env, c.get('owner')).retest()),
  );
  app.post('/native-followups', async (c) =>
    c.json(await stub(c.env, c.get('owner')).followups()),
  );
  app.post('/native-contract', async (c) =>
    c.json(await stub(c.env, c.get('owner')).contract()),
  );
  app.get('/mobile', (c) => c.redirect(base + '/sign-in', 303));
  app.get('/sign-in', (c) => {
    c.header(
      'Content-Security-Policy',
      "default-src 'none';style-src 'unsafe-inline';font-src 'self';script-src 'self';connect-src 'self' wss://live.browser.run;frame-src https://live.browser.run;form-action 'self';base-uri 'none';frame-ancestors 'none'",
    );
    return c.html(
      page(
        'Park.io sign-in',
        `<style>
      #parkio-mobile{max-width:760px;margin:8px auto 24px}#parkio-mobile h1{font-size:26px;line-height:1.2;margin:12px 0}#parkio-mobile p{font-size:14px;margin:8px 0}#parkio-mobile label{margin:12px 0 8px}#parkio-keyboard{display:block;width:100%;height:48px;min-height:48px;resize:none;border:1px solid var(--line);border-radius:7px;padding:12px;font:16px/1.4 Archivo,sans-serif;background:#fff;color:var(--ink)}#parkio-mobile[data-touch="false"] .phone-controls{display:none}#parkio-mobile .keys{display:flex;gap:8px;flex-wrap:wrap}#parkio-mobile .keys button{min-height:44px;padding:8px 12px;font-size:14px}#parkio-mobile .keys button:disabled{opacity:.55}#parkio-viewer{display:block;width:100%;height:440px;border:1px solid var(--line);border-radius:8px;margin:12px 0;background:#f2f5f1}#parkio-keyboard-status{min-height:22px}#parkio-mobile a{display:inline-flex;min-height:44px;align-items:center}@media(max-width:600px){header{padding:12px 16px}header .brand{font-size:23px}main{padding:8px 16px}#parkio-viewer{height:390px}#parkio-mobile h1{font-size:23px}}
      </style><section id="parkio-mobile"><span class="eyebrow">Temporary sign-in browser</span><h1>Sign in to Park.io</h1><p id="parkio-instructions">Sign in on Park.io below. Your input is sent directly to the temporary browser and is not saved here.</p><iframe id="parkio-viewer" title="Park.io temporary sign-in browser" sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer"></iframe><div class="phone-controls"><label for="parkio-keyboard">Phone keyboard</label><input id="parkio-keyboard" type="password" maxlength="2048" inputmode="text" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" placeholder="Tap here to type into Park.io" readonly disabled><div class="keys"><button type="button" data-remote-key="Tab" disabled>Next field</button><button type="button" data-remote-key="Backspace" disabled>Delete</button><button type="button" data-remote-key="Enter" disabled>Enter</button></div></div><p id="parkio-keyboard-status" role="status" aria-live="polite">Opening Park.io…</p><p>After signing in, open Orders → Active in Park.io.</p><a href="${base}">Return to the test →</a></section><script type="module" src="/auth/parkio-mobile.js"></script>`,
      ),
    );
  });
  app.post('/mobile-start', async (c) => {
    await stub(c.env, c.get('owner')).start();
    return c.redirect(base + '/sign-in', 303);
  });
  app.post('/mobile-connection', async (c) =>
    c.json(await stub(c.env, c.get('owner')).mobile()),
  );
  app.get('/', async (c) => {
    const state = await stub(c.env, c.get('owner')).status();
    const form = (action: string, label: string, blank = false) =>
      `<form method="post" action="${base}/${action}"${blank ? ' target="_blank" rel="noopener"' : ''}><button type="submit">${label}</button></form>`;
    return c.html(
      page(
        'Park.io private feasibility test',
        `<section class="account"><span class="eyebrow">Owner-only pilot</span><h1>Connect Park.io</h1><p>Use native username and password fields to verify a real holdings read and background refresh. No domain settings or portfolio records are changed.</p>${form('native-open', 'Sign in to Park.io')}<details><summary>Qualification diagnostics</summary><p>These manual steps are retained for unsupported verification or export contracts. Recording is off; encrypted test state expires after 24 hours.</p><a href="${base}/sign-in">Open secure provider verification →</a>${form('inspect', 'Inspect Active export')}${form('capture', 'Save session and close browser')}${form('retest', 'Test saved session from Worker')}${form('cancel', 'Close browser and clear test session')}<pre style="white-space:pre-wrap;font-size:13px">${e(JSON.stringify(state, null, 2))}</pre></details><p><a href="${base}">Refresh test status</a> · <a href="/admin">Back to administration</a></p><p class="note">This pilot does not import domains into your portfolio or establish permanent login or multi-account identity support.</p></section>`,
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
        return c.redirect(base + '/sign-in', 303);
      }
      if (action === 'view') {
        c.header('Referrer-Policy', 'no-referrer');
        return c.redirect(await target.view(), 303);
      }
      await target[action]();
      return c.redirect(base, 303);
    });
  }
  return app;
}
