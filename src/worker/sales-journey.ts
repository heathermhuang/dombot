import type { JourneyEvent } from '../shared/sales-journey';
/** Request/event counts only. No cookies, visitor identifiers or provider traffic
 * are collected here. Receipts deduplicate existing verification/evidence events. */
export async function recordJourney(
  db: D1Database,
  listing: string,
  event: JourneyEvent,
  receipt?: string,
) {
  if (!(await journeyReady(db))) return;
  const day = new Date().toISOString().slice(0, 10);
  const increment = db
    .prepare(
      `INSERT INTO sales_journey_daily(day,listing_id,event,count)
    SELECT ?1,?2,?3,1 WHERE ?4 IS NULL OR NOT EXISTS(SELECT 1 FROM sales_journey_receipts WHERE event=?3 AND receipt=?4)
    ON CONFLICT(day,listing_id,event) DO UPDATE SET count=count+1`,
    )
    .bind(day, listing, event, receipt ?? null);
  await db.batch([
    increment,
    ...(receipt
      ? [
          db
            .prepare(
              'INSERT OR IGNORE INTO sales_journey_receipts(event,receipt) VALUES(?,?)',
            )
            .bind(event, receipt),
        ]
      : []),
  ]);
}
export async function journeyReady(db: D1Database) {
  return !!(await db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='sales_journey_daily'",
    )
    .first());
}
