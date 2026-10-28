import {
  dynadotRetryAfter,
  encodeDynadotRateLimit,
  inspectDynadotRateLimit,
} from '../../shared/dynadot-rate-limit';
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
): typeof globalThis.fetch {
  let pending: Promise<Response> | null = null;
  let nextAt = 0;
  let limitedUntil = 0;
  return (input, init) => {
    const run = async (): Promise<Response> => {
      const signal = init?.signal;
      signal?.throwIfAborted();
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
