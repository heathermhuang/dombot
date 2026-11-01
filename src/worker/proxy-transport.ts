import {
  RateLimitError,
  type RegistrarName,
} from '@aoxborrow/registrar-client';
import { dynadotRetrySeconds } from '../core/services/dynadot-transport';
import {
  dynadotPurpose,
  validDynadotInventory,
  inspectDynadotRateLimit,
  encodeDynadotRateLimit,
} from '../shared/dynadot-rate-limit';
import type {
  DynadotOutcome,
  ProxyQueueReply,
} from '../shared/proxy-scheduler';
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
  alternateProxy,
  managedProxy,
  scheduledProxy,
  type ProxySchedulerSettings,
} from './proxy-scheduler';

export function workerProxyPolicy(settings: ProxySchedulerSettings) {
  return (proxy: Parameters<ProxyFetch>[0], registrar?: RegistrarName) =>
    (registrar === 'dynadot' && Boolean(settings.tenant || settings.service)) ||
    scheduledProxy(settings, proxy)
      ? { timeout: PROXY_QUEUE_WAIT_MS + PROXY_NETWORK_MS + 5000, retries: 0 }
      : {};
}

export function createWorkerProxyFetch(
  settings: ProxySchedulerSettings,
): ProxyFetch {
  return async (proxy, url, init) => {
    const target = new URL(url);
    const dynadot = target.hostname === 'api.dynadot.com';
    const purpose = dynadotPurpose(target, init.method);
    if (
      !(dynadot && (settings.tenant || settings.service)) &&
      !scheduledProxy(settings, proxy)
    )
      return workerProxyFetch(proxy, url, init);
    const relayUrl = managedProxy(settings, proxy)
      ? settings.relayUrl
      : undefined;
    if (relayUrl && new URL(relayUrl).protocol !== 'https:')
      throw Object.assign(new Error('A secure relay is required'), {
        code: 'PROXY_QUEUE_UNAVAILABLE',
      });
    let retryAfterMs: number | undefined;
    const release = await acquireProxyLease(
      {
        ...settings,
        relayUrl,
        ...(alternateProxy(settings, proxy)
          ? { queueRoute: 'alternate' as const }
          : {}),
        ...(dynadot
          ? {
              provider: 'dynadot' as const,
              purpose,
              scope: managedProxy(settings, proxy)
                ? ('managed' as const)
                : ('unknown' as const),
            }
          : {}),
      },
      init.signal,
    ).catch((error: unknown) => {
      if (error instanceof RateLimitError) return error;
      throw error;
    });
    if (release instanceof RateLimitError)
      return new Response(
        release.message.includes('[dynadot429:')
          ? release.message
          : '[dynadot:shared-cooldown]',
        {
          status: 429,
          headers: { 'Retry-After': String(release.retryAfter ?? 60) },
        },
      );
    let response: Response | undefined;
    let failure: unknown;
    let outcome: DynadotOutcome = 'uncertain';
    let report: ProxyQueueReply | undefined;
    try {
      if (init.signal?.aborted)
        throw Object.assign(
          new Error('Queued request cancelled before sending'),
          { code: 'PROXY_QUEUE_CANCELLED' },
        );
      const selected = relayUrl ? { ...proxy, url: relayUrl } : proxy;
      response = await workerProxyFetch(selected, url, {
        ...init,
        signal: AbortSignal.any([
          ...(init.signal ? [init.signal] : []),
          AbortSignal.timeout(PROXY_NETWORK_MS),
        ]),
      });
      if (dynadot && response.status === 429)
        retryAfterMs =
          dynadotRetrySeconds(response.headers.get('Retry-After')) * 1000;
      if (dynadot) {
        const bytes = new Uint8Array(await response.clone().arrayBuffer());
        if (
          response.status === 429 &&
          inspectDynadotRateLimit(url, response.headers, bytes).reason ===
            'failed_request_ip'
        )
          outcome = 'failed_request_ip';
        else if (
          purpose === 'inventory' &&
          validDynadotInventory(response.status, bytes)
        )
          outcome = 'inventory_success';
      }
    } catch (error) {
      failure = error;
    } finally {
      // A failed release never opens another connection: the durable lease
      // remains held until its conservative expiry and cooldown.
      report = await release(retryAfterMs, dynadot ? outcome : undefined).catch(
        () => undefined,
      );
    }
    if (failure) {
      if (dynadot && report?.circuit)
        throw new RateLimitError(
          'Dynadot recovery probe outcome uncertain. ' +
            encodeDynadotRateLimit({
              reason: 'failed_request_ip',
              endpoint: 'inventory',
              format: 'empty',
              outcome: 'uncertain',
              retryAfterSeconds: Math.max(
                1,
                Math.ceil((report.circuit.notBefore - Date.now()) / 1000),
              ),
              retryAfterSource: 'fallback',
              circuit: report.circuit,
            }),
        );
      throw failure;
    }
    if (!response) throw new Error('Missing proxy response');
    response.headers.delete('X-DomBot-Dynadot-Circuit');
    if (dynadot && report?.circuit)
      response.headers.set(
        'X-DomBot-Dynadot-Circuit',
        JSON.stringify(report.circuit),
      );
    return response;
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
