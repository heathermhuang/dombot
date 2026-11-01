/** Queue time is separate from the transport's unchanged 30-second deadline. */
export const PROXY_QUEUE_WAIT_MS = 120_000;
export const PROXY_NETWORK_MS = 30_000;
export const PROXY_LEASE_MS = 60_000;
export const PROXY_COOLDOWN_MS = 15_000;
export const PROXY_QUEUE_LIMIT = 64;
export const PROXY_TENANT_QUEUE_LIMIT = 4;

export type DynadotPurpose = 'inventory' | 'pricing' | 'other';
export type DynadotScope = 'managed' | 'unknown';
export type DynadotOutcome =
  'failed_request_ip' | 'inventory_success' | 'uncertain';
export interface DynadotCircuitStatus {
  state: 'open' | 'half_open' | 'attention_required';
  reason: 'failed_request_ip';
  scope: 'global';
  probes: number;
  notBefore: number;
}
interface DynadotCircuit extends DynadotCircuitStatus {
  recoveryScope?: DynadotScope;
  observedAt: number;
  probeToken?: string;
}
/** Only sanitized policy state leaves the durable queue; never the fenced token. */
export function circuitStatus(
  state: ProxyQueueState,
): DynadotCircuitStatus | undefined {
  const c = state.dynadotCircuit;
  return c
    ? {
        state: c.state,
        reason: c.reason,
        scope: c.scope,
        probes: c.probes,
        notBefore: c.notBefore,
      }
    : undefined;
}
function reopenCircuit(
  state: ProxyQueueState,
  now: number,
  retryAfterMs = 0,
  observedScope: DynadotScope = 'unknown',
): void {
  const prior = state.dynadotCircuit;
  const recoveryScope = prior?.recoveryScope ?? observedScope;
  const probes = (prior?.probes ?? 0) + (prior?.state === 'half_open' ? 1 : 0);
  const delay = [30 * 60_000, 2 * 3600_000, 6 * 3600_000][Math.min(probes, 2)];
  // Stable positive jitter, chosen only on transition and persisted with the hold.
  const jitter = 1 + ((now % 101) + 1) / 1020;
  state.dynadotCircuit = {
    state:
      probes >= 3 || recoveryScope !== 'managed'
        ? 'attention_required'
        : 'open',
    recoveryScope,
    reason: 'failed_request_ip',
    scope: 'global',
    probes,
    observedAt: now,
    notBefore: Math.max(
      prior?.notBefore ?? 0,
      now + Math.ceil(delay * jitter),
      now + retryAfterMs,
    ),
  };
}
export interface ProxyTicket {
  id: string;
  tenant: string;
  expiresAt: number;
  route: 'serial' | 'relay' | 'alternate';
  provider?: 'dynadot';
  purpose?: DynadotPurpose;
  scope?: DynadotScope;
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
  dynadotCircuit?: DynadotCircuit;
  dynadotRestrictionSeedAt?: number;
}
export type ProxyQueueCommand = {
  action: 'acquire' | 'release' | 'cancel';
  id: string;
  tenant: string;
  token?: string;
  route?: 'serial' | 'relay' | 'alternate';
  provider?: 'dynadot';
  purpose?: DynadotPurpose;
  scope?: DynadotScope;
  retryAfterMs?: number;
  outcome?: DynadotOutcome;
};
export type ProxyQueueReply =
  | {
      status: 'granted';
      token: string;
      expiresAt: number;
      circuit?: DynadotCircuitStatus;
    }
  | {
      status: 'waiting' | 'deferred';
      retryAfterMs: number;
      circuit?: DynadotCircuitStatus;
    }
  | {
      status: 'busy' | 'released' | 'cancelled' | 'stale';
      circuit?: DynadotCircuitStatus;
    };

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
  // The former global circuit did not retain the recovery target. Its one
  // operator-seeded incident was verified managed egress; other legacy origins
  // cannot safely prove IP recovery and require operator verification.
  if (state.dynadotCircuit && !state.dynadotCircuit.recoveryScope) {
    state.dynadotCircuit.recoveryScope = state.dynadotRestrictionSeedAt
      ? 'managed'
      : 'unknown';
    if (state.dynadotCircuit.recoveryScope === 'unknown')
      state.dynadotCircuit.state = 'attention_required';
  }
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
      if (state.dynadotCircuit?.probeToken === grant.token)
        reopenCircuit(state, now);
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
    const circuit = state.dynadotCircuit;
    if (released.provider === 'dynadot') {
      if (
        circuit?.state === 'half_open' &&
        circuit.probeToken === released.token
      ) {
        if (
          released.purpose === 'inventory' &&
          released.scope === 'managed' &&
          circuit.recoveryScope === 'managed' &&
          command.outcome === 'inventory_success'
        )
          delete state.dynadotCircuit;
        else reopenCircuit(state, now, command.retryAfterMs);
      } else if (command.outcome === 'failed_request_ip') {
        reopenCircuit(state, now, command.retryAfterMs, released.scope);
      }
    }
    state.availableAt =
      now +
      Math.max(
        policy.cooldownMs,
        released.route === 'serial' ? PROXY_COOLDOWN_MS : 0,
      );
    const status = circuitStatus(state);
    return { status: 'released', ...(status ? { circuit: status } : {}) };
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
  const circuit = state.dynadotCircuit;
  if (
    command.provider === 'dynadot' &&
    circuit &&
    (circuit.state !== 'open' ||
      circuit.notBefore > now ||
      command.purpose !== 'inventory' ||
      command.scope !== 'managed' ||
      circuit.recoveryScope !== 'managed')
  ) {
    state.pending = state.pending.filter((ticket) => !matches(ticket));
    return {
      status: 'deferred',
      retryAfterMs: Math.max(1000, circuit.notBefore - now),
      circuit: circuitStatus(state),
    };
  }
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
      ...(command.purpose ? { purpose: command.purpose } : {}),
      ...(command.scope ? { scope: command.scope } : {}),
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
        now >= (state.dynadotLimitedUntil ?? 0) &&
        (!state.dynadotCircuit ||
          (state.dynadotCircuit.state === 'open' &&
            now >= state.dynadotCircuit.notBefore &&
            ticket.purpose === 'inventory' &&
            ticket.scope === 'managed' &&
            state.dynadotCircuit.recoveryScope === 'managed')));
    // Rotate tenants rather than letting one portfolio occupy every turn.
    const next = state.pending.findIndex(
      (ticket) => eligible(ticket) && ticket.tenant !== state.lastTenant,
    );
    const index = next < 0 ? state.pending.findIndex(eligible) : next;
    if (index < 0) return { status: 'waiting', retryAfterMs: 1000 };
    const [ticket] = state.pending.splice(index, 1);
    const token = newToken();
    if (ticket.provider === 'dynadot' && state.dynadotCircuit) {
      state.dynadotCircuit.state = 'half_open';
      state.dynadotCircuit.probeToken = token;
    }
    state.active.push({
      ...ticket,
      token,
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

/** One incident-bound rollout seed. A mismatched checkpoint cannot alter queue state. */
export function seedDynadotRestriction(
  state: ProxyQueueState,
  observedAt: number,
  expectedLimitedUntil: number,
  now: number,
): 'applied' | 'already_applied' | 'mismatch' {
  if (state.dynadotRestrictionSeedAt === observedAt) return 'already_applied';
  if (
    !Number.isSafeInteger(observedAt) ||
    observedAt <= 0 ||
    observedAt > now ||
    (state.dynadotLimitedUntil ?? 0) !== expectedLimitedUntil ||
    state.active.some((g) => g.provider === 'dynadot') ||
    (state.dynadotRestrictionSeedAt ?? 0) > observedAt
  )
    return 'mismatch';
  if (!state.dynadotCircuit) reopenCircuit(state, now, 0, 'managed');
  state.dynadotRestrictionSeedAt = observedAt;
  return 'applied';
}
