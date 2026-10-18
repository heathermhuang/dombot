import type { SalesListing } from '../shared/sales-api';
import { canonicalDomain } from '../shared/publication';
import { z } from 'zod';
import { aesGcmCipher, type Cipher } from '../core/storage/encrypted';
import {
  salesProjection,
  sourcePriceFingerprint,
} from '../core/publication/sales';
import {
  saleDraftSchema,
  destinationSchema,
  publishedSaleSchema,
  shopDraftSchema,
  type SaleDraft,
  type SaleDestination,
  type SaleShop,
  type PublishedSale,
} from '../shared/sales';
import {
  salesReviewSchema,
  conflict,
  SalesError,
  type SalesReview,
} from '../shared/sales-review';
import type { ListPrice } from '../shared/ipc';
import { deriveSalesKey, parseRootSecret, salesIndexer } from './keys';

export interface SaleObservation {
  price: ListPrice | null;
  ownershipFingerprint: string;
  controlExpiresAt: number;
  available: boolean;
  reason: string | null;
}
export type SavedSale = SalesListing;
export class SalesStore {
  constructor(
    readonly db: D1Database,
    readonly cipher: Cipher,
    readonly root: Uint8Array,
  ) {}
  static async from(
    env: Pick<Env, 'DB' | 'DOMBOT_SECRET'>,
  ): Promise<SalesStore> {
    const root = parseRootSecret(env.DOMBOT_SECRET);
    return new SalesStore(
      env.DB,
      await aesGcmCipher(await deriveSalesKey(root)),
      root,
    );
  }
  private readonly indexers = new Map<
    string,
    Promise<(value: string) => Promise<string>>
  >();
  hash(purpose: string, value: string): Promise<string> {
    let key = this.indexers.get(purpose);
    if (!key) {
      key = salesIndexer(this.root, purpose);
      this.indexers.set(purpose, key);
    }
    return key.then((sign) => sign(value));
  }
  async indexFields(
    draft: SaleDraft,
  ): Promise<[string, number, string | null]> {
    return [
      draft.mode,
      draft.priceSource?.kind === 'portfolio' ? 1 : 0,
      draft.priceSource?.kind === 'portfolio'
        ? await this.hash('source-price', draft.priceSource.fingerprint)
        : null,
    ];
  }
  async stalePriceIds(prices: Record<string, ListPrice>): Promise<string[]> {
    const current = new Map<string, string>(),
      entries = Object.entries(prices);
    for (let i = 0; i < entries.length; i += 100)
      for (const [domainHash, priceHash] of await Promise.all(
        entries
          .slice(i, i + 100)
          .map(async ([domain, price]) => [
            await this.hash('domain', domain),
            await this.hash('source-price', sourcePriceFingerprint(price)),
          ]),
      ))
        current.set(domainHash, priceHash);
    const empty = await this.hash('source-price', sourcePriceFingerprint(null));
    const rows = await this.db
      .prepare(
        'SELECT id,domain_hash,source_price_hash FROM sale_drafts WHERE uses_portfolio=1',
      )
      .all<{ id: string; domain_hash: string; source_price_hash: string }>();
    return rows.results
      .filter(
        (r) => (current.get(r.domain_hash) ?? empty) !== r.source_price_hash,
      )
      .map((r) => r.id);
  }
  seal(value: unknown) {
    return this.cipher.seal(JSON.stringify(value));
  }
  async open<T>(sealed: string, schema: z.ZodType<T>): Promise<T> {
    return schema.parse(JSON.parse(await this.cipher.open(sealed)));
  }
  /** Check inside the write transaction. A false guard rolls back every statement. */
  guard(
    condition: string,
    args: (string | number | null)[],
  ): D1PreparedStatement[] {
    return [
      this.db
        .prepare(
          `INSERT INTO sales_cas_guard(id,ok) SELECT 'guard',CASE WHEN ${condition} THEN 1 ELSE 0 END ON CONFLICT(id) DO UPDATE SET ok=excluded.ok`,
        )
        .bind(...args),
    ];
  }

  async atomic(statements: D1PreparedStatement[]): Promise<void> {
    try {
      await this.db.batch(statements);
    } catch (e) {
      if (
        e instanceof Error &&
        /CHECK constraint failed.*ok|sales_cas_guard/.test(e.message)
      )
        throw conflict();
      throw e;
    }
  }
  async get(id: string): Promise<SavedSale> {
    const row = await this.db
      .prepare(
        'SELECT d.*,p.payload,p.draft_revision,p.previous_payload,(SELECT max(updated_at) FROM sales_leads l WHERE l.listing_id=d.id) AS last_inquiry_at FROM sale_drafts d LEFT JOIN published_sales p ON p.id=d.id WHERE d.id=?',
      )
      .bind(id)
      .first<{
        sealed: string;
        revision: string;
        operational_revision: string;
        availability: string;
        control_expires_at: number;
        payload: string | null;
        draft_revision: string | null;
        previous_payload: string | null;
        last_inquiry_at: number | null;
      }>();
    if (!row) throw new SalesError('MISSING', 'Sales listing not found.', 404);
    return {
      publishedDraftRevision: row.draft_revision,
      hasPreviousPublication: !!row.previous_payload,
      lastInquiryAt: row.last_inquiry_at,
      draft: await this.open(row.sealed, saleDraftSchema),
      revision: row.revision,
      operationalRevision: row.operational_revision,
      availability: row.availability,
      controlExpiresAt: row.control_expires_at,
      published: row.payload
        ? publishedSaleSchema.parse(JSON.parse(row.payload))
        : null,
    };
  }
  async list(
    cursor = '',
    limit = 100,
    filter: {
      q?: string;
      domains?: string[];
      mode?: string;
      state?: string;
      staleIds?: string[];
    } = {},
  ): Promise<{ items: SavedSale[]; cursor: string | null }> {
    const size = Math.max(1, Math.min(limit, 100)),
      q = filter.q ?? '',
      mode = filter.mode ?? '',
      state = filter.state ?? 'All',
      hashes: string[] = [];
    const domains = filter.domains ?? [];
    for (let i = 0; i < domains.length; i += 100)
      hashes.push(
        ...(await Promise.all(
          domains.slice(i, i + 100).map((d) => this.hash('domain', d)),
        )),
      );
    const like = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
    const { results } = await this.db
      .prepare(
        `SELECT d.id FROM sale_drafts d LEFT JOIN published_sales p ON p.id=d.id WHERE d.id>?
      AND (?='' OR d.domain_hash IN (SELECT value FROM json_each(?)) OR p.domain LIKE ? ESCAPE '\\')
      AND (?='' OR d.mode=?) AND (?='All' OR (?='Drafts' AND p.id IS NULL) OR (?='Published' AND p.id IS NOT NULL AND d.availability='available' AND d.control_expires_at>?) OR (?='Paused' AND p.id IS NOT NULL AND d.availability='paused') OR (?='Needs attention' AND (d.availability IN ('sold','ownership-uncertain','control-lost') OR (p.id IS NOT NULL AND d.control_expires_at<=?) OR d.id IN (SELECT value FROM json_each(?))))) ORDER BY d.id LIMIT ?`,
      )
      .bind(
        cursor,
        q,
        JSON.stringify(hashes),
        like,
        mode,
        mode,
        state,
        state,
        state,
        Date.now(),
        state,
        state,
        Date.now(),
        JSON.stringify(filter.staleIds ?? []),
        size + 1,
      )
      .all<{ id: string }>();
    const page = results.slice(0, size);
    return {
      items: await Promise.all(page.map((v) => this.get(v.id))),
      cursor: results.length > size ? page.at(-1)!.id : null,
    };
  }
  async save(input: SaleDraft, expected: string | null): Promise<string> {
    const draft = saleDraftSchema.parse(input),
      revision = crypto.randomUUID(),
      hash = await this.hash('domain', draft.domain);
    if (expected) {
      const old = await this.get(draft.id);
      if (old.draft.domain !== draft.domain)
        throw conflict('A listing cannot change its domain.');
    }
    const statement = expected
      ? this.db
          .prepare(
            'UPDATE sale_drafts SET revision=?,sealed=?,updated_at=?,mode=?,uses_portfolio=?,source_price_hash=? WHERE id=? AND revision=? RETURNING id',
          )
          .bind(
            revision,
            await this.seal(draft),
            Date.now(),
            ...(await this.indexFields(draft)),
            draft.id,
            expected,
          )
      : this.db
          .prepare(
            'INSERT INTO sale_drafts(id,domain_hash,revision,operational_revision,sealed,updated_at,mode,uses_portfolio,source_price_hash) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING RETURNING id',
          )
          .bind(
            draft.id,
            hash,
            revision,
            crypto.randomUUID(),
            await this.seal(draft),
            Date.now(),
            ...(await this.indexFields(draft)),
          );
    if (!(await statement.first())) throw conflict();
    return revision;
  }
  async destinations(): Promise<SaleDestination[]> {
    const rows = await this.db
      .prepare('SELECT sealed FROM sale_destinations ORDER BY id LIMIT 100')
      .all<{ sealed: string }>();
    return Promise.all(
      rows.results.map((r) => this.open(r.sealed, destinationSchema)),
    );
  }
  async destination(id: string | null): Promise<SaleDestination | null> {
    if (!id) return null;
    const r = await this.db
      .prepare('SELECT sealed FROM sale_destinations WHERE id=?')
      .bind(id)
      .first<{ sealed: string }>();
    return r ? this.open(r.sealed, destinationSchema) : null;
  }
  async saveDestination(
    value: SaleDestination,
    expected: string | null,
  ): Promise<void> {
    value = destinationSchema.parse(value);
    const q = expected
      ? this.db
          .prepare(
            'UPDATE sale_destinations SET revision=?,sealed=? WHERE id=? AND revision=? RETURNING id',
          )
          .bind(value.revision, await this.seal(value), value.id, expected)
      : this.db
          .prepare(
            'INSERT INTO sale_destinations(id,revision,sealed) VALUES(?,?,?) ON CONFLICT DO NOTHING RETURNING id',
          )
          .bind(value.id, value.revision, await this.seal(value));
    if (!(await q.first())) throw conflict();
  }
  async shop(): Promise<{
    draft: SaleShop;
    revision: string | null;
    published: SaleShop | null;
  }> {
    const r = await this.db
      .prepare("SELECT * FROM sales_shop WHERE id='main'")
      .first<{ sealed: string; revision: string; published: string | null }>();
    return r
      ? {
          draft: await this.open(r.sealed, shopDraftSchema),
          revision: r.revision,
          published: r.published
            ? shopDraftSchema.parse(JSON.parse(r.published))
            : null,
        }
      : {
          draft: {
            version: 1,
            handle: 'shop',
            title: 'Domains for sale',
            intro: '',
            listingIds: [],
          },
          revision: null,
          published: null,
        };
  }
  async saveShop(draft: SaleShop, expected: string | null): Promise<string> {
    draft = shopDraftSchema.parse(draft);
    const revision = crypto.randomUUID();
    const q = expected
      ? this.db
          .prepare(
            "UPDATE sales_shop SET revision=?,sealed=? WHERE id='main' AND revision=? RETURNING id",
          )
          .bind(revision, await this.seal(draft), expected)
      : this.db
          .prepare(
            "INSERT INTO sales_shop(id,revision,sealed) VALUES('main',?,?) ON CONFLICT DO NOTHING RETURNING id",
          )
          .bind(revision, await this.seal(draft));
    if (!(await q.first())) throw conflict();
    return revision;
  }
  async prepare(
    ids: { id: string; revision: string }[],
    observe: (d: SaleDraft) => SaleObservation,
  ): Promise<SalesReview> {
    if (
      !ids.length ||
      ids.length > 100 ||
      new Set(ids.map((v) => v.id)).size !== ids.length
    )
      throw new SalesError(
        'BATCH_INVALID',
        'Review between 1 and 100 distinct listings.',
      );
    const shop = await this.shop();
    const items: SalesReview['items'] = [];
    for (const ref of ids) {
      const saved = await this.get(ref.id);
      if (saved.revision !== ref.revision) throw conflict();
      const observation = observe(saved.draft);
      if (!observation.available || observation.controlExpiresAt <= Date.now())
        throw new SalesError(
          'CONTROL_UNCERTAIN',
          observation.reason ?? 'Refresh domain control before publishing.',
          409,
        );
      if (['sold', 'control-lost'].includes(saved.availability))
        throw new SalesError(
          'UNAVAILABLE',
          'This name is unavailable. Review its availability before publishing.',
          409,
        );
      const destination = await this.destination(saved.draft.destinationId);
      items.push({
        id: ref.id,
        revision: ref.revision,
        operationalRevision: saved.operationalRevision,
        priceFingerprint: sourcePriceFingerprint(observation.price),
        ownershipFingerprint: observation.ownershipFingerprint,
        destinationRevision: destination?.revision ?? null,
        includeInShop: saved.draft.includeInShop,
        beforeIncludeInShop:
          shop.published?.listingIds.includes(ref.id) ?? false,
        controlObservedAt: observation.controlExpiresAt - 86400_000,
        before: saved.published,
        after: salesProjection(
          saved.draft,
          observation.price,
          destination,
          crypto.randomUUID(),
        ),
      });
    }
    const review = salesReviewSchema.parse({
      version: 1,
      id: crypto.randomUUID(),
      expiresAt: Date.now() + 900_000,
      shopRevision: shop.revision,
      items,
    });
    await this.db.batch([
      this.db
        .prepare(
          'INSERT INTO sales_reviews(id,sealed,expires_at) VALUES(?,?,?)',
        )
        .bind(review.id, await this.seal(review), review.expiresAt),
      ...review.items.map((item) =>
        this.db
          .prepare(
            'INSERT INTO sales_review_items(review_id,listing_id) VALUES(?,?)',
          )
          .bind(review.id, item.id),
      ),
    ]);
    return review;
  }
  async review(id: string): Promise<SalesReview> {
    const r = await this.db
      .prepare('SELECT sealed FROM sales_reviews WHERE id=?')
      .bind(id)
      .first<{ sealed: string }>();
    if (!r) throw new SalesError('MISSING', 'Review not found.', 404);
    return this.open(r.sealed, salesReviewSchema);
  }
  async publish(
    id: string,
    observe: (d: SaleDraft) => SaleObservation,
    jobId?: string,
  ): Promise<{ id: string; revision: string; domain: string }[]> {
    const row = await this.db
      .prepare('SELECT receipt,expires_at FROM sales_reviews WHERE id=?')
      .bind(id)
      .first<{ receipt: string | null; expires_at: number }>();
    if (row?.receipt) return JSON.parse(row.receipt);
    const review = await this.review(id);
    if (!row || row.expires_at <= Date.now())
      throw conflict('This review expired. Review the latest changes.');
    const statements: D1PreparedStatement[] = [];
    const receipt = review.items.map((i) => ({
      id: i.id,
      revision: i.after.revision,
      domain: i.after.domain,
    }));
    const shop = await this.shop();
    let expectedShopRevision = review.shopRevision;
    if (jobId) {
      const job = await this.db
        .prepare('SELECT sealed,shop_revision FROM sales_jobs WHERE id=?')
        .bind(jobId)
        .first<{ sealed: string; shop_revision: string | null }>();
      if (!job) throw conflict('Publication job not found.');
      const authority = await this.open(
        job.sealed,
        z
          .object({
            action: z
              .object({
                kind: z.literal('publish'),
                reviewIds: z.array(z.string().uuid()),
              })
              .strict(),
            requestKey: z.string().uuid(),
          })
          .strict(),
      );
      if (!authority.action.reviewIds.includes(id))
        throw conflict('This review is not in the publication job.');
      expectedShopRevision = job.shop_revision;
      statements.push(
        ...this.guard(
          'EXISTS(SELECT 1 FROM sales_jobs WHERE id=? AND shop_revision IS ?)',
          [jobId, expectedShopRevision],
        ),
      );
    }
    if (shop.revision !== expectedShopRevision)
      throw conflict('The shop changed. Review again.');
    statements.push(
      ...this.guard(
        'EXISTS(SELECT 1 FROM sales_reviews WHERE id=? AND consumed_at IS NULL AND expires_at>?)',
        [id, Date.now()],
      ),
    );
    statements.push(
      ...this.guard(
        expectedShopRevision
          ? "EXISTS(SELECT 1 FROM sales_shop WHERE id='main' AND revision=?)"
          : "NOT EXISTS(SELECT 1 FROM sales_shop WHERE id='main')",
        expectedShopRevision ? [expectedShopRevision] : [],
      ),
    );
    const selected = new Set(shop.published?.listingIds ?? []);
    for (const item of review.items) {
      const saved = await this.get(item.id),
        o = observe(saved.draft),
        destination = await this.destination(saved.draft.destinationId);
      if (
        !o.available ||
        o.controlExpiresAt <= Date.now() ||
        o.ownershipFingerprint !== item.ownershipFingerprint ||
        sourcePriceFingerprint(o.price) !== item.priceFingerprint ||
        destination?.revision !== (item.destinationRevision ?? undefined)
      )
        throw conflict(
          'The price, control observation or destination changed after review.',
        );
      const current = salesProjection(
        saved.draft,
        o.price,
        destination,
        item.after.revision,
        item.after.publishedAt,
      );
      if (JSON.stringify(current) !== JSON.stringify(item.after))
        throw conflict();
      statements.push(
        ...this.guard(
          'EXISTS(SELECT 1 FROM sale_drafts WHERE id=? AND revision=? AND operational_revision=?)',
          [item.id, item.revision, item.operationalRevision],
        ),
      );
      if (destination)
        statements.push(
          ...this.guard(
            'EXISTS(SELECT 1 FROM sale_destinations WHERE id=? AND revision=?)',
            [destination.id, destination.revision],
          ),
        );
      statements.push(
        this.db
          .prepare(
            "UPDATE sale_drafts SET availability='available',operational_revision=?,control_expires_at=? WHERE id=?",
          )
          .bind(crypto.randomUUID(), o.controlExpiresAt, item.id),
      );
      statements.push(
        this.db
          .prepare(
            'INSERT INTO published_sales(id,domain,revision,payload,published_at,draft_revision) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET previous_payload=published_sales.payload,revision=excluded.revision,payload=excluded.payload,published_at=excluded.published_at,draft_revision=excluded.draft_revision',
          )
          .bind(
            item.id,
            item.after.domain,
            item.after.revision,
            JSON.stringify(item.after),
            item.after.publishedAt,
            item.revision,
          ),
      );
      if (item.includeInShop) selected.add(item.id);
      else selected.delete(item.id);
      statements.push(
        this.db
          .prepare(
            "INSERT INTO sales_events(id,listing_id,kind,created_at,sealed) VALUES(?,?,'publication',?,?)",
          )
          .bind(
            crypto.randomUUID(),
            item.id,
            item.after.publishedAt,
            await this.seal({
              kind: 'publication',
              domain: item.after.domain,
              revision: item.after.revision,
            }),
          ),
      );
    }
    const nextShopRevision =
      shop.revision && shop.published ? crypto.randomUUID() : shop.revision;
    if (shop.revision && shop.published)
      statements.push(
        this.db
          .prepare(
            "UPDATE sales_shop SET revision=?,published=? WHERE id='main'",
          )
          .bind(
            nextShopRevision,
            JSON.stringify({ ...shop.published, listingIds: [...selected] }),
          ),
      );
    if (jobId)
      statements.push(
        this.db
          .prepare('UPDATE sales_jobs SET shop_revision=? WHERE id=?')
          .bind(nextShopRevision, jobId),
      );
    statements.push(
      this.db
        .prepare('UPDATE sales_reviews SET consumed_at=?,receipt=? WHERE id=?')
        .bind(Date.now(), JSON.stringify(receipt), id),
    );
    await this.atomic(statements);
    return receipt;
  }
  async availability(
    id: string,
    expected: string,
    state: string,
  ): Promise<string> {
    const revision = crypto.randomUUID();
    if (
      !(await this.db
        .prepare(
          'UPDATE sale_drafts SET availability=?,operational_revision=? WHERE id=? AND operational_revision=? RETURNING id',
        )
        .bind(state, revision, id, expected)
        .first())
    )
      throw conflict();
    return revision;
  }
  async unpublish(id: string, revision: string): Promise<void> {
    await this.atomic([
      ...this.guard(
        'EXISTS(SELECT 1 FROM sale_drafts WHERE id=? AND revision=?)',
        [id, revision],
      ),
      this.db
        .prepare(
          'UPDATE sale_drafts SET revision=?,operational_revision=?,availability=? WHERE id=?',
        )
        .bind(crypto.randomUUID(), crypto.randomUUID(), 'paused', id),
      this.db.prepare('DELETE FROM published_sales WHERE id=?').bind(id),
    ]);
  }
  async removeNames(names: string[]): Promise<void> {
    const hashes = await Promise.all(
      [...new Set(names.map(canonicalDomain))].map((name) =>
        this.hash('domain', name),
      ),
    );
    if (!hashes.length) return;
    const rows = await this.db
      .prepare(
        'SELECT id FROM sale_drafts WHERE domain_hash IN (SELECT value FROM json_each(?))',
      )
      .bind(JSON.stringify(hashes))
      .all<{ id: string }>();
    const ids = rows.results.map((r) => r.id);
    if (!ids.length) return;
    const encoded = JSON.stringify(ids),
      statements = [
        this.db
          .prepare(
            'DELETE FROM sales_reviews WHERE id IN (SELECT review_id FROM sales_review_items WHERE listing_id IN (SELECT value FROM json_each(?)))',
          )
          .bind(encoded),
        this.db
          .prepare(
            'DELETE FROM sales_jobs WHERE id IN (SELECT job_id FROM sales_job_items WHERE listing_id IN (SELECT value FROM json_each(?)))',
          )
          .bind(encoded),
        this.db.prepare('DELETE FROM sales_shop_reviews'),
        this.db
          .prepare(
            'DELETE FROM sales_events WHERE listing_id IN (SELECT value FROM json_each(?))',
          )
          .bind(encoded),
        this.db
          .prepare(
            'DELETE FROM sales_host_bindings WHERE listing_id IN (SELECT value FROM json_each(?))',
          )
          .bind(encoded),
        this.db
          .prepare(
            'DELETE FROM sale_drafts WHERE id IN (SELECT value FROM json_each(?))',
          )
          .bind(encoded),
      ];
    const shop = await this.shop();
    if (
      shop.revision &&
      (shop.draft.listingIds.some((id) => ids.includes(id)) ||
        shop.published?.listingIds.some((id) => ids.includes(id)))
    )
      statements.push(
        ...this.guard(
          "EXISTS(SELECT 1 FROM sales_shop WHERE id='main' AND revision=?)",
          [shop.revision],
        ),
        this.db
          .prepare(
            "UPDATE sales_shop SET revision=?,sealed=?,published=? WHERE id='main'",
          )
          .bind(
            crypto.randomUUID(),
            await this.seal({
              ...shop.draft,
              listingIds: shop.draft.listingIds.filter(
                (id) => !ids.includes(id),
              ),
            }),
            shop.published
              ? JSON.stringify({
                  ...shop.published,
                  listingIds: shop.published.listingIds.filter(
                    (id) => !ids.includes(id),
                  ),
                })
              : null,
          ),
      );
    await this.atomic(statements);
  }

  /** Suppression follows inventory/history; a healthy observation never republishes. */
  async reconcile(
    observe: (d: SaleDraft) => SaleObservation,
    domains: string[],
  ): Promise<void> {
    for (let offset = 0; offset < domains.length; offset += 100) {
      const hashes = await Promise.all(
        domains.slice(offset, offset + 100).map((d) => this.hash('domain', d)),
      );
      if (!hashes.length) continue;
      const rows = await this.db
        .prepare(
          `SELECT id,sealed FROM sale_drafts WHERE availability='available' AND domain_hash IN (${hashes.map(() => '?').join(',')})`,
        )
        .bind(...hashes)
        .all<{ id: string; sealed: string }>();
      for (const row of rows.results) {
        const o = observe(await this.open(row.sealed, saleDraftSchema));
        if (!o.available)
          await this.db
            .prepare(
              "UPDATE sale_drafts SET availability='ownership-uncertain',operational_revision=? WHERE id=? AND availability='available'",
            )
            .bind(crypto.randomUUID(), row.id)
            .run();
        else
          await this.db
            .prepare(
              "UPDATE sale_drafts SET control_expires_at=? WHERE id=? AND availability='available'",
            )
            .bind(o.controlExpiresAt, row.id)
            .run();
      }
    }
  }
}

/** Public reads deliberately require no encryption key or private namespace. */
export async function readPublicSale(
  db: D1Database,
  domain: string,
  now = Date.now(),
): Promise<PublishedSale | null> {
  const r = await db
    .prepare(
      "SELECT p.payload FROM published_sales p JOIN sale_drafts d ON d.id=p.id WHERE p.domain=? AND d.availability='available' AND d.control_expires_at>?",
    )
    .bind(domain, now)
    .first<{ payload: string }>();
  return r ? publishedSaleSchema.parse(JSON.parse(r.payload)) : null;
}
