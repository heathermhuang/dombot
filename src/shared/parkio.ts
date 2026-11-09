import { z } from 'zod';
import { parseCsv } from './csv';
import { assertDomainName, toAscii } from './domain-name';
import { importedRow } from './imported-domains';
import type { Domain } from './ipc';

export const PARKIO_MAX_BYTES = 2 * 1024 * 1024;
export const PARKIO_MAX_ROWS = 10000;
export const PARKIO_MAX_RETAINED = 20000;
export const PARKIO_INTERVAL = 23 * 60 * 60_000;
export const PARKIO_SESSION_RETENTION = 30 * 24 * 60 * 60_000;
export class ParkioError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v + 'T00:00:00Z');
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  });
export const parkioRecordSchema = z
  .object({
    domain: z
      .string()
      .max(253)
      .refine((v) => {
        try {
          return assertDomainName(v) === v;
        } catch {
          return false;
        }
      }),
    expirationDate: day.nullable(),
    orderId: z.string().regex(/^[1-9]\d{0,18}$/),
    lastSeenAt: z.number().int().nonnegative(),
    missingSince: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type ParkioRecord = z.infer<typeof parkioRecordSchema>;
export const parkioCookieSchema = z
  .object({
    name: z.enum(['parkio_user_signin', 'flashId']),
    value: z
      .string()
      .min(1)
      .max(8192)
      .refine((v) =>
        [...v].every(
          (c) =>
            c.charCodeAt(0) > 32 &&
            c.charCodeAt(0) !== 127 &&
            c !== ';' &&
            c !== ',',
        ),
      ),
    domain: z.enum(['park.io', '.park.io']),
    path: z
      .string()
      .max(256)
      .regex(/^\/[^\r\n]*$/),
    secure: z.boolean(),
    httpOnly: z.boolean(),
    expires: z.number().finite().optional(),
    session: z.boolean().optional(),
  })
  .strict();
export type ParkioCookie = z.infer<typeof parkioCookieSchema>;
export const parkioCredentialSchema = z
  .object({
    version: z.literal(1),
    accountId: z.string().regex(/^[1-9]\d{0,18}$/),
    cookies: z.array(parkioCookieSchema).max(4),
    capturedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    exportPath: z.string().max(256),
    accountPath: z.string().max(256),
  })
  .strict();
export type ParkioCredential = z.infer<typeof parkioCredentialSchema>;
export const parkioSummarySchema = z
  .object({
    added: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    missing: z.number().int().nonnegative(),
    expiryRegressions: z.number().int().nonnegative(),
    count: z.number().int().nonnegative(),
  })
  .strict();
export type ParkioSummary = z.infer<typeof parkioSummarySchema>;
export const parkioSourceSchema = z
  .object({
    version: z.literal(1),
    id: z.string().uuid(),
    epoch: z.number().int().positive(),
    label: z.string().trim().min(1).max(80),
    accountId: z.string().regex(/^[1-9]\d{0,18}$/),
    connection: z.enum(['connected', 'reconnect_required', 'disconnected']),
    paused: z.boolean(),
    sync: z.enum(['idle', 'running', 'review_required', 'blocked']),
    generation: z.string().uuid().nullable(),
    previousGeneration: z.string().uuid().nullable(),
    credentialRevision: z.string().uuid().nullable(),
    contentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    count: z.number().int().min(0).max(PARKIO_MAX_RETAINED),
    lastSuccessfulCheckAt: z.number().int().nullable(),
    lastAttemptAt: z.number().int().nullable(),
    activationId: z.string().uuid().nullable(),
    lastContentChangedAt: z.number().int().nullable(),
    nextAttemptAt: z.number().int().nullable(),
    error: z.string().max(80).nullable(),
    run: z
      .object({ id: z.string().uuid(), expiresAt: z.number().int() })
      .strict()
      .nullable(),
    pending: z
      .object({
        generation: z.string().uuid(),
        hash: z.string().regex(/^[a-f0-9]{64}$/),
        createdAt: z.number().int(),
        summary: parkioSummarySchema,
      })
      .strict()
      .nullable(),
  })
  .strict();
export type ParkioSource = z.infer<typeof parkioSourceSchema>;
export type ParkioSourceView = Omit<
  ParkioSource,
  | 'accountId'
  | 'credentialRevision'
  | 'generation'
  | 'previousGeneration'
  | 'contentHash'
  | 'run'
> & { revision: string };
export function parkioSourceView(
  s: ParkioSource,
  revision: string,
): ParkioSourceView {
  return {
    version: s.version,
    id: s.id,
    epoch: s.epoch,
    label: s.label,
    connection: s.connection,
    paused: s.paused,
    sync: s.sync,
    count: s.count,
    lastSuccessfulCheckAt: s.lastSuccessfulCheckAt,
    lastAttemptAt: s.lastAttemptAt,
    activationId: s.activationId,
    lastContentChangedAt: s.lastContentChangedAt,
    nextAttemptAt: s.nextAttemptAt,
    error: s.error,
    pending: s.pending,
    revision,
  };
}
const headers = [
  'Order ID',
  'Domain',
  'Created Date',
  'Paid Date',
  'Amount (USD)',
  'Expiration Date',
  'On park.io',
];
/** Qualified Active-export format. No purchase or registration facts are inferred. */
export function parseParkioExport(
  text: string,
  now = Date.now(),
): ParkioRecord[] {
  if (new TextEncoder().encode(text).length > PARKIO_MAX_BYTES)
    throw new ParkioError('export_too_large');
  const clean = text.replace(/^\uFEFF/, '');
  let quoted = false,
    start = true,
    after = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"') {
        if (clean[i + 1] === '"') i++;
        else {
          quoted = false;
          after = true;
        }
      }
    } else if (c === ',' || c === '\r' || c === '\n') {
      start = true;
      after = false;
    } else if (c === '"') {
      if (!start || after) throw new ParkioError('invalid_csv');
      quoted = true;
      start = false;
    } else {
      if (after) throw new ParkioError('invalid_csv');
      start = false;
    }
  }
  if (quoted) throw new ParkioError('invalid_csv');
  const [head, ...rows] = parseCsv(clean);
  if (JSON.stringify(head?.map((s) => s.trim())) !== JSON.stringify(headers))
    throw new ParkioError('schema_changed');
  if (rows.length > PARKIO_MAX_ROWS) throw new ParkioError('too_many_rows');
  const out = new Map<string, ParkioRecord>();
  for (const row of rows) {
    if (row.length !== headers.length) throw new ParkioError('invalid_row');
    const flag = row[6].trim().toLowerCase();
    if (!['yes', 'true', '1', 'no', 'false', '0'].includes(flag))
      throw new ParkioError('unknown_holding_status');
    if (['no', 'false', '0'].includes(flag)) continue;
    if (!row[3].trim()) throw new ParkioError('unpaid_active_row');
    let domain: string;
    try {
      domain = assertDomainName(row[1].trim());
    } catch {
      throw new ParkioError('invalid_domain');
    }
    const value = parkioRecordSchema.safeParse({
      domain,
      orderId: row[0].trim(),
      expirationDate: row[5].trim() || null,
      lastSeenAt: now,
      missingSince: null,
    });
    if (!value.success) throw new ParkioError('invalid_row');
    const previous = out.get(domain);
    if (
      previous &&
      (previous.expirationDate !== value.data.expirationDate ||
        previous.orderId !== value.data.orderId)
    )
      throw new ParkioError('conflicting_duplicate');
    out.set(domain, value.data);
  }
  return [...out.values()].sort((a, b) => a.domain.localeCompare(b.domain));
}
export function mergeParkio(
  previous: ParkioRecord[],
  incoming: ParkioRecord[],
  now = Date.now(),
) {
  const next = new Map(incoming.map((r) => [r.domain, r]));
  const old = new Map(previous.map((r) => [r.domain, r]));
  let added = 0,
    updated = 0,
    missing = 0,
    expiryRegressions = 0;
  for (const r of incoming) {
    const p = old.get(r.domain);
    if (!p) added++;
    else if (
      p.expirationDate !== r.expirationDate ||
      p.orderId !== r.orderId ||
      p.missingSince !== null
    ) {
      updated++;
      if (
        p.expirationDate &&
        (!r.expirationDate || r.expirationDate < p.expirationDate)
      )
        expiryRegressions++;
    }
  }
  for (const p of previous)
    if (!next.has(p.domain)) {
      next.set(p.domain, { ...p, missingSince: p.missingSince ?? now });
      if (p.missingSince === null) missing++;
    }
  const records = [...next.values()].sort((a, b) =>
    a.domain.localeCompare(b.domain),
  );
  if (records.length > PARKIO_MAX_RETAINED)
    throw new ParkioError('inventory_limit');
  return {
    records,
    summary: {
      added,
      updated,
      missing,
      expiryRegressions,
      count: records.length,
    },
    reviewRequired: missing > 0 || expiryRegressions > 0,
  };
}
export async function parkioContentHash(records: ParkioRecord[]) {
  const values = records.map(
    ({ domain, orderId, expirationDate, missingSince }) => ({
      domain,
      orderId,
      expirationDate,
      missing: missingSince !== null,
    }),
  );
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(values)),
      ),
    ),
    (b) => b.toString(16).padStart(2, '0'),
  ).join('');
}
export function parkioRows(
  sources: { source: ParkioSource; records: ParkioRecord[] }[],
  registrarRows: Domain[],
): Domain[] {
  const held = new Set(registrarRows.map((r) => toAscii(r.domainName)));
  const seen = new Set<string>();
  const result: Domain[] = [];
  const candidates = sources
    .flatMap(({ source: s, records }) => records.map((r) => ({ s, r })))
    .sort(
      (a, b) =>
        Number(a.r.missingSince !== null) - Number(b.r.missingSince !== null) ||
        ((b.r.missingSince === null ? b.s.lastSuccessfulCheckAt : null) ??
          b.r.lastSeenAt) -
          ((a.r.missingSince === null ? a.s.lastSuccessfulCheckAt : null) ??
            a.r.lastSeenAt) ||
        a.s.id.localeCompare(b.s.id),
    );
  for (const { s, r } of candidates) {
    if (held.has(r.domain) || seen.has(r.domain)) continue;
    seen.add(r.domain);
    result.push({
      ...importedRow(r.domain, {
        registrar: null,
        registrarLabel: 'Park.io',
        expirationDate: r.expirationDate,
        autoRenew: null,
        addedAt:
          r.missingSince === null
            ? (s.lastSuccessfulCheckAt ?? r.lastSeenAt)
            : r.lastSeenAt,
        updatedAt: null,
      }),
      parkio: {
        sourceId: s.id,
        label: s.label,
        lastSuccessfulCheckAt: s.lastSuccessfulCheckAt,
        missingSince: r.missingSince,
        connection: s.connection,
        paused: s.paused,
        error: s.error,
        nextCheckAt: s.nextAttemptAt,
      },
    });
  }
  return result;
}

export type ParkioCacheStatus = Omit<
  NonNullable<Domain['parkio']>,
  'missingSince'
> & { count: number; sync: ParkioSource['sync'] };
export function parkioCacheStatus(s: ParkioSource): ParkioCacheStatus {
  return {
    sourceId: s.id,
    label: s.label,
    lastSuccessfulCheckAt: s.lastSuccessfulCheckAt,
    connection: s.connection,
    paused: s.paused,
    error: s.error,
    nextCheckAt: s.nextAttemptAt,
    count: s.count,
    sync: s.sync,
  };
}
