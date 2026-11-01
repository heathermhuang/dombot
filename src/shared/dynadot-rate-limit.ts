import { z } from 'zod';
export const dynadotCircuitSchema = z.object({
  state: z.enum(['open', 'half_open', 'attention_required']),
  reason: z.literal('failed_request_ip'),
  scope: z.literal('global'),
  probes: z.number().int().min(0).max(3),
  notBefore: z.number().int().nonnegative().safe(),
});

export const dynadotRateLimitSchema = z.object({
  reason: z.enum([
    'failed_request_ip',
    'concurrency',
    'request_rate',
    'daily_quota',
    'edge_challenge',
    'unknown',
  ]),
  circuit: dynadotCircuitSchema.optional(),
  outcome: z.enum(['failed_request_ip', 'uncertain']).optional(),
  endpoint: z.enum(['inventory', 'account', 'pricing', 'other']),
  format: z.enum(['json', 'xml', 'html', 'text', 'empty']),
  retryAfterSeconds: z.number().int().positive().safe(),
  retryAfterSource: z.enum(['seconds', 'date', 'fallback']),
  requestId: z.string().uuid().optional(),
  edgeRequestId: z
    .string()
    .regex(/^[a-f0-9]{16,32}-[A-Z0-9]{3,5}$/)
    .optional(),
});
export type DynadotRateLimit = z.infer<typeof dynadotRateLimitSchema>;
const MARKER = '[dynadot429:';

/** Reject malformed/out-of-range delays while retaining valid long cooldowns. */
export function dynadotRetryAfter(
  value: string | null,
  now = Date.now(),
): { seconds: number; source: DynadotRateLimit['retryAfterSource'] } {
  const text = value?.trim();
  if (text) {
    const number = Number(text),
      seconds = Math.ceil(number);
    if (
      Number.isSafeInteger(seconds) &&
      seconds > 0 &&
      now + seconds * 1000 <= 8_640_000_000_000_000
    )
      return { seconds, source: 'seconds' };
    const date = Date.parse(text);
    if (Number.isFinite(date) && date > now)
      return { seconds: Math.ceil((date - now) / 1000), source: 'date' };
  }
  return { seconds: 60, source: 'fallback' };
}

/** Inspect a bounded prefix in memory; persist only allowlisted categories.
 * Neither the URL, response text, arbitrary headers nor account data survive. */
export function inspectDynadotRateLimit(
  input: RequestInfo | URL,
  headers: Headers,
  bytes: Uint8Array,
): DynadotRateLimit {
  const url = new URL(
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  const text = new TextDecoder().decode(bytes.subarray(0, 8192)).trim();
  const format = !text
    ? 'empty'
    : /^[{[]/.test(text)
      ? 'json'
      : /^<(?:\?xml|Response\b)/i.test(text)
        ? 'xml'
        : /^(?:<!doctype\s+html|<html\b)/i.test(text)
          ? 'html'
          : 'text';
  let description = text;
  if (format === 'json') {
    try {
      const data = JSON.parse(text);
      description =
        typeof data?.error?.description === 'string'
          ? data.error.description
          : typeof data?.message === 'string'
            ? data.message
            : '';
    } catch {
      description = '';
    }
  }
  const reason = /daily quota|daily.{0,25}limit|quota.{0,25}tomorrow/i.test(
    description,
  )
    ? 'daily_quota'
    : /concurren|thread.{0,20}limit/i.test(description)
      ? 'concurrency'
      : format === 'html' &&
          /cloudflare|cf-chl-|challenge-platform/i.test(description)
        ? 'edge_challenge'
        : /too many failed requests.{0,80}IP address|failed.request.{0,80}(?:IP address|your IP)/i.test(
              description,
            )
          ? 'failed_request_ip'
          : /rate limit|too many requests/i.test(description)
            ? 'request_rate'
            : 'unknown';
  const retry = dynadotRetryAfter(headers.get('Retry-After'));
  const requestId = z.string().uuid().safeParse(headers.get('X-Request-ID'));
  const edgeRequestId = headers.get('CF-Ray');
  return {
    reason,
    format,
    endpoint:
      url.pathname === '/restful/v2/domains'
        ? 'inventory'
        : url.pathname === '/restful/v2/accounts/info'
          ? 'account'
          : url.pathname === '/api3.json' ||
              url.pathname.endsWith('/bulk_search') ||
              /^\/restful\/v2\/domains\/[^/]+\/search$/.test(url.pathname)
            ? 'pricing'
            : 'other',
    retryAfterSeconds: retry.seconds,
    retryAfterSource: retry.source,
    ...(requestId.success ? { requestId: requestId.data } : {}),
    ...(edgeRequestId && /^[a-f0-9]{16,32}-[A-Z0-9]{3,5}$/.test(edgeRequestId)
      ? { edgeRequestId }
      : {}),
  };
}

/** registrar-client retains a bounded response prefix in its typed 429 error. */
export function encodeDynadotRateLimit(value: DynadotRateLimit): string {
  return MARKER + JSON.stringify(dynadotRateLimitSchema.parse(value)) + ']';
}
export function readDynadotRateLimit(
  error: unknown,
): DynadotRateLimit | undefined {
  if (!(error instanceof Error)) return;
  const start = error.message.lastIndexOf(MARKER);
  if (start < 0) return;
  const encoded = error.message.slice(start + MARKER.length);
  if (!encoded.endsWith(']') || encoded.length > 900) return;
  try {
    const parsed = dynadotRateLimitSchema.safeParse(
      JSON.parse(encoded.slice(0, -1)),
    );
    return parsed.success ? parsed.data : undefined;
  } catch {
    return;
  }
}

/** Exact read purpose; callers never supply a pricing/inventory label. */
export function dynadotPurpose(
  url: URL,
  method = 'GET',
): 'inventory' | 'pricing' | 'other' {
  if (method.toUpperCase() !== 'GET') return 'other';
  if (url.pathname === '/restful/v2/domains') return 'inventory';
  if (
    /^\/restful\/v2\/domains\/(?:[^/]+\/search|bulk_search)$/.test(
      url.pathname,
    ) ||
    (url.pathname === '/api3.json' &&
      url.searchParams.get('command') === 'renew' &&
      url.searchParams.get('price_check') === '1')
  )
    return 'pricing';
  return 'other';
}
/** A transport 200 is insufficient; empty inventories must still be explicit. */
export function validDynadotInventory(
  status: number,
  bytes: Uint8Array,
): boolean {
  if (status !== 200 || bytes.byteLength > 2 * 1024 * 1024) return false;
  try {
    const data = JSON.parse(new TextDecoder().decode(bytes));
    return (
      data?.code === 200 &&
      !data.error &&
      Array.isArray(data?.data?.domain_info_list) &&
      data.data.domain_info_list.every(
        (d: { domain_name?: unknown } | null) =>
          typeof d?.domain_name === 'string' &&
          d.domain_name.length > 0 &&
          d.domain_name.length <= 253 &&
          !/\s|\//.test(d.domain_name),
      )
    );
  } catch {
    return false;
  }
}
