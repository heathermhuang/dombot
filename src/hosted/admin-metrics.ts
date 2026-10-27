import { z } from 'zod';
import { importedRows } from '../shared/imported-domains';
import { ownershipByDomain } from '../shared/ownership';
import { toAscii } from '../shared/domain-name';
import type {
  Domain,
  DomainEvent,
  ImportedDomain,
  RegistrarMeta,
} from '../shared/ipc';

const count = z.number().int().nonnegative();
export const operationSchema = z.object({
  at: count,
  kind: z.enum(['sync', 'request', 'scheduled']),
  status: z.enum(['ok', 'failed']),
  code: z.enum([
    'none',
    'rate_limit',
    'authentication',
    'network',
    'provider',
    'runtime',
  ]),
  durationMs: count,
});
export type Operation = z.infer<typeof operationSchema>;
export const adminSnapshotSchema = z.object({
  maintenance: z
    .object({
      policy: z.boolean(),
      paused: z.boolean(),
      dirty: z.boolean(),
      generation: count,
      observedAt: count,
      alarmAt: count.nullable(),
      inspection: z.object({
        version: z.literal(1),
        state: z.enum(['empty', 'work', 'unknown']),
        reason: z.string().max(80),
        revision: z.string().max(64).nullable(),
      }),
    })
    .optional(),
  at: count,
  owned: count,
  archived: count,
  imported: count,
  accounts: z
    .array(
      z.object({
        registrar: z.string().max(80),
        accountId: z.string().max(160).default(''),
        enabled: z.boolean(),
        domains: count,
        lastSyncedAt: count.nullable(),
        recovery: z
          .object({
            state: z.enum(['deferred', 'failed', 'recovered']),
            retryAt: count.optional(),
            attempts: count,
          })
          .optional(),
        state: z.enum(['ok', 'failed', 'stale', 'never', 'disabled']),
        code: operationSchema.shape.code,
      }),
    )
    .max(1000),
  operations: z.array(operationSchema).max(100),
});
export type AdminSnapshot = z.infer<typeof adminSnapshotSchema>;

// Persist classifications only. Provider messages can contain credentials,
// domain names, request URLs and private account labels.
export function failureCode(message: string): Operation['code'] {
  if (/429|rate.?limit|too many/i.test(message)) return 'rate_limit';
  if (
    /401|403|credential|unauthori|forbidden|api.?key|whitelist/i.test(message)
  )
    return 'authentication';
  if (
    /timeout|timed out|network|fetch|connect|proxy|socket|502|503|504/i.test(
      message,
    )
  )
    return 'network';
  return 'provider';
}

export function summarizeAdmin(
  domains: Domain[],
  imported: Record<string, ImportedDomain>,
  events: DomainEvent[],
  metadata: RegistrarMeta[],
  intervalMinutes: number,
  operations: Operation[],
  at = Date.now(),
): AdminSnapshot {
  const ownership = ownershipByDomain(events);
  const rows = [...domains, ...importedRows(imported, domains)];
  const owned = new Set(
    rows
      .filter((d) => !ownership.get(toAscii(d.domainName))?.archived)
      .map((d) => toAscii(d.domainName)),
  );
  return adminSnapshotSchema.parse({
    at,
    owned: owned.size,
    archived: [...ownership.values()].filter((o) => o.archived).length,
    imported: rows.filter(
      (d) => d.source === 'imported' && owned.has(toAscii(d.domainName)),
    ).length,
    accounts: metadata
      .filter((m) => m.configured)
      .map((m) => ({
        registrar: m.name,
        accountId: m.accountId ?? m.name,
        enabled: m.enabled,
        domains: m.sync.domainCount,
        lastSyncedAt: m.sync.lastSyncedAt,
        ...(m.sync.recovery ? { recovery: m.sync.recovery } : {}),
        state: !m.enabled
          ? 'disabled'
          : m.sync.lastError
            ? 'failed'
            : m.sync.lastSyncedAt == null
              ? 'never'
              : at - m.sync.lastSyncedAt >
                  Math.max(48 * 3600_000, intervalMinutes * 120_000)
                ? 'stale'
                : 'ok',
        code: m.sync.lastError ? failureCode(m.sync.lastError) : 'none',
      })),
    operations,
  });
}
