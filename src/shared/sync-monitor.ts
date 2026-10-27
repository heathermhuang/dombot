import { z } from 'zod';

export const SYNC_RETENTION_MS = 30 * 86400_000;
export const SYNC_EVENT_LIMIT = 200;
const count = z.number().int().nonnegative().safe();
export const syncEventSchema = z.object({
  id: z.string().uuid(),
  seq: count,
  accountId: z.string().min(1).max(160),
  trigger: z.enum(['manual', 'mcp', 'scheduled']),
  startedAt: count,
  at: count,
  durationMs: count,
  ok: z.boolean(),
  lastGoodAt: count.nullable(),
  domains: count,
  route: z.enum(['managed', 'custom', 'direct']),
  code: z.enum([
    'none',
    'queue_busy',
    'queue_timeout',
    'queue_cancelled',
    'scheduler_unavailable',
    'proxy_auth',
    'proxy_connect',
    'tls',
    'timeout',
    'network',
    'rate_limit',
    'authentication',
    'response_parse',
    'provider',
    'unknown',
  ]),
  httpStatus: z.number().int().min(100).max(599).nullable(),
  engine: z
    .string()
    .regex(/^[a-zA-Z0-9.-]+$/)
    .max(60),
  source: z.string().regex(/^(?:[a-f0-9]{64}|development)$/),
});
export type SyncEvent = z.infer<typeof syncEventSchema>;
export type SyncTrigger = SyncEvent['trigger'];
export const syncDiagnosticsSchema = z
  .object({
    revision: z.string().uuid(),
    seq: count,
    prunedThrough: count,
    events: z.array(syncEventSchema).max(SYNC_EVENT_LIMIT),
  })
  .superRefine((s, ctx) => {
    let last = s.prunedThrough;
    for (const event of s.events) {
      if (event.seq !== last + 1)
        ctx.addIssue({
          code: 'custom',
          message: 'Sync diagnostics sequence gap',
        });
      last = event.seq;
    }
    if (last !== s.seq)
      ctx.addIssue({ code: 'custom', message: 'Sync diagnostics incomplete' });
  });
export type SyncDiagnostics = z.infer<typeof syncDiagnosticsSchema>;

// Classify allowlisted facts only. Never persist arbitrary messages, URLs,
// query strings, request bodies, API keys, account labels or domain names.
export function classifySyncFailure(
  error: unknown,
): Pick<SyncEvent, 'code' | 'httpStatus'> {
  const message = error instanceof Error ? error.message : String(error);
  const tag = message.match(/\[proxy:([A-Z_]+)(?::(\d{3}))?\]/);
  const status = Number(
    tag?.[2] ?? message.match(/(?:HTTP |failed with )(\d{3})\b/i)?.[1],
  );
  const httpStatus = status >= 100 && status <= 599 ? status : null;
  const codes: Record<string, SyncEvent['code']> = {
    PROXY_QUEUE_BUSY: 'queue_busy',
    PROXY_QUEUE_TIMEOUT: 'queue_timeout',
    PROXY_QUEUE_CANCELLED: 'queue_cancelled',
    PROXY_QUEUE_UNAVAILABLE: 'scheduler_unavailable',
    PROXY_AUTH_FAILED: 'proxy_auth',
    PROXY_AUTH_REQUIRED: 'proxy_auth',
    PROXY_CONNECT_REFUSED: 'proxy_connect',
    PROXY_UNREACHABLE: 'proxy_connect',
    PROXY_PROTOCOL: 'proxy_connect',
    TIMEOUT_CONNECT: 'proxy_connect',
    TIMEOUT_HANDSHAKE: 'tls',
    TLS_HANDSHAKE_FAILED: 'tls',
  };
  const code =
    tag && codes[tag[1]]
      ? codes[tag[1]]
      : httpStatus === 429 || /rate.?limit|too many/i.test(message)
        ? 'rate_limit'
        : httpStatus === 401 ||
            httpStatus === 403 ||
            /api.?key|whitelist|credential|unauthori/i.test(message)
          ? 'authentication'
          : /parse|invalid json/i.test(message)
            ? 'response_parse'
            : /tls|handshake|certificate/i.test(message)
              ? 'tls'
              : /timed? ?out|timeout/i.test(message)
                ? 'timeout'
                : /network|fetch|connect|socket/i.test(message)
                  ? 'network'
                  : httpStatus || /dynadot|registrar/i.test(message)
                    ? 'provider'
                    : 'unknown';
  return { code, httpStatus };
}
