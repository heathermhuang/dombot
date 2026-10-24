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
      !['serial', 'relay'].includes(command.route)) ||
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
  };
}

/** One durable object per outgoing proxy IP, shared by every tenant. */
export class SharedProxyQueue extends DurableObject<ProxySchedulerEnv> {
  async fetch(request: Request): Promise<Response> {
    const relay = this.env.SHARED_PROXY_MODE === 'relay';
    const concurrency = relay
      ? Math.max(
          1,
          Math.min(
            8,
            Math.floor(Number(this.env.SHARED_PROXY_CONCURRENCY) || 1),
          ),
        )
      : 1;
    if (new URL(request.url).pathname === '/status') {
      const state =
        (await this.ctx.storage.get<ProxyQueueState>('queue')) ??
        emptyProxyQueue();
      return Response.json({
        mode: relay ? 'relay' : 'serial',
        concurrency,
        active: state.active.length,
        queued: state.pending.length,
        availableAt: state.availableAt,
        nextExpiryAt: Math.min(
          ...state.active.map((grant) => grant.expiresAt),
          Number.MAX_SAFE_INTEGER,
        ),
      });
    }
    const command = commandOf(await request.json().catch(() => null));
    if (!command) return new Response('Invalid queue request', { status: 400 });
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
    if (pathname === '/status')
      return env.SHARED_PROXY_QUEUE.get(
        env.SHARED_PROXY_QUEUE.idFromName(env.SHARED_PROXY_IP),
      ).fetch('https://queue.internal/status');
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
    const queue = env.SHARED_PROXY_QUEUE.get(
      env.SHARED_PROXY_QUEUE.idFromName(env.SHARED_PROXY_IP),
    );
    return queue.fetch('https://queue.internal/lease', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    });
  },
} satisfies ExportedHandler<ProxySchedulerEnv>;
