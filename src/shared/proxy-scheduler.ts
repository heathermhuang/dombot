/** Queue time is separate from the transport's unchanged 30-second deadline. */
export const PROXY_QUEUE_WAIT_MS = 120_000;
export const PROXY_NETWORK_MS = 30_000;
export const PROXY_LEASE_MS = 60_000;
export const PROXY_COOLDOWN_MS = 15_000;
export const PROXY_QUEUE_LIMIT = 64;
export const PROXY_TENANT_QUEUE_LIMIT = 4;

export interface ProxyTicket {
  id: string;
  tenant: string;
  expiresAt: number;
  route: 'serial' | 'relay' | 'alternate';
  provider?: 'dynadot';
}
export interface ProxyGrant extends ProxyTicket {
  token: string;
}
export interface ProxyQueueState {
  pending: ProxyTicket[];
  active: ProxyGrant[];
  availableAt: number;
  lastTenant: string;
  dynadotAvailableAt?: number;
  dynadotLimitedUntil?: number;
}
export type ProxyQueueCommand = {
  action: 'acquire' | 'release' | 'cancel';
  id: string;
  tenant: string;
  token?: string;
  route?: 'serial' | 'relay' | 'alternate';
  provider?: 'dynadot';
  retryAfterMs?: number;
};
export type ProxyQueueReply =
  | { status: 'granted'; token: string; expiresAt: number }
  | { status: 'waiting' | 'deferred'; retryAfterMs: number }
  | { status: 'busy' | 'released' | 'cancelled' | 'stale' };

export function emptyProxyQueue(): ProxyQueueState {
  return { pending: [], active: [], availableAt: 0, lastTenant: '' };
}

/** Pure transition, applied inside one durable storage transaction. */
export function advanceProxyQueue(
  state: ProxyQueueState,
  command: ProxyQueueCommand,
  now: number,
  newToken: () => string,
  policy: { concurrency: number; cooldownMs: number; relayOnly?: boolean } = {
    concurrency: 1,
    cooldownMs: PROXY_COOLDOWN_MS,
  },
): ProxyQueueReply {
  state.pending = state.pending.filter(
    (ticket) =>
      ticket.expiresAt > now && (!policy.relayOnly || ticket.route === 'relay'),
  );
  const expired = state.active.filter((grant) => grant.expiresAt <= now);
  if (expired.length) {
    // An abandoned lease cannot release capacity until its full lifetime and
    // a quiet period have elapsed. The client forcibly closes sockets at 30s.
    state.availableAt = Math.max(
      state.availableAt,
      ...expired.map(
        (grant) =>
          grant.expiresAt +
          Math.max(
            policy.cooldownMs,
            grant.route === 'serial' ? PROXY_COOLDOWN_MS : 0,
          ),
      ),
    );
    for (const grant of expired) {
      if (grant.provider === 'dynadot')
        state.dynadotAvailableAt = Math.max(
          state.dynadotAvailableAt ?? 0,
          grant.expiresAt + 1100,
        );
    }
    state.active = state.active.filter((grant) => grant.expiresAt > now);
  }
  const matches = (ticket: ProxyTicket) =>
    ticket.id === command.id && ticket.tenant === command.tenant;
  if (command.action === 'release') {
    const index = state.active.findIndex(
      (grant) => matches(grant) && grant.token === command.token,
    );
    if (index < 0) return { status: 'stale' };
    const [released] = state.active.splice(index, 1);
    if (released.provider === 'dynadot') {
      state.dynadotAvailableAt = Math.max(
        state.dynadotAvailableAt ?? 0,
        now + 1100,
      );
      if (
        command.retryAfterMs &&
        Number.isSafeInteger(command.retryAfterMs) &&
        command.retryAfterMs > 0
      )
        state.dynadotLimitedUntil = Math.max(
          state.dynadotLimitedUntil ?? 0,
          now + command.retryAfterMs,
        );
    }
    state.availableAt =
      now +
      Math.max(
        policy.cooldownMs,
        released.route === 'serial' ? PROXY_COOLDOWN_MS : 0,
      );
    return { status: 'released' };
  }
  if (command.action === 'cancel') {
    state.pending = state.pending.filter((ticket) => !matches(ticket));
    // Only the fenced release operation can close an active lease.
    return { status: 'cancelled' };
  }
  const existing = state.active.find(matches);
  if (existing)
    return {
      status: 'granted',
      token: existing.token,
      expiresAt: existing.expiresAt,
    };
  if (
    command.provider === 'dynadot' &&
    (state.dynadotLimitedUntil ?? 0) > now
  ) {
    state.pending = state.pending.filter((ticket) => !matches(ticket));
    return {
      status: 'deferred',
      retryAfterMs: state.dynadotLimitedUntil! - now,
    };
  }
  if (!state.pending.some(matches)) {
    if (
      state.pending.length >= PROXY_QUEUE_LIMIT ||
      state.pending.filter((ticket) => ticket.tenant === command.tenant)
        .length >= PROXY_TENANT_QUEUE_LIMIT
    )
      return { status: 'busy' };
    state.pending.push({
      id: command.id,
      tenant: command.tenant,
      expiresAt: now + PROXY_QUEUE_WAIT_MS,
      route: command.route ?? 'serial',
      ...(command.provider ? { provider: command.provider } : {}),
    });
  }
  if (
    state.active.length < policy.concurrency &&
    now >= state.availableAt &&
    !(
      policy.concurrency > 1 &&
      state.active.some((grant) => grant.route === 'serial')
    )
  ) {
    const eligible = (ticket: ProxyTicket) =>
      ticket.provider !== 'dynadot' ||
      (!state.active.some((grant) => grant.provider === 'dynadot') &&
        now >= (state.dynadotAvailableAt ?? 0) &&
        now >= (state.dynadotLimitedUntil ?? 0));
    // Rotate tenants rather than letting one portfolio occupy every turn.
    const next = state.pending.findIndex(
      (ticket) => eligible(ticket) && ticket.tenant !== state.lastTenant,
    );
    const index = next < 0 ? state.pending.findIndex(eligible) : next;
    if (index < 0) return { status: 'waiting', retryAfterMs: 1000 };
    const [ticket] = state.pending.splice(index, 1);
    state.active.push({
      ...ticket,
      token: newToken(),
      expiresAt: now + PROXY_LEASE_MS,
    });
    state.lastTenant = ticket.tenant;
  }
  const granted = state.active.find(matches);
  return granted
    ? {
        status: 'granted',
        token: granted.token,
        expiresAt: granted.expiresAt,
      }
    : {
        status: 'waiting',
        retryAfterMs:
          state.active.length >= policy.concurrency
            ? 1000
            : Math.max(50, Math.min(15000, state.availableAt - now)),
      };
}
