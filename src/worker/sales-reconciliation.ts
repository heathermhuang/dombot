import { flushWrites } from '../core/storage/namespace';
import { saleOutcomeSchema } from '../shared/sales-events';
import { SalesStore } from './sales-store';
import { matchSaleEvidence } from './sales-outcome-evidence';
import { SalesError } from '../shared/sales-review';
import { recordJourney } from './sales-journey';

/** Seller reports suppress conflicting actions, but never book completed revenue.
 * Core Sales owns transactions; only an explicit evidence match links records. */
export async function reconcileSalesOutcomes(store: SalesStore): Promise<void> {
  const rows = await store.db
    .prepare(
      "SELECT id,listing_id,sealed FROM sales_events WHERE kind='outcome' AND reconciled_at IS NULL ORDER BY created_at,id LIMIT 20",
    )
    .all<{ id: string; listing_id: string; sealed: string }>();
  for (const row of rows.results) {
    const outcome = await store.open(row.sealed, saleOutcomeSchema);
    if (outcome.coreSale) {
      const listing = await store.get(row.listing_id);
      try {
        matchSaleEvidence(listing.draft.domain, outcome.coreSale);
      } catch (error) {
        if (!(error instanceof SalesError)) throw error;
        await store.db
          .prepare(
            "UPDATE sales_events SET reconciled_at=?,provenance='link-needs-review' WHERE id=? AND reconciled_at IS NULL",
          )
          .bind(Date.now(), row.id)
          .run();
        continue;
      }
      await flushWrites();
      await recordJourney(
        store.db,
        row.listing_id,
        'sale-evidence-linked',
        row.id,
      );
    }
    await store.db
      .prepare(
        'UPDATE sales_events SET reconciled_at=? WHERE id=? AND reconciled_at IS NULL',
      )
      .bind(Date.now(), row.id)
      .run();
  }
}
