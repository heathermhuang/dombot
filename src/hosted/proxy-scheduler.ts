import { DurableObject } from 'cloudflare:workers';
import {
  advanceProxyQueue,
  emptyProxyQueue,
  type ProxyQueueCommand,
  type ProxyQueueState,
} from '../shared/proxy-scheduler';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function commandOf(value: unknown): ProxyQueueCommand | null {
  if (!value || typeof value !== 'object') return null;
  const command = value as Partial<ProxyQueueCommand>;
  if (
    !['acquire', 'release', 'cancel'].includes(command.action ?? '') ||
    typeof command.id !== 'string' ||
    !uuid.test(command.id) ||
    typeof command.tenant !== 'string' ||
    !uuid.test(command.tenant) ||
    (command.route !== undefined &&
      !['serial', 'relay', 'alternate'].includes(command.route)) ||
    (command.provider !== undefined && command.provider !== 'dynadot') ||
    (command.retryAfterMs !== undefined &&
      (!Number.isSafeInteger(command.retryAfterMs) ||
        command.retryAfterMs < 0)) ||
    (command.token !== undefined &&
      (typeof command.token !== 'string' || !uuid.test(command.token)))
  )
    return null;
  return {
    action: command.action as ProxyQueueCommand['action'],
    id: command.id,
    tenant: command.tenant,
    ...(command.token ? { token: command.token } : {}),
    ...(command.route ? { route: command.route } : {}),
    ...(command.provider ? { provider: command.provider } : {}),
    ...(command.retryAfterMs !== undefined
      ? { retryAfterMs: command.retryAfterMs }
      : {}),
  };
}

/** Primary egress gate plus a separate conservative approved-alternate gate. */
export class SharedProxyQueue extends DurableObject<ProxySchedulerEnv> {
  async fetch(request: Request): Promise<Response> {
    const alternate = new URL(request.url).pathname.startsWith('/alternate-');
    const relay = !alternate && this.env.SHARED_PROXY_MODE === 'relay';
    const concurrency = relay
      ? Math.max(
          1,
          Math.min(
            8,
            Math.floor(Number(this.env.SHARED_PROXY_CONCURRENCY) || 1),
          ),
        )
      : 1;
    if (
      ['/status', '/alternate-status'].includes(new URL(request.url).pathname)
    ) {
      const state =
        (await this.ctx.storage.get<ProxyQueueState>('queue')) ??
        emptyProxyQueue();
      return Response.json({
        mode: relay ? 'relay' : 'serial',
        concurrency,
        active: state.active.length,
        queued: state.pending.length,
        dynadotActive: state.active.filter(
          (grant) => grant.provider === 'dynadot',
        ).length,
        dynadotQueued: state.pending.filter(
          (ticket) => ticket.provider === 'dynadot',
        ).length,
        dynadotLimitedUntil: state.dynadotLimitedUntil ?? 0,
        availableAt: state.availableAt,
        nextExpiryAt: Math.min(
          ...state.active.map((grant) => grant.expiresAt),
          Number.MAX_SAFE_INTEGER,
        ),
      });
    }
    const command = commandOf(await request.json().catch(() => null));
    if (!command || (alternate && command.route !== 'alternate'))
      return new Response('Invalid queue request', { status: 400 });
    if (relay && command.action === 'acquire' && command.route !== 'relay')
      return new Response('Fixed-source relay required', { status: 409 });
    const result = await this.ctx.storage.transaction(async (storage) => {
      const state =
        (await storage.get<ProxyQueueState>('queue')) ?? emptyProxyQueue();
      const reply = advanceProxyQueue(
        state,
        command,
        Date.now(),
        () => crypto.randomUUID(),
        { concurrency, cooldownMs: relay ? 0 : 15000, relayOnly: relay },
      );
      await storage.put('queue', state);
      return reply;
    });
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  }
}

export default {
  async fetch(request: Request, env: ProxySchedulerEnv): Promise<Response> {
    // No public route or workers.dev endpoint. Only provisioned tenant service
    // bindings can reach this handler. Never accept proxy/API credentials.
    if (
      request.method !== 'POST' ||
      request.headers.get('Content-Type') !== 'application/json'
    )
      return new Response('Not found', { status: 404 });
    const pathname = new URL(request.url).pathname;
    if (pathname === '/status' || pathname === '/alternate-status')
      return env.SHARED_PROXY_QUEUE.get(
        env.SHARED_PROXY_QUEUE.idFromName(
          env.SHARED_PROXY_IP +
            (pathname === '/alternate-status' ? ':approved-alternate' : ''),
        ),
      ).fetch('https://queue.internal' + pathname);
    if (
      pathname !== '/lease' ||
      Number(request.headers.get('Content-Length') ?? 0) > 1024
    )
      return new Response('Invalid queue request', { status: 400 });
    const reader = request.body?.getReader();
    if (!reader) return new Response('Invalid queue request', { status: 400 });
    let text = '',
      size = 0;
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > 1024) {
          await reader.cancel();
          return new Response('Invalid queue request', { status: 400 });
        }
        text += decoder.decode(part.value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return new Response('Invalid queue request', { status: 400 });
    }
    const command = commandOf(value);
    if (!command) return new Response('Invalid queue request', { status: 400 });
    const dynadot = command.provider === 'dynadot';
    // An operator can briefly defer acquisitions while old route-specific
    // leases drain during rollout. Releases and cancellations remain fenced.
    const resumeAt = Number(
      Reflect.get(env, 'DYNADOT_ADMISSION_RESUME_AT') ?? 0,
    );
    if (dynadot && command.action === 'acquire' && resumeAt > Date.now())
      return Response.json({
        status: 'deferred',
        retryAfterMs: resumeAt - Date.now(),
      });
    // All Dynadot traffic shares the existing primary durable object. Route
    // classification here is admission metadata; it never changes a proxy URL.
    const alternate = !dynadot && command.route === 'alternate';
    const queue = env.SHARED_PROXY_QUEUE.get(
      env.SHARED_PROXY_QUEUE.idFromName(
        env.SHARED_PROXY_IP + (alternate ? ':approved-alternate' : ''),
      ),
    );
    const response = await queue.fetch(
      'https://queue.internal/' + (alternate ? 'alternate-lease' : 'lease'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          dynadot ? { ...command, route: 'relay' } : command,
        ),
      },
    );
    // Older alternate clients may still hold a lease issued before rollout.
    // Only the matching fenced token can release that legacy lease.
    if (
      dynadot &&
      command.route === 'alternate' &&
      command.action !== 'acquire'
    ) {
      const result = (await response.clone().json()) as { status: string };
      if (command.action === 'cancel' || result.status === 'stale') {
        const legacy = await env.SHARED_PROXY_QUEUE.get(
          env.SHARED_PROXY_QUEUE.idFromName(
            env.SHARED_PROXY_IP + ':approved-alternate',
          ),
        ).fetch('https://queue.internal/alternate-lease', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(command),
        });
        if (result.status === 'stale') return legacy;
      }
    }
    return response;
  },
} satisfies ExportedHandler<ProxySchedulerEnv>;
