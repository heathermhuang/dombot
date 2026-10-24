import { connect } from 'cloudflare:sockets';
import { Client } from 'tunnelfetch';
import {
  MAX_PROXY_RESPONSE_BYTES,
  type ProxyFetch,
} from '../core/services/proxy-transport';
import {
  PROXY_NETWORK_MS,
  PROXY_QUEUE_WAIT_MS,
} from '../shared/proxy-scheduler';
import {
  acquireProxyLease,
  scheduledProxy,
  type ProxySchedulerSettings,
} from './proxy-scheduler';

export function workerProxyPolicy(settings: ProxySchedulerSettings) {
  return (proxy: Parameters<ProxyFetch>[0]) =>
    scheduledProxy(settings, proxy)
      ? { timeout: PROXY_QUEUE_WAIT_MS + PROXY_NETWORK_MS + 5000, retries: 0 }
      : {};
}

export function createWorkerProxyFetch(
  settings: ProxySchedulerSettings,
): ProxyFetch {
  return async (proxy, url, init) => {
    if (!scheduledProxy(settings, proxy))
      return workerProxyFetch(proxy, url, init);
    const release = await acquireProxyLease(settings, init.signal);
    try {
      if (init.signal?.aborted)
        throw Object.assign(
          new Error('Queued request cancelled before sending'),
          { code: 'PROXY_QUEUE_CANCELLED' },
        );
      const selected = settings.relayUrl
        ? { ...proxy, url: settings.relayUrl }
        : proxy;
      if (settings.relayUrl && new URL(settings.relayUrl).protocol !== 'https:')
        throw Object.assign(new Error('A secure relay is required'), {
          code: 'PROXY_QUEUE_UNAVAILABLE',
        });
      return await workerProxyFetch(selected, url, {
        ...init,
        signal: AbortSignal.any([
          ...(init.signal ? [init.signal] : []),
          AbortSignal.timeout(PROXY_NETWORK_MS),
        ]),
      });
    } finally {
      // A failed release never opens another connection: the durable lease
      // remains held until its conservative expiry and cooldown.
      await release().catch(() => {});
    }
  };
}

export const workerProxyFetch: ProxyFetch = async (proxy, url, init) => {
  const sockets: ReturnType<typeof connect>[] = [];
  const client = new Client({
    connect: (address, options) => {
      const socket = connect(address, {
        ...options,
        allowHalfOpen: options?.allowHalfOpen ?? false,
      });
      sockets.push(socket);
      return socket;
    },
    proxy: proxy.url,
    trust: { mode: 'system' },
    http2: false,
    maxBodyBytes: MAX_PROXY_RESPONSE_BYTES,
    timeouts: {
      connectMs: 10000,
      handshakeMs: 15000,
      headersMs: 15000,
      idleMs: 15000,
      totalMs: 30000,
    },
  });
  // Bound the real socket lifetime even if an outer request stops waiting.
  const timer = setTimeout(() => {
    for (const socket of sockets) void socket.close().catch(() => {});
  }, PROXY_NETWORK_MS);
  try {
    const response = await client.fetch(url, { ...init, redirect: 'manual' });
    const body = await response.arrayBuffer();
    const headers = new Headers(response.headers);
    headers.delete('content-encoding');
    headers.delete('content-length');
    headers.delete('transfer-encoding');
    return new Response(
      [204, 205, 304].includes(response.status) ? null : body,
      { status: response.status, headers },
    );
  } finally {
    // A cached registrar must never retain sockets owned by an earlier Worker invocation.
    try {
      await client.close();
    } finally {
      await Promise.allSettled(sockets.map((socket) => socket.close()));
      clearTimeout(timer);
    }
  }
};
