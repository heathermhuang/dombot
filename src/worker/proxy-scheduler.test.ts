import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireProxyLease, scheduledProxy } from './proxy-scheduler';
import {
  advanceProxyQueue,
  emptyProxyQueue,
  PROXY_QUEUE_WAIT_MS,
  type ProxyQueueCommand,
} from '../shared/proxy-scheduler';

afterEach(() => vi.useRealTimers());
const shared = {
  url: 'http://proxy-user:proxy-password@194.153.254.242:12323',
  ip: '194.153.254.242',
};

describe('tenant proxy lease client', () => {
  it('queues the configured HTTPS relay independently of a caller-supplied expected IP', () => {
    const url = 'https://relay:private-token@relay.example.test:443';
    const settings = { ip: '152.42.223.194', managedUrl: url };
    expect(scheduledProxy(settings, { url, ip: settings.ip })).toBe(true);
    expect(scheduledProxy(settings, { url, ip: '194.153.254.242' })).toBe(true);
    expect(
      scheduledProxy(settings, {
        url: 'https://relay:different-token@relay.example.test',
        ip: settings.ip,
      }),
    ).toBe(false);
    expect(
      scheduledProxy(settings, {
        url: 'https://relay:private-token@customer.example.test',
        ip: settings.ip,
      }),
    ).toBe(false);
    expect(scheduledProxy({ managedUrl: url }, { url, ip: settings.ip })).toBe(
      false,
    );
  });
  it('never sends credentials or request details to the shared scheduler', async () => {
    const calls: ProxyQueueCommand[] = [];
    const service = {
      fetch: vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const command = JSON.parse(String(init?.body));
        calls.push(command);
        return Response.json(
          command.action === 'acquire'
            ? {
                status: 'granted',
                token: crypto.randomUUID(),
                expiresAt: Date.now() + 60000,
              }
            : { status: 'released' },
        );
      }),
    };
    const release = await acquireProxyLease({
      ip: shared.ip,
      tenant: crypto.randomUUID(),
      service,
    });
    await release();
    expect(calls.map((c) => c.action)).toEqual(['acquire', 'release']);
    expect(Object.keys(calls[0]).sort()).toEqual([
      'action',
      'id',
      'route',
      'tenant',
    ]);
    expect(JSON.stringify(calls)).not.toMatch(
      /proxy-user|proxy-password|api\.namecheap|ApiKey/,
    );
  });
  it('waits without opening a proxy connection and cancels an aborted ticket', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const calls: string[] = [];
    const service = {
      fetch: vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const command = JSON.parse(String(init?.body));
        calls.push(command.action);
        return Response.json({
          status: command.action === 'acquire' ? 'waiting' : 'cancelled',
          retryAfterMs: 1000,
        });
      }),
    };
    const waiting = acquireProxyLease(
      { tenant: crypto.randomUUID(), service },
      controller.signal,
    );
    const rejected = expect(waiting).rejects.toMatchObject({
      code: 'PROXY_QUEUE_CANCELLED',
    });
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    await rejected;
    expect(calls).toEqual(['acquire', 'cancel']);
  });
  it('coordinates two independent tenant clients through a persisted gate and cooldown', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100000);
    const state = emptyProxyQueue();
    const service = {
      fetch: vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
        Response.json(
          advanceProxyQueue(
            state,
            JSON.parse(String(init?.body)),
            Date.now(),
            () => crypto.randomUUID(),
          ),
        ),
      ),
    };
    const first = await acquireProxyLease({
      tenant: crypto.randomUUID(),
      service,
    });
    let admitted = false;
    const next = acquireProxyLease({
      tenant: crypto.randomUUID(),
      service,
    }).then((release) => {
      admitted = true;
      return release;
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(admitted).toBe(false);
    await first();
    await vi.advanceTimersByTimeAsync(14999);
    expect(admitted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const release = await next;
    expect(admitted).toBe(true);
    await release();
  });
  it('admits all five proxied sync reads when relay capacity is temporarily occupied', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100000);
    const state = emptyProxyQueue();
    const policy = { concurrency: 4, cooldownMs: 0, relayOnly: true };
    const blockers = Array.from({ length: 4 }, (_, i) => ({
      action: 'acquire' as const,
      tenant: 'other-' + i,
      id: 'active-' + i,
      route: 'relay' as const,
    }));
    for (const blocker of blockers)
      advanceProxyQueue(
        state,
        blocker,
        Date.now(),
        () => crypto.randomUUID(),
        policy,
      );
    const active = [...state.active];
    let busyReplies = 0,
      maxActive = 0,
      maxPending = 0;
    const service = {
      fetch: vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const command = JSON.parse(String(init?.body));
        const reply = advanceProxyQueue(
          state,
          command,
          Date.now(),
          () => crypto.randomUUID(),
          policy,
        );
        if (reply.status === 'busy') busyReplies++;
        maxActive = Math.max(maxActive, state.active.length);
        maxPending = Math.max(maxPending, state.pending.length);
        return Response.json(reply);
      }),
    };
    // The owner's full sync has four Dynadot accounts plus Namecheap. Each
    // performs one proxy read; a fifth waiting read must not become a failed
    // registrar sync merely because the first four already hold queue tickets.
    const tenant = crypto.randomUUID();
    const requests = Promise.allSettled(
      Array.from({ length: 5 }, async () => {
        const release = await acquireProxyLease({
          tenant,
          service,
          relayUrl: 'https://relay.example.test',
        });
        await release();
      }),
    );
    await vi.advanceTimersByTimeAsync(4000);
    expect(busyReplies).toBeGreaterThan(0);
    for (const blocker of active)
      advanceProxyQueue(
        state,
        { ...blocker, action: 'release' },
        Date.now(),
        () => '',
        policy,
      );
    await vi.advanceTimersByTimeAsync(15000);
    const outcomes = await requests;
    expect(outcomes.filter((r) => r.status === 'rejected')).toEqual([]);
    expect(outcomes).toHaveLength(5);
    expect(maxActive).toBeLessThanOrEqual(4);
    expect(maxPending).toBeLessThanOrEqual(4);
    expect(state.active).toEqual([]);
    expect(state.pending).toEqual([]);
  });
  it('bounds permanent saturation by the original queue deadline and a modest poll rate', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100000);
    const calls: string[] = [];
    const service = {
      fetch: vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const command = JSON.parse(String(init?.body));
        calls.push(command.action);
        return Response.json({
          status: command.action === 'acquire' ? 'busy' : 'cancelled',
        });
      }),
    };
    let finished = false;
    const result = acquireProxyLease({ tenant: crypto.randomUUID(), service });
    void result.then(
      () => {
        finished = true;
      },
      () => {
        finished = true;
      },
    );
    const rejected = expect(result).rejects.toMatchObject({
      code: 'PROXY_QUEUE_TIMEOUT',
    });
    await vi.advanceTimersByTimeAsync(PROXY_QUEUE_WAIT_MS - 1);
    expect(finished).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejected;
    expect(calls.filter((action) => action === 'acquire')).toHaveLength(24);
    expect(calls.at(-1)).toBe('cancel');
  });
  it('cancels during capacity backoff without later retrying admission', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const calls: string[] = [];
    const service = {
      fetch: vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        const command = JSON.parse(String(init?.body));
        calls.push(command.action);
        return Response.json({
          status: command.action === 'acquire' ? 'busy' : 'cancelled',
        });
      }),
    };
    const result = acquireProxyLease(
      { tenant: crypto.randomUUID(), service },
      controller.signal,
    );
    const rejected = expect(result).rejects.toMatchObject({
      code: 'PROXY_QUEUE_CANCELLED',
    });
    await vi.advanceTimersByTimeAsync(100);
    controller.abort();
    await rejected;
    await vi.advanceTimersByTimeAsync(10000);
    expect(calls).toEqual(['acquire', 'cancel']);
  });
  it('fails closed for missing or failed bindings and leaves the UK route outside this gate', async () => {
    await expect(
      acquireProxyLease({ tenant: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: 'PROXY_QUEUE_UNAVAILABLE' });
    const service = {
      fetch: vi
        .fn()
        .mockRejectedValue(new Error('private endpoint or credential detail')),
    };
    await expect(
      acquireProxyLease({ tenant: crypto.randomUUID(), service }),
    ).rejects.toMatchObject({ code: 'PROXY_QUEUE_UNAVAILABLE' });
    expect(scheduledProxy({ ip: shared.ip }, shared)).toBe(true);
    expect(
      scheduledProxy(
        { ip: shared.ip },
        { url: 'https://customer-proxy.example:8443', ip: shared.ip },
      ),
    ).toBe(false);
    expect(
      scheduledProxy(
        { ip: shared.ip },
        { url: 'http://u:p@94.116.91.250:12323', ip: '94.116.91.250' },
      ),
    ).toBe(false);
    expect(scheduledProxy({}, shared)).toBe(false);
  });
});
