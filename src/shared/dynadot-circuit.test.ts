import { expect, it } from 'vitest';
import {
  advanceProxyQueue,
  emptyProxyQueue,
  type ProxyQueueCommand,
  seedDynadotRestriction,
} from './proxy-scheduler';

const policy = { concurrency: 4, cooldownMs: 0, relayOnly: true };
const ticket = (
  id: string,
  purpose: 'inventory' | 'pricing' = 'inventory',
): ProxyQueueCommand => ({
  action: 'acquire',
  id,
  tenant: id,
  provider: 'dynadot',
  route: 'relay',
  purpose,
  scope: 'managed',
});

it('seeds only the guarded checkpoint once and preserves recovered/newer circuit state', () => {
  const s = emptyProxyQueue();
  s.dynadotLimitedUntil = 123;
  expect(seedDynadotRestriction(s, 500, 122, 1000)).toBe('mismatch');
  expect(s.dynadotCircuit).toBeUndefined();
  expect(seedDynadotRestriction(s, 500, 123, 1000)).toBe('applied');
  const before = structuredClone(s.dynadotCircuit);
  expect(seedDynadotRestriction(s, 500, 123, 2000)).toBe('already_applied');
  expect(s.dynadotCircuit).toEqual(before);
  delete s.dynadotCircuit;
  expect(seedDynadotRestriction(s, 500, 123, 3000)).toBe('already_applied');
  expect(s.dynadotCircuit).toBeUndefined();
});
const start = () => {
  const state = emptyProxyQueue();
  const step = (c: ProxyQueueCommand, now: number) =>
    advanceProxyQueue(state, c, now, () => c.id, policy);
  step(ticket('first'), 0);
  step(
    {
      ...ticket('first'),
      action: 'release',
      token: 'first',
      outcome: 'failed_request_ip',
    },
    100,
  );
  return { state, step };
};
it('cannot use a different egress class to claim or clear a managed recovery probe', () => {
  const { state, step } = start();
  const at = state.dynadotCircuit!.notBefore;
  expect(step({ ...ticket('custom'), scope: 'unknown' }, at).status).toBe(
    'deferred',
  );
  expect(state.active).toHaveLength(0);
  expect(step(ticket('managed-alias'), at).status).toBe('granted');
  step(
    {
      ...ticket('managed-alias'),
      action: 'release',
      token: 'managed-alias',
      outcome: 'inventory_success',
    },
    at + 1,
  );
  expect(state.dynadotCircuit).toBeUndefined();
});
it('migrates the verified legacy seed without extending its deadline or budget', () => {
  const { state, step } = start();
  const at = state.dynadotCircuit!.notBefore;
  delete state.dynadotCircuit!.recoveryScope;
  state.dynadotRestrictionSeedAt = 50;
  expect(step({ ...ticket('unknown'), scope: 'unknown' }, at).status).toBe(
    'deferred',
  );
  expect(state.dynadotCircuit).toMatchObject({
    recoveryScope: 'managed',
    notBefore: at,
    probes: 0,
  });
  expect(step(ticket('managed'), at).status).toBe('granted');
});
it('does not treat unverified egress as a safe automatic recovery target', () => {
  const state = emptyProxyQueue();
  const initial = { ...ticket('custom'), scope: 'unknown' as const };
  advanceProxyQueue(state, initial, 0, () => 'custom', policy);
  advanceProxyQueue(
    state,
    {
      ...initial,
      action: 'release',
      token: 'custom',
      outcome: 'failed_request_ip',
    },
    100,
    () => '',
    policy,
  );
  expect(state.dynadotCircuit).toMatchObject({
    state: 'attention_required',
    probes: 0,
  });
  const at = state.dynadotCircuit!.notBefore;
  for (const scope of ['managed', 'unknown'] as const)
    expect(
      advanceProxyQueue(
        state,
        { ...ticket(scope), scope },
        at + 1,
        () => scope,
        policy,
      ).status,
    ).toBe('deferred');
});
it('cannot close a managed restriction from a legacy wrong-egress half-open lease', () => {
  const { state, step } = start();
  const at = state.dynadotCircuit!.notBefore;
  state.dynadotCircuit!.state = 'half_open';
  state.dynadotCircuit!.probeToken = 'legacy';
  state.active.push({
    id: 'legacy',
    tenant: 'legacy',
    token: 'legacy',
    provider: 'dynadot',
    purpose: 'inventory',
    scope: 'unknown',
    route: 'relay',
    expiresAt: at + 60000,
  });
  step(
    {
      ...ticket('legacy'),
      scope: 'unknown',
      action: 'release',
      token: 'legacy',
      outcome: 'inventory_success',
    },
    at + 1,
  );
  expect(state.dynadotCircuit).toMatchObject({ state: 'open', probes: 1 });
});
it('persists a long hold and admits exactly one inventory probe after expiry', () => {
  const { state, step } = start();
  expect(state.dynadotCircuit).toMatchObject({
    state: 'open',
    probes: 0,
    reason: 'failed_request_ip',
    scope: 'global',
  });
  const deadline = state.dynadotCircuit!.notBefore;
  expect(deadline).toBeGreaterThanOrEqual(100 + 30 * 60_000);
  expect(deadline).toBeLessThanOrEqual(100 + 33 * 60_000);
  const cold = JSON.parse(JSON.stringify(state));
  expect(
    advanceProxyQueue(cold, ticket('cold'), 101, () => 'cold', policy),
  ).toMatchObject({
    status: 'deferred',
    circuit: { reason: 'failed_request_ip' },
  });
  expect(step(ticket('price', 'pricing'), deadline).status).toBe('deferred');
  const replies = Array.from({ length: 8 }, (_, i) =>
    step(ticket('user-' + i), deadline),
  );
  expect(replies.filter((r) => r.status === 'granted')).toHaveLength(1);
  expect(state.active.filter((r) => r.provider === 'dynadot')).toHaveLength(1);
  expect(
    step(
      {
        ...ticket('user-0'),
        action: 'release',
        token: 'wrong',
        outcome: 'inventory_success',
      },
      deadline + 1,
    ).status,
  ).toBe('stale');
  expect(state.dynadotCircuit?.state).toBe('half_open');
  step(
    {
      ...ticket('user-0'),
      action: 'release',
      token: 'user-0',
      outcome: 'inventory_success',
    },
    deadline + 2,
  );
  expect(state.dynadotCircuit).toBeUndefined();
  expect(step(ticket('price', 'pricing'), deadline + 1101).status).toBe(
    'waiting',
  );
  expect(step(ticket('price', 'pricing'), deadline + 1102).status).toBe(
    'granted',
  );
});
it.each(['uncertain', 'failed_request_ip'] as const)(
  'escalates %s probes twice then exhausts without manual bypass',
  (outcome) => {
    const { state, step } = start();
    for (let i = 1; i <= 3; i++) {
      const at = state.dynadotCircuit!.notBefore;
      const id = 'probe-' + i;
      expect(step(ticket(id), at).status).toBe('granted');
      step({ ...ticket(id), action: 'release', token: id, outcome }, at + 100);
      expect(state.dynadotCircuit?.probes).toBe(i);
      if (i < 3)
        expect(state.dynadotCircuit!.notBefore).toBeGreaterThanOrEqual(
          at + 100 + (i === 1 ? 2 : 6) * 3600_000,
        );
    }
    expect(state.dynadotCircuit?.state).toBe('attention_required');
    expect(
      step(ticket('manual'), Number.MAX_SAFE_INTEGER - 100000).status,
    ).toBe('deferred');
  },
);
it('counts abandoned probes as uncertain and cannot clear from stale releases', () => {
  const { state, step } = start();
  const at = state.dynadotCircuit!.notBefore;
  step(ticket('abandoned'), at);
  expect(step(ticket('next'), at + 60_000).status).toBe('deferred');
  expect(state.dynadotCircuit?.probes).toBe(1);
  step(
    {
      ...ticket('abandoned'),
      action: 'release',
      token: 'abandoned',
      outcome: 'inventory_success',
    },
    at + 60_001,
  );
  expect(state.dynadotCircuit?.state).toBe('open');
});
it('honors longer Retry-After and blocks legacy/unknown aliases conservatively', () => {
  const { state, step } = start();
  const at = state.dynadotCircuit!.notBefore;
  step(ticket('probe'), at);
  step(
    {
      ...ticket('probe'),
      action: 'release',
      token: 'probe',
      outcome: 'failed_request_ip',
      retryAfterMs: 12 * 3600_000,
    },
    at + 1,
  );
  expect(state.dynadotCircuit!.notBefore).toBeGreaterThanOrEqual(
    at + 1 + 12 * 3600_000,
  );
  expect(
    step(
      {
        action: 'acquire',
        id: 'legacy',
        tenant: 'legacy',
        provider: 'dynadot',
        route: 'relay',
      },
      at + 2,
    ).status,
  ).toBe('deferred');
  expect(
    step(
      { action: 'acquire', id: 'other', tenant: 'other', route: 'relay' },
      at + 2,
    ).status,
  ).toBe('granted');
});
