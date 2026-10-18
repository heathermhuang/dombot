import { markSold } from '../core/services/purchases';
import { flushWrites } from '../core/storage/namespace';
import { saleOutcomeSchema } from '../shared/sales-events';
import { SalesStore } from './sales-store';

/** Suppression was already committed with the outcome. A history failure cannot reopen it. */
export async function reconcileSalesOutcomes(store: SalesStore): Promise<void> {
  const rows = await store.db
    .prepare(
      "SELECT id,listing_id,sealed FROM sales_events WHERE kind='outcome' AND reconciled_at IS NULL ORDER BY created_at,id LIMIT 20",
    )
    .all<{ id: string; listing_id: string; sealed: string }>();
  for (const row of rows.results) {
    const outcome = await store.open(row.sealed, saleOutcomeSchema);
    if (
      ['payment-reported', 'transfer-reported', 'completed'].includes(
        outcome.state,
      )
    ) {
      const listing = await store.get(row.listing_id);
      // markSold is idempotent and preserves acquisition prices and private notes.
      markSold([{ domainName: listing.draft.domain }]);
      await flushWrites();
    }
    await store.db
      .prepare(
        'UPDATE sales_events SET reconciled_at=? WHERE id=? AND reconciled_at IS NULL',
      )
      .bind(Date.now(), row.id)
      .run();
  }
}
