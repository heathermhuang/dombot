import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireProxyLease, scheduledProxy } from './proxy-scheduler';
import {
  advanceProxyQueue,
  emptyProxyQueue,
  type ProxyQueueCommand,
} from '../shared/proxy-scheduler';

afterEach(() => vi.useRealTimers());
const shared = {
  url: 'http://proxy-user:proxy-password@194.153.254.242:12323',
  ip: '194.153.254.242',
};

describe('tenant proxy lease client', () => {
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
