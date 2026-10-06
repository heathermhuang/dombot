const SPACING_MS = 1100;
const RATE_LIMIT_SECONDS = 60;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function retrySeconds(value: string | null): number {
  if (value?.trim()) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
    const date = Date.parse(value);
    if (Number.isFinite(date) && date > Date.now())
      return Math.ceil((date - Date.now()) / 1000);
  }
  return RATE_LIMIT_SECONDS;
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
        return new Response(null, {
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
        const seconds = retrySeconds(headers.get('Retry-After'));
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
      headers.delete('Content-Encoding');
      headers.delete('Content-Length');
      return new Response(response.body === null ? null : body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
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
