import { z } from 'zod';
import { saleModeSchema } from '../shared/sales';
import { SalesError } from '../shared/sales-review';
import { sourcePriceFingerprint } from '../core/publication/sales';
import { SalesStore, type SaleObservation } from './sales-store';
import type { SaleDraft } from '../shared/sales';

export const bulkActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('mode'), mode: saleModeSchema }).strict(),
  z
    .object({
      kind: z.literal('destination'),
      destinationId: z.string().uuid().nullable(),
    })
    .strict(),
  z.object({ kind: z.literal('portfolio-price') }).strict(),
  z.object({ kind: z.literal('shop'), include: z.boolean() }).strict(),
  z.object({ kind: z.literal('pause') }).strict(),
  z
    .object({
      kind: z.literal('publish'),
      reviewIds: z.array(z.string().uuid()).min(1).max(200),
    })
    .strict(),
]);
const jobSchema = z
  .object({ action: bulkActionSchema, requestKey: z.string().uuid() })
  .strict();
export class SalesJobs {
  constructor(readonly store: SalesStore) {}
  async publicationItems(id: string) {
    const row = await this.store.db
      .prepare('SELECT sealed FROM sales_jobs WHERE id=?')
      .bind(id)
      .first<{ sealed: string }>();
    if (!row) throw new SalesError('MISSING', 'Bulk job not found.', 404);
    const { action } = await this.store.open(row.sealed, jobSchema);
    return action.kind === 'publish'
      ? (
          await Promise.all(action.reviewIds.map((id) => this.store.review(id)))
        ).flatMap((r) => r.items)
      : [];
  }
  async review(id: string) {
    const row = await this.store.db
      .prepare('SELECT sealed,digest,status FROM sales_jobs WHERE id=?')
      .bind(id)
      .first<{ sealed: string; digest: string; status: string }>();
    if (!row) throw new SalesError('MISSING', 'Bulk review not found.', 404);
    const { action } = await this.store.open(row.sealed, jobSchema);
    if (action.kind !== 'publish')
      throw new SalesError(
        'NOT_PUBLICATION',
        'This job does not publish content.',
      );
    const reviews = await Promise.all(
      action.reviewIds.map((id) => this.store.review(id)),
    );
    return {
      version: 1 as const,
      id,
      digest: row.digest,
      status: row.status,
      shopRevision: reviews[0].shopRevision,
      expiresAt: Math.min(...reviews.map((r) => r.expiresAt)),
      items: reviews.flatMap((r) => r.items),
    };
  }
  async approve(id: string, digest: string): Promise<void> {
    const row = await this.store.db
      .prepare('SELECT digest,status FROM sales_jobs WHERE id=?')
      .bind(id)
      .first<{ digest: string; status: string }>();
    if (!row || row.digest !== digest)
      throw new SalesError(
        'MANIFEST_CHANGED',
        'The exact job manifest changed. Review again.',
        409,
      );
    if (row.status === 'pending' || row.status === 'finished') return;
    const review = await this.review(id);
    if (review.expiresAt <= Date.now())
      throw new SalesError(
        'REVIEW_EXPIRED',
        'This review expired. Create a fresh review from the remaining listings.',
        409,
      );
    if (
      !(await this.store.db
        .prepare(
          "UPDATE sales_jobs SET status='pending',updated_at=? WHERE id=? AND digest=? AND status='awaiting-review' RETURNING id",
        )
        .bind(Date.now(), id, digest)
        .first())
    )
      throw new SalesError('MANIFEST_CHANGED', 'Review this job again.', 409);
  }
  async create(
    items: { id: string; revision: string }[],
    action: z.infer<typeof bulkActionSchema>,
    requestKey: string,
  ) {
    if (
      !items.length ||
      items.length > 500 ||
      new Set(items.map((i) => i.id)).size !== items.length
    )
      throw new SalesError(
        'SELECTION_INVALID',
        'The controlled release supports 1–500 distinct reviewed items per job.',
      );
    const digest = await this.store.hash(
      'bulk-job',
      JSON.stringify([items, action]),
    );
    let shopRevision: string | null = null;
    let orderedItems = items;
    if (action.kind === 'publish') {
      const reviews = await Promise.all(
        action.reviewIds.map((id) => this.store.review(id)),
      );
      const reviewed = reviews.flatMap((r) => r.items);
      orderedItems = reviewed.map((r) => ({ id: r.id, revision: r.revision }));
      shopRevision = reviews[0].shopRevision;
      if (reviews.some((r) => r.shopRevision !== shopRevision))
        throw new SalesError(
          'SHOP_CHANGED',
          'Review all publication batches against the same shop revision.',
          409,
        );
      if (
        reviewed.length !== items.length ||
        items.some(
          (i) =>
            !reviewed.some((r) => r.id === i.id && r.revision === i.revision),
        )
      )
        throw new SalesError(
          'MANIFEST_MISMATCH',
          'The exact selected items must match the reviewed publication manifests.',
          409,
        );
    }
    const id = requestKey;
    const existing = await this.store.db
      .prepare('SELECT digest FROM sales_jobs WHERE id=?')
      .bind(id)
      .first<{ digest: string }>();
    if (existing) {
      if (existing.digest !== digest)
        throw new SalesError(
          'REQUEST_CHANGED',
          'This job key was used for different content.',
          409,
        );
      return { id };
    }
    await this.store.db.batch([
      this.store.db
        .prepare(
          'INSERT INTO sales_jobs(id,digest,sealed,status,updated_at,shop_revision) VALUES(?,?,?,?,?,?)',
        )
        .bind(
          id,
          digest,
          await this.store.seal(jobSchema.parse({ action, requestKey })),
          action.kind === 'publish' ? 'awaiting-review' : 'pending',
          Date.now(),
          shopRevision,
        ),
      ...orderedItems.map((i, ordinal) =>
        this.store.db
          .prepare(
            'INSERT INTO sales_job_items(job_id,ordinal,listing_id,expected_revision) VALUES(?,?,?,?)',
          )
          .bind(id, ordinal, i.id, i.revision),
      ),
    ]);
    return { id };
  }
  async step(id: string, observe: (d: SaleDraft) => SaleObservation) {
    const job = await this.store.db
      .prepare('SELECT sealed,status FROM sales_jobs WHERE id=?')
      .bind(id)
      .first<{ sealed: string; status: string }>();
    if (!job) throw new SalesError('MISSING', 'Bulk job not found.', 404);
    if (job.status === 'awaiting-review')
      throw new SalesError(
        'REVIEW_REQUIRED',
        'Review and approve the exact publication manifest first.',
        409,
      );
    const { action } = await this.store.open(job.sealed, jobSchema);
    const rows = await this.store.db
      .prepare(
        "SELECT * FROM sales_job_items WHERE job_id=? AND state='pending' ORDER BY ordinal LIMIT 20",
      )
      .bind(id)
      .all<{
        ordinal: number;
        listing_id: string;
        expected_revision: string;
      }>();
    for (const row of rows.results) {
      try {
        if (action.kind === 'publish') {
          let receipt;
          for (const reviewId of action.reviewIds) {
            const review = await this.store.review(reviewId);
            if (
              review.items.some(
                (r) =>
                  r.id === row.listing_id &&
                  r.revision === row.expected_revision,
              )
            ) {
              receipt = (await this.store.publish(reviewId, observe, id)).find(
                (r) => r.id === row.listing_id,
              );
              break;
            }
          }
          if (!receipt)
            throw new SalesError(
              'MANIFEST_CHANGED',
              'This item was not in the reviewed manifest.',
              409,
            );
          await this.store.db
            .prepare(
              "UPDATE sales_job_items SET state='complete',result=? WHERE job_id=? AND ordinal=? AND state='pending'",
            )
            .bind(
              JSON.stringify({ result: 'published', ...receipt }),
              id,
              row.ordinal,
            )
            .run();
          continue;
        }
        const item = await this.store.get(row.listing_id);
        if (item.revision !== row.expected_revision)
          throw new SalesError(
            'REVISION_CHANGED',
            'Listing changed since selection. Review this item again.',
            409,
          );
        let draft = item.draft;
        if (action.kind === 'mode')
          draft = {
            ...draft,
            mode: action.mode,
            minimumOffer: action.mode === 'offer' ? draft.minimumOffer : null,
          };
        if (action.kind === 'destination')
          draft = { ...draft, destinationId: action.destinationId };
        if (action.kind === 'shop')
          draft = { ...draft, includeInShop: action.include };
        if (action.kind === 'portfolio-price')
          draft = {
            ...draft,
            priceSource: {
              kind: 'portfolio',
              fingerprint: sourcePriceFingerprint(observe(draft).price),
            },
          };
        const next = crypto.randomUUID();
        await this.store.atomic([
          ...this.store.guard(
            "EXISTS(SELECT 1 FROM sales_job_items WHERE job_id=? AND ordinal=? AND state='pending') AND EXISTS(SELECT 1 FROM sale_drafts WHERE id=? AND revision=?)",
            [id, row.ordinal, row.listing_id, row.expected_revision],
          ),
          action.kind === 'pause'
            ? this.store.db
                .prepare(
                  "UPDATE sale_drafts SET availability='paused',operational_revision=? WHERE id=?",
                )
                .bind(next, row.listing_id)
            : this.store.db
                .prepare(
                  'UPDATE sale_drafts SET revision=?,sealed=?,updated_at=?,mode=?,uses_portfolio=?,source_price_hash=? WHERE id=?',
                )
                .bind(
                  next,
                  await this.store.seal(draft),
                  Date.now(),
                  ...(await this.store.indexFields(draft)),
                  row.listing_id,
                ),
          this.store.db
            .prepare(
              "UPDATE sales_job_items SET state='complete',result=? WHERE job_id=? AND ordinal=?",
            )
            .bind(
              JSON.stringify({
                revision: next,
                result: action.kind === 'pause' ? 'paused' : 'draft-saved',
              }),
              id,
              row.ordinal,
            ),
        ]);
      } catch (e) {
        await this.store.db
          .prepare(
            "UPDATE sales_job_items SET state='needs-review',result=? WHERE job_id=? AND ordinal=? AND state='pending'",
          )
          .bind(
            JSON.stringify({
              error:
                e instanceof SalesError
                  ? e.message
                  : 'Could not update this item. Review and create a new selection.',
            }),
            id,
            row.ordinal,
          )
          .run();
      }
    }
    const remaining = await this.store.db
      .prepare(
        "SELECT count(*) AS count FROM sales_job_items WHERE job_id=? AND state='pending'",
      )
      .bind(id)
      .first<{ count: number }>();
    await this.store.db
      .prepare('UPDATE sales_jobs SET status=?,updated_at=? WHERE id=?')
      .bind(remaining?.count ? 'pending' : 'finished', Date.now(), id)
      .run();
    return this.get(id);
  }
  async get(id: string, cursor = -1) {
    const job = await this.store.db
      .prepare('SELECT id,status,digest FROM sales_jobs WHERE id=?')
      .bind(id)
      .first();
    if (!job) throw new SalesError('MISSING', 'Bulk job not found.', 404);
    const counts = await this.store.db
      .prepare(
        'SELECT state,count(*) AS count FROM sales_job_items WHERE job_id=? GROUP BY state',
      )
      .bind(id)
      .all();
    const rows = await this.store.db
      .prepare(
        'SELECT ordinal,listing_id,state,result FROM sales_job_items WHERE job_id=? AND ordinal>? ORDER BY ordinal LIMIT 101',
      )
      .bind(id, cursor)
      .all<{
        ordinal: number;
        listing_id: string;
        state: string;
        result: string | null;
      }>();
    return {
      ...job,
      counts: counts.results,
      items: rows.results
        .slice(0, 100)
        .map((r) => ({ ...r, result: r.result ? JSON.parse(r.result) : null })),
      cursor: rows.results.length > 100 ? rows.results[99].ordinal : null,
    };
  }
}
