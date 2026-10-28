import { RateLimitError } from '@aoxborrow/registrar-client';
import type { ProxyRoute } from '../shared/proxy';
import {
  PROXY_NETWORK_MS,
  PROXY_QUEUE_WAIT_MS,
  type ProxyQueueCommand,
  type ProxyQueueReply,
} from '../shared/proxy-scheduler';

export interface ProxySchedulerSettings {
  ip?: string;
  tenant?: string;
  service?: Pick<Fetcher, 'fetch'>;
  relayUrl?: string;
  managedUrl?: string;
  provider?: 'dynadot';
  alternateHost?: string;
  alternateIp?: string;
  queueRoute?: 'alternate';
}

/** A supplied custom proxy must never have its credentials silently replaced. */
export function managedProxy(
  settings: ProxySchedulerSettings,
  proxy: ProxyRoute,
): boolean {
  if (!settings.managedUrl) return false;
  try {
    const selected = new URL(proxy.url),
      managed = new URL(settings.managedUrl);
    return (
      selected.origin === managed.origin &&
      decodeURIComponent(selected.username) ===
        decodeURIComponent(managed.username) &&
      decodeURIComponent(selected.password) ===
        decodeURIComponent(managed.password)
    );
  } catch {
    return false;
  }
}

/** The host opts a previously qualified custom route into a separate serial
 * gate. Never replace a customer's proxy credentials with the managed relay. */
export function alternateProxy(
  settings: ProxySchedulerSettings,
  proxy: ProxyRoute,
): boolean {
  return Boolean(
    settings.alternateHost &&
    settings.alternateIp &&
    new URL(proxy.url).host === settings.alternateHost &&
    proxy.ip === settings.alternateIp,
  );
}

export function scheduledProxy(
  settings: ProxySchedulerSettings,
  proxy: ProxyRoute,
): boolean {
  const endpoint = new URL(proxy.url);
  return Boolean(
    settings.ip &&
    (alternateProxy(settings, proxy) ||
      managedProxy(settings, proxy) ||
      (endpoint.hostname === settings.ip && endpoint.port === '12323')),
  );
}

function failure(code: string): Error {
  return Object.assign(
    new Error(
      'The shared registrar connection is busy or unavailable. Try syncing again shortly.',
    ),
    { code },
  );
}

function pause(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(failure('PROXY_QUEUE_CANCELLED'));
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(failure('PROXY_QUEUE_CANCELLED'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** No URL, headers, body, proxy credentials or registrar credentials cross this binding. */
export async function acquireProxyLease(
  settings: ProxySchedulerSettings,
  signal?: AbortSignal | null,
): Promise<(retryAfterMs?: number) => Promise<void>> {
  if (!settings.service || !settings.tenant)
    throw failure('PROXY_QUEUE_UNAVAILABLE');
  const id = crypto.randomUUID(),
    tenant = settings.tenant;
  const deadline = Date.now() + PROXY_QUEUE_WAIT_MS;
  const call = async (
    action: ProxyQueueCommand['action'],
    token?: string,
    retryAfterMs?: number,
  ): Promise<ProxyQueueReply> => {
    const response = await settings.service!.fetch(
      'https://proxy-scheduler.internal/lease',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          id,
          tenant,
          ...(token ? { token } : {}),
          route:
            settings.queueRoute ?? (settings.relayUrl ? 'relay' : 'serial'),
          ...(settings.provider ? { provider: settings.provider } : {}),
          ...(retryAfterMs ? { retryAfterMs } : {}),
        } satisfies ProxyQueueCommand),
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) throw failure('PROXY_QUEUE_UNAVAILABLE');
    return response.json();
  };
  let granted = false;
  try {
    while (Date.now() < deadline) {
      if (signal?.aborted) throw failure('PROXY_QUEUE_CANCELLED');
      const reply = await call('acquire');
      if (reply.status === 'granted') {
        if (
          !reply.token ||
          !Number.isFinite(reply.expiresAt) ||
          reply.expiresAt - Date.now() < PROXY_NETWORK_MS + 5000
        )
          throw failure('PROXY_QUEUE_UNAVAILABLE');
        granted = true;
        return async (retryAfterMs) => {
          await call('release', reply.token, retryAfterMs);
        };
      }
      if (reply.status === 'deferred')
        throw new RateLimitError(
          'Dynadot shared connection is cooling down after an upstream rate limit.',
          Math.max(1, Math.ceil(reply.retryAfterMs / 1000)),
        );
      if (reply.status === 'busy') {
        // Capacity is temporary, not a registrar failure. A full sync can
        // have more proxy reads than this tenant's four pending tickets.
        // Wait for admission without opening a socket, widening the queue,
        // replaying a registrar operation, or resetting the original deadline.
        await pause(Math.min(5000, deadline - Date.now()), signal);
        continue;
      }
      if (reply.status !== 'waiting' || !Number.isFinite(reply.retryAfterMs))
        throw failure('PROXY_QUEUE_UNAVAILABLE');
      await pause(
        Math.min(
          15000,
          Math.max(50, reply.retryAfterMs),
          deadline - Date.now(),
        ),
        signal,
      );
    }
    throw failure('PROXY_QUEUE_TIMEOUT');
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    if (
      error instanceof Error &&
      'code' in error &&
      String(error.code).startsWith('PROXY_QUEUE_')
    )
      throw error;
    throw failure('PROXY_QUEUE_UNAVAILABLE');
  } finally {
    if (!granted) await call('cancel').catch(() => {});
  }
}
