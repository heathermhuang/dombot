import { Namespace } from '../storage/namespace';
import {
  dynadotRetryAfter,
  encodeDynadotRateLimit,
  inspectDynadotRateLimit,
} from '../../shared/dynadot-rate-limit';
const CAPABILITY_TTL_MS = 24 * 60 * 60_000;
interface PricingCapabilities {
  fingerprint: string;
  classicRejectedUntil?: number;
  unsupportedTlds?: Record<string, number>;
}
const pricingCapabilities = new Namespace<PricingCapabilities>(
  'dynadot-pricing-capabilities',
  { cache: true, local: true },
);
export interface DynadotPricingContext {
  accountId: string;
  apiKey: string;
  routeKey: string;
}
export async function clearDynadotPricingCapabilities(
  accountId: string,
): Promise<void> {
  if (pricingCapabilities.loaded) await pricingCapabilities.delete(accountId);
}
async function pricingRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  context?: DynadotPricingContext,
): Promise<{ fingerprint: string; classic: boolean; tld?: string } | null> {
  if (!context?.apiKey || !pricingCapabilities.loaded) return null;
  const u = new URL(input instanceof Request ? input.url : input);
  if (
    u.protocol !== 'https:' ||
    !['api.dynadot.com', 'api-sandbox.dynadot.com'].includes(u.hostname) ||
    (init?.method ?? (input instanceof Request ? input.method : 'GET')) !==
      'GET'
  )
    return null;
  const classic =
    u.pathname === '/api3.json' &&
    u.searchParams.get('command') === 'renew' &&
    u.searchParams.get('price_check') === '1' &&
    u.searchParams.get('key') === context.apiKey;
  const match = u.pathname.match(/^\/restful\/v2\/domains\/([^/]+)\/search$/);
  const headers = new Headers(
    input instanceof Request ? input.headers : undefined,
  );
  new Headers(init?.headers).forEach((v, k) => headers.set(k, v));
  const rest = Boolean(
    match &&
    u.searchParams.get('show_price') === 'true' &&
    headers.get('Authorization') === `Bearer ${context.apiKey}`,
  );
  if (!classic && !rest) return null;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      JSON.stringify([context.apiKey, context.routeKey, u.hostname]),
    ),
  );
  const fingerprint = [...new Uint8Array(digest)]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
  const name = match ? decodeURIComponent(match[1]) : '';
  return {
    fingerprint,
    classic,
    ...(rest ? { tld: name.slice(name.indexOf('.') + 1).toLowerCase() } : {}),
  };
}
function cachedCapability(
  meta: PricingCapabilities | undefined,
  request: { fingerprint: string; classic: boolean; tld?: string },
): Response | null {
  if (meta?.fingerprint !== request.fingerprint) return null;
  const until = request.classic
    ? meta.classicRejectedUntil
    : meta.unsupportedTlds?.[request.tld ?? ''];
  if (
    typeof until !== 'number' ||
    !Number.isFinite(until) ||
    until <= Date.now()
  )
    return null;
  return request.classic
    ? new Response('Cached classic pricing authentication rejection', {
        status: 401,
        headers: { 'X-DomBot-Pricing-Capability': 'cached-rejection' },
      })
    : Response.json(
        {
          code: 400,
          error: { description: "This TLD isn't supported via the API." },
        },
        {
          status: 400,
          headers: { 'X-DomBot-Pricing-Capability': 'cached-rejection' },
        },
      );
}

const SPACING_MS = 1100;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export function dynadotRetrySeconds(value: string | null): number {
  return dynadotRetryAfter(value).seconds;
}

async function pause(ms: number, signal?: AbortSignal | null): Promise<void> {
  signal?.throwIfAborted();
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const abort = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
  signal?.throwIfAborted();
}

/** Keep Dynadot's regular-account limit across all calls on this provider.
 * Buffer the bounded JSON body before releasing the lane: fetch itself resolves
 * at the headers, while Dynadot permits only one request in flight. */
export function createDynadotFetch(
  send: typeof globalThis.fetch,
  pricingContext?: DynadotPricingContext,
): typeof globalThis.fetch {
  let pending: Promise<Response> | null = null;
  let nextAt = 0;
  let limitedUntil = 0;
  return (input, init) => {
    const run = async (): Promise<Response> => {
      const signal = init?.signal;
      signal?.throwIfAborted();
      const request = await pricingRequest(input, init, pricingContext);
      if (request && pricingContext) {
        const cached = cachedCapability(
          pricingCapabilities.get(pricingContext.accountId),
          request,
        );
        if (cached) return cached;
      }
      // Let registrar-client wait outside its per-request timeout. Queued calls
      // share the cooldown without sending another request to Dynadot.
      if (limitedUntil > Date.now())
        return new Response('[dynadot:local-cooldown]', {
          status: 429,
          headers: {
            'Retry-After': String(
              Math.ceil((limitedUntil - Date.now()) / 1000),
            ),
          },
        });
      await pause(nextAt - Date.now(), signal);
      nextAt = Date.now() + SPACING_MS;
      const response = await send(input, init);
      const headers = new Headers(response.headers);
      if (response.status === 429) {
        const seconds = dynadotRetrySeconds(headers.get('Retry-After'));
        limitedUntil = Date.now() + seconds * 1000;
        // The library converts a missing header with Number(null), yielding 0.
        // Supply a positive delay, including for dates and invalid headers.
        headers.set('Retry-After', String(seconds));
      }
      const reader = response.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      if (reader) {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_RESPONSE_BYTES) {
              await reader.cancel();
              throw new Error('Dynadot response exceeds the size limit.');
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
      }
      const body = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      if (request && pricingContext) {
        let parsed:
          | {
              Response?: { Error?: unknown };
              RenewResponse?: { Error?: unknown };
              error?: { description?: unknown };
              code?: unknown;
            }
          | undefined;
        try {
          parsed = JSON.parse(new TextDecoder().decode(body)) as typeof parsed;
        } catch {
          /* no capability evidence in a non-JSON body */
        }
        const rawError =
          parsed?.Response?.Error ?? parsed?.RenewResponse?.Error;
        const rejected =
          request.classic &&
          (response.status === 401 ||
            (typeof rawError === 'string' &&
              rawError.trim().toLowerCase() === 'invalid key'));
        const unsupported =
          !request.classic &&
          request.tld &&
          (response.status === 400 || Number(parsed?.code) === 400) &&
          typeof parsed?.error?.description === 'string' &&
          /This TLD isn't supported via the API/i.test(
            parsed.error.description,
          );
        if (rejected || unsupported) {
          const prior = pricingCapabilities.get(pricingContext.accountId);
          const next: PricingCapabilities =
            prior?.fingerprint === request.fingerprint
              ? { ...prior }
              : { fingerprint: request.fingerprint };
          if (rejected)
            next.classicRejectedUntil = Date.now() + CAPABILITY_TTL_MS;
          if (unsupported && request.tld)
            next.unsupportedTlds = {
              ...next.unsupportedTlds,
              [request.tld]: Date.now() + CAPABILITY_TTL_MS,
            };
          await pricingCapabilities.set(pricingContext.accountId, next);
        }
      }
      const localCooldown =
        new TextDecoder().decode(body) === '[dynadot:shared-cooldown]';
      const safeBody =
        response.status === 429 && !localCooldown
          ? new TextEncoder().encode(
              encodeDynadotRateLimit(
                inspectDynadotRateLimit(input, response.headers, body),
              ),
            )
          : body;
      if (response.status === 429 && !localCooldown)
        headers.set('Content-Type', 'text/plain; charset=utf-8');
      headers.delete('Content-Encoding');
      headers.delete('Content-Length');
      return new Response(
        response.status === 429
          ? safeBody
          : response.body === null
            ? null
            : body,
        {
          status: response.status,
          statusText: response.statusText,
          headers,
        },
      );
    };
    const result = pending ? pending.catch(() => undefined).then(run) : run();
    pending = result;
    const clear = () => {
      if (pending === result) pending = null;
    };
    // Keep request-associated promises only while their lane is active.
    // Workers reuse this provider across separate HTTP requests.
    void result.then(clear, clear);
    return result;
  };
}
