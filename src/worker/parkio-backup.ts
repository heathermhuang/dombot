import { z } from 'zod';
import {
  parkioSourceSchema,
  parkioRecordSchema,
  PARKIO_MAX_RETAINED,
} from '../shared/parkio';
export const parkioBackupSchema = z
  .object({
    version: z.literal(1),
    sources: z
      .array(
        z
          .object({
            source: parkioSourceSchema,
            records: z.array(parkioRecordSchema).max(PARKIO_MAX_RETAINED),
          })
          .strict(),
      )
      .max(10),
  })
  .strict()
  .superRefine((b, c) => {
    if (
      new Set(b.sources.map((s) => s.source.id)).size !== b.sources.length ||
      new Set(b.sources.map((s) => s.source.accountId)).size !==
        b.sources.length ||
      b.sources.reduce((n, s) => n + s.records.length, 0) > PARKIO_MAX_RETAINED
    )
      c.addIssue({ code: 'custom', message: 'Invalid Park.io source limits' });
    for (const s of b.sources)
      if (
        s.source.credentialRevision !== null ||
        s.source.run !== null ||
        s.source.pending !== null ||
        s.source.connection === 'connected' ||
        s.source.count !== s.records.length ||
        new Set(s.records.map((r) => r.domain)).size !== s.records.length
      )
        c.addIssue({
          code: 'custom',
          message:
            'Park.io backup must contain complete inventory without sessions',
        });
  });
export type ParkioBackup = z.infer<typeof parkioBackupSchema>;
export async function hasParkio(db: D1Database) {
  return !!(await db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='parkio_sources'",
    )
    .first());
}
