import { z } from 'zod';
import {
  landerPlanSchema,
  dnsSnapshotSchema,
  hostingPlanSchema,
} from '../shared/lander-connection';
import type { SalesStore } from './sales-store';

export const landerRecoverySchema = z
  .object({
    id: z.string().max(100),
    payload: z
      .object({
        domain: z.string().max(253),
        snapshot: dnsSnapshotSchema.optional(),
        preparationHosts: z.array(hostingPlanSchema).length(2).optional(),
        plan: landerPlanSchema.optional(),
        write: z
          .object({
            index: z.number().int(),
            state: z.enum(['intent', 'verified']),
            record: z.record(z.string(), z.unknown()).nullable().optional(),
          })
          .optional(),
        restoreIndex: z.number().int().optional(),
        restoreIntent: z.number().int().optional(),
      })
      .strict(),
  })
  .strict();
export async function landerTables(db: D1Database) {
  return !!(await db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='lander_recovery_archive'",
    )
    .first());
}
export async function exportLanderRecovery(store: SalesStore) {
  if (!(await landerTables(store.db))) return [];
  const recovery: z.infer<typeof landerRecoverySchema>[] = [];
  let cursor = '';
  for (;;) {
    const rows = await store.db
      .prepare(
        "SELECT job_id||':'||ordinal AS id,sealed FROM lander_items WHERE job_id||':'||ordinal>? ORDER BY job_id||':'||ordinal LIMIT 100",
      )
      .bind(cursor)
      .all<{ id: string; sealed: string }>();
    if (!rows.results.length) break;
    for (const row of rows.results)
      recovery.push({
        id: row.id,
        payload: landerRecoverySchema.shape.payload.parse(
          JSON.parse(await store.cipher.open(row.sealed)),
        ),
      });
    cursor = rows.results.at(-1)!.id;
    if (recovery.length > 100000)
      throw Error('DNS recovery export exceeds its explicit limit.');
  }
  const archived = await store.db
    .prepare(
      'SELECT id,sealed FROM lander_recovery_archive ORDER BY id LIMIT 100001',
    )
    .all<{ id: string; sealed: string }>();
  for (const row of archived.results)
    if (!recovery.some((r) => r.id === row.id))
      recovery.push({
        id: row.id,
        payload: landerRecoverySchema.shape.payload.parse(
          JSON.parse(await store.cipher.open(row.sealed)),
        ),
      });
  if (recovery.length > 100000)
    throw Error('DNS recovery export exceeds its explicit limit.');
  return recovery;
}
