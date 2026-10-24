import { describe, expect, it } from 'vitest';
import {
  advanceProxyQueue,
  emptyProxyQueue,
  PROXY_COOLDOWN_MS,
  PROXY_LEASE_MS,
  PROXY_QUEUE_WAIT_MS,
} from './proxy-scheduler';

describe('shared proxy admission', () => {
  it('drains a serial lease and removes stale direct tickets before enabling relay concurrency', () => {
    const state = emptyProxyQueue();
    advanceProxyQueue(
      state,
      { action: 'acquire', id: 'old-active', tenant: 'old' },
      0,
      () => 'old-token',
    );
    advanceProxyQueue(
      state,
      { action: 'acquire', id: 'old-waiter', tenant: 'stale' },
      0,
      () => 'unused',
    );
    const relay = { concurrency: 4, cooldownMs: 0, relayOnly: true };
    const incoming = {
      action: 'acquire' as const,
      id: 'new',
      tenant: 'new',
      route: 'relay' as const,
    };
    expect(
      advanceProxyQueue(state, incoming, 1, () => 'new-token', relay),
    ).toMatchObject({ status: 'waiting' });
    expect(state.pending.some((ticket) => ticket.id === 'old-waiter')).toBe(
      false,
    );
    advanceProxyQueue(
      state,
      {
        action: 'release',
        id: 'old-active',
        tenant: 'old',
        token: 'old-token',
      },
      100,
      () => '',
      relay,
    );
    expect(
      advanceProxyQueue(
        state,
        incoming,
        100 + PROXY_COOLDOWN_MS - 1,
        () => 'new-token',
        relay,
      ),
    ).toMatchObject({ status: 'waiting' });
    expect(
      advanceProxyQueue(
        state,
        incoming,
        100 + PROXY_COOLDOWN_MS,
        () => 'new-token',
        relay,
      ),
    ).toMatchObject({ status: 'granted' });
  });
  it('bounds concurrency when a fixed-source relay is qualified', () => {
    const state = emptyProxyQueue();
    const policy = { concurrency: 3, cooldownMs: 0 };
    const replies = Array.from({ length: 10 }, (_, i) =>
      advanceProxyQueue(
        state,
        {
          action: 'acquire',
          tenant: 'tenant-' + i,
          id: 'request-' + i,
          route: 'relay',
        },
        0,
        () => crypto.randomUUID(),
        policy,
      ),
    );
    expect(replies.filter((reply) => reply.status === 'granted')).toHaveLength(
      3,
    );
    expect(state.active).toHaveLength(3);
    const first = state.active[0];
    advanceProxyQueue(
      state,
      { ...first, action: 'release' },
      100,
      () => '',
      policy,
    );
    expect(
      advanceProxyQueue(
        state,
        {
          action: 'acquire',
          tenant: 'tenant-3',
          id: 'request-3',
          route: 'relay',
        },
        100,
        () => 'next-token',
        policy,
      ),
    ).toMatchObject({ status: 'granted' });
    expect(state.active).toHaveLength(3);
  });
  it('serializes different tenants and waits after close, not after start', () => {
    const state = emptyProxyQueue();
    const step = (tenant: string, id: string, now: number) =>
      advanceProxyQueue(
        state,
        { action: 'acquire', tenant, id },
        now,
        () => 'token-' + id,
      );
    expect(step('a', 'first', 0)).toMatchObject({ status: 'granted' });
    expect(step('b', 'second', 0)).toMatchObject({ status: 'waiting' });
    expect(step('c', 'third', 20_000)).toMatchObject({ status: 'waiting' });
    expect(
      advanceProxyQueue(
        state,
        { action: 'release', tenant: 'a', id: 'first', token: 'token-first' },
        25_000,
        () => '',
      ),
    ).toEqual({ status: 'released' });
    expect(step('b', 'second', 25_000 + PROXY_COOLDOWN_MS - 1)).toMatchObject({
      status: 'waiting',
    });
    expect(step('b', 'second', 25_000 + PROXY_COOLDOWN_MS)).toMatchObject({
      status: 'granted',
    });
    expect(step('c', 'third', 25_000 + PROXY_COOLDOWN_MS)).toMatchObject({
      status: 'waiting',
    });
  });
  it('persists active leases across restarts and fences stale releases', () => {
    let state = emptyProxyQueue();
    advanceProxyQueue(
      state,
      { action: 'acquire', tenant: 'a', id: 'first' },
      0,
      () => 'first-token',
    );
    state = JSON.parse(JSON.stringify(state));
    expect(
      advanceProxyQueue(
        state,
        { action: 'release', tenant: 'a', id: 'first', token: 'wrong' },
        1,
        () => '',
      ),
    ).toEqual({ status: 'stale' });
    expect(
      advanceProxyQueue(
        state,
        { action: 'acquire', tenant: 'b', id: 'next' },
        PROXY_LEASE_MS,
        () => 'next-token',
      ),
    ).toMatchObject({ status: 'waiting' });
    expect(
      advanceProxyQueue(
        state,
        { action: 'acquire', tenant: 'b', id: 'next' },
        PROXY_LEASE_MS + PROXY_COOLDOWN_MS,
        () => 'next-token',
      ),
    ).toMatchObject({ status: 'granted' });
    expect(
      advanceProxyQueue(
        state,
        { action: 'release', tenant: 'a', id: 'first', token: 'first-token' },
        PROXY_LEASE_MS + PROXY_COOLDOWN_MS + 1,
        () => '',
      ),
    ).toEqual({ status: 'stale' });
    expect(state.active[0]?.tenant).toBe('b');
  });
  it('deduplicates polling and rotates tenants ahead of one large portfolio', () => {
    const state = emptyProxyQueue();
    const step = (tenant: string, id: string, now = 0) =>
      advanceProxyQueue(
        state,
        { action: 'acquire', tenant, id },
        now,
        () => id,
      );
    step('a', 'first');
    step('a', 'second');
    step('a', 'third');
    step('b', 'other');
    step('a', 'second');
    step('a', 'second');
    expect(state.pending).toHaveLength(3);
    advanceProxyQueue(
      state,
      { action: 'release', tenant: 'a', id: 'first', token: 'first' },
      1,
      () => '',
    );
    expect(step('b', 'other', 1 + PROXY_COOLDOWN_MS)).toMatchObject({
      status: 'granted',
    });
  });
  it('cancels pending work, expires abandoned tickets, and bounds each tenant', () => {
    const state = emptyProxyQueue();
    const step = (tenant: string, id: string, now = 0) =>
      advanceProxyQueue(
        state,
        { action: 'acquire', tenant, id },
        now,
        () => id,
      );
    step('a', 'first');
    for (let i = 0; i < 4; i++) step('b', 'queued-' + i);
    expect(step('b', 'overflow')).toEqual({ status: 'busy' });
    advanceProxyQueue(
      state,
      { action: 'cancel', tenant: 'b', id: 'queued-1' },
      1,
      () => '',
    );
    expect(state.pending.some((t) => t.id === 'queued-1')).toBe(false);
    step('c', 'fresh', PROXY_QUEUE_WAIT_MS + 1);
    expect(state.pending.some((t) => t.tenant === 'b')).toBe(false);
    expect(state.active[0]?.tenant).toBe('c');
  });
});
