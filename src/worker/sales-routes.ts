import { listEvents } from '../core/services/domain-events';
import { toUnicode } from '../shared/domain-name';
import { verifyGatewayRequest } from '../shared/gateway-proof';
import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { isAuthenticated, sameOrigin, type AuthConfig } from './auth';
import {
  saleDraftSchema,
  emptySale,
  destinationSchema,
  shopDraftSchema,
  messageSchema,
  conversationStatusSchema,
  availabilitySchema,
  publishedSaleSchema,
} from '../shared/sales';
import {
  saleOutcomeSchema,
  salesPublicationEventSchema,
} from '../shared/sales-events';
import { SalesError } from '../shared/sales-review';
import {
  validateSalesDestination,
  SALES_PROVIDER_CAPABILITIES,
} from '../shared/sales-provider';
import { renderSalesLander, salesHeaders } from '../shared/render-sales-lander';
import {
  sourcePriceFingerprint,
  salesProjection,
} from '../core/publication/sales';
import { canonicalDomain } from '../shared/publication';
import { getListPrices } from '../core/services/list-prices';
import { getCachedPortfolio } from '../core/services/registrars';
import { getImportedDomains } from '../core/services/imported-domains';
import { SalesStore } from './sales-store';
import { SalesInquiryStore } from './sales-inquiry-store';
import { observeSale, createSaleObserver } from './sales-observation';
import { SalesJobs, bulkActionSchema } from './sales-jobs';
import { aesGcmCipher } from '../core/storage/encrypted';
import { deriveEncryptionKey, parseRootSecret } from './keys';
import { PublicationStore } from './publication-store';
import { isOwnerSite } from '../shared/owner-site';

type SalesEnv = {
  Bindings: Env;
  Variables: { auth: AuthConfig; salesRecipientVerified?: boolean };
};
const revision = z.string().uuid();
// Inventory grants draft selection, never publication authority.
const salesInventoryNames = async (env: Env) => {
  const { draft } = await new PublicationStore(
    env.DB,
    await aesGcmCipher(
      await deriveEncryptionKey(parseRootSecret(env.DOMBOT_SECRET)),
    ),
  ).draft();
  const collection = isOwnerSite(draft)
    ? draft.domainPresentations
    : draft.listings;
  return [
    ...new Set([
      ...(getCachedPortfolio()?.domains ?? []).map((d) =>
        canonicalDomain(d.domainName),
      ),
      ...Object.keys(getImportedDomains()).map(canonicalDomain),
      ...collection.map((item) => item.domain),
    ]),
  ];
};
export function createSalesRoutes(stateful: MiddlewareHandler<SalesEnv>) {
  const app = new Hono<SalesEnv>();
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    if (!(await isAuthenticated(c.get('auth'), c.req.raw, c.env.DB)))
      return c.json({ error: 'Not signed in' }, 401);
    if (c.env.DOMBOT_AUTH === 'gateway') {
      const proof = await verifyGatewayRequest(
        c.env.DOMBOT_GATEWAY_SECRET ?? '',
        c.env.DOMBOT_WORKSPACE_ID ?? '',
        c.req.raw,
      );
      if (proof?.sales?.purpose !== 'sales-owner')
        return c.json({ error: 'Sales owner admission required' }, 403);
      c.set('salesRecipientVerified', proof.sales.recipientVerified);
    }
    if (c.req.method !== 'GET' && !sameOrigin(c.req.raw))
      return c.json({ error: 'Bad origin' }, 403);
    const recovery =
      /\/(?:pause|unpublish)$/.test(c.req.path) || c.req.method === 'DELETE';
    if (c.req.method !== 'GET' && !recovery && c.env.DOMBOT_SALES_V1 !== 'true')
      return c.json(
        {
          error:
            'Sales editing is disabled. Read, export, pause and unpublish remain available.',
        },
        403,
      );
    await next();
  });
  app.use(
    '*',
    bodyLimit({
      maxSize: 256 * 1024,
      onError: (c) => c.json({ error: 'Sales request is too large.' }, 413),
    }),
  );
  app.use('*', stateful);
  app.onError((error, c) => {
    if (error instanceof SalesError)
      return c.json({ code: error.code, error: error.message }, error.status);
    if (error instanceof z.ZodError)
      return c.json(
        {
          error: error.issues
            .slice(0, 3)
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .join('; '),
        },
        400,
      );
    return c.json(
      {
        error:
          'Could not load or save sales data. Check the sales migrations and try again.',
      },
      503,
    );
  });
  const inbox = async (env: Env) =>
    new SalesInquiryStore(
      await SalesStore.from(env),
      env.DOMBOT_SALES_ORIGIN ?? 'https://unconfigured.invalid',
    );
  const requireRecipient = async (
    env: Env,
    recipientVerified: boolean | undefined,
    items: { after: { mode: string; allowQuestions: boolean } }[],
  ) => {
    if (
      env.DOMBOT_AUTH === 'gateway' &&
      items.some(
        (i) =>
          i.after.allowQuestions || ['inquiry', 'offer'].includes(i.after.mode),
      ) &&
      !recipientVerified
    )
      throw new SalesError(
        'RECIPIENT_UNVERIFIED',
        'Confirm your account email before publishing an inquiry or offer path.',
        409,
      );
  };
  app.get('/capabilities', (c) =>
    c.json({
      sales: c.env.DOMBOT_SALES_V1 === 'true',
      inquiries: c.env.SALES_INQUIRIES_ENABLED === 'true',
      sending: c.env.SALES_MAIL_ENABLED === 'true',
      provider: SALES_PROVIDER_CAPABILITIES,
    }),
  );
  app.get('/inventory', async (c) => {
    const q = (c.req.query('q') ?? '').toLowerCase().slice(0, 253),
      cursor = c.req.query('cursor') ?? '';
    const names = (await salesInventoryNames(c.env))
      .filter((d) => d > cursor && d.includes(q))
      .sort();
    return c.json({
      items: names.slice(0, 100).map((domain) => {
        const draft = emptySale(domain, 'unreviewed'),
          o = observeSale(draft, c.env);
        return {
          domain,
          price: o.price
            ? {
                amount: o.price.amount,
                currency: o.price.currency,
                updatedAt: o.price.updatedAt,
              }
            : null,
          priceFingerprint: sourcePriceFingerprint(o.price),
          available: o.available,
          reason: o.reason,
        };
      }),
      cursor: names.length > 100 ? names[99] : null,
    });
  });
  app.get('/listings', async (c) => {
    const db = await SalesStore.from(c.env),
      q = (c.req.query('q') ?? '').slice(0, 253).toLowerCase(),
      mode = c.req.query('mode') ?? '',
      state = c.req.query('state') ?? 'All',
      prices = getListPrices();
    const domains = q
      ? [
          ...new Set([
            ...(await salesInventoryNames(c.env)),
            ...listEvents().map((e) => e.domain),
          ]),
        ].filter(
          (name) =>
            name.includes(q) || toUnicode(name).toLowerCase().includes(q),
        )
      : [];
    if (q) {
      try {
        domains.push(canonicalDomain(q));
      } catch {
        /* Partial search uses the already authorized inventory/history index. */
      }
    }
    const result = await db.list(c.req.query('cursor') ?? '', 100, {
      q,
      domains,
      mode,
      state,
      staleIds:
        state === 'Needs attention' ? await db.stalePriceIds(prices) : [],
    });
    return c.json({
      ...result,
      items: result.items.map((item) => ({
        ...item,
        priceChanged:
          item.draft.priceSource?.kind === 'portfolio' &&
          item.draft.priceSource.fingerprint !==
            sourcePriceFingerprint(prices[item.draft.domain]),
      })),
    });
  });
  app.post('/listings', async (c) => {
    const { domains } = z
      .object({ domains: z.array(z.string()).min(1).max(100) })
      .strict()
      .parse(await c.req.json());
    const db = await SalesStore.from(c.env),
      names = new Set(await salesInventoryNames(c.env)),
      items = [];
    for (const value of [...new Set(domains.map(canonicalDomain))]) {
      if (!names.has(value))
        throw new SalesError(
          'NOT_IN_INVENTORY',
          'Select a name from your inventory.',
        );
      const hash = await db.hash('domain', value),
        existing = await db.db
          .prepare('SELECT id FROM sale_drafts WHERE domain_hash=?')
          .bind(hash)
          .first<{ id: string }>();
      if (existing) {
        items.push(await db.get(existing.id));
        continue;
      }
      const draft = emptySale(value, 'unreviewed'),
        o = observeSale(draft, c.env);
      draft.priceSource = {
        kind: 'portfolio',
        fingerprint: sourcePriceFingerprint(o.price),
      };
      await db.save(draft, null);
      items.push(await db.get(draft.id));
    }
    return c.json({ items });
  });
  app.get('/listings/:id', async (c) => {
    const db = await SalesStore.from(c.env),
      saved = await db.get(c.req.param('id')),
      o = observeSale(saved.draft, c.env);
    return c.json({
      ...saved,
      observation: {
        ...o,
        price: o.price
          ? {
              amount: o.price.amount,
              currency: o.price.currency,
              updatedAt: o.price.updatedAt,
            }
          : null,
      },
      destinations: await db.destinations(),
    });
  });
  app.put('/listings/:id', async (c) => {
    const value = z
      .object({ draft: saleDraftSchema, revision })
      .strict()
      .parse(await c.req.json());
    if (value.draft.id !== c.req.param('id'))
      throw new SalesError('ID_MISMATCH', 'Listing ID does not match.');
    return c.json({
      revision: await (
        await SalesStore.from(c.env)
      ).save(value.draft, value.revision),
    });
  });
  app.get('/listings/:id/previous', async (c) => {
    const db = await SalesStore.from(c.env),
      saved = await db.get(c.req.param('id'));
    const row = await db.db
      .prepare('SELECT previous_payload FROM published_sales WHERE id=?')
      .bind(saved.draft.id)
      .first<{ previous_payload: string | null }>();
    if (!row?.previous_payload)
      throw new SalesError(
        'MISSING',
        'There is no previous public revision to restore.',
        404,
      );
    const old = publishedSaleSchema.parse(JSON.parse(row.previous_payload)),
      destinations = await db.destinations();
    const destination = old.destination
      ? destinations.find(
          (d) =>
            d.provider === old.destination!.provider &&
            d.url === old.destination!.url,
        )
      : null;
    const draft = saleDraftSchema.parse({
      ...saved.draft,
      mode: old.mode,
      displayName: old.displayName,
      description: old.description,
      categories: old.categories,
      sellerDisplayName: old.sellerDisplayName,
      minimumOffer: old.publicMinimumOffer,
      allowQuestions: old.allowQuestions,
      destinationId: destination?.id ?? null,
      priceSource: old.publicPrice
        ? {
            kind: 'override',
            price: old.publicPrice,
            reason: 'Explicit restoration of previous public terms for review',
          }
        : null,
    });
    return c.json({
      draft,
      destinationNeedsReview: !!old.destination && !destination,
    });
  });
  app.get('/listings/:id/preview', async (c) => {
    const db = await SalesStore.from(c.env),
      saved = await db.get(c.req.param('id')),
      o = observeSale(saved.draft, c.env);
    return c.html(
      renderSalesLander(
        salesProjection(
          saved.draft,
          o.price,
          await db.destination(saved.draft.destinationId),
          saved.revision,
        ),
        c.env.DOMBOT_PUBLIC_BASE_PATH ?? '',
        null,
        { preview: true },
      ),
      200,
      {
        ...salesHeaders,
        'Content-Security-Policy': salesHeaders[
          'Content-Security-Policy'
        ].replace("frame-ancestors 'none'", "frame-ancestors 'self'"),
      },
    );
  });
  app.post('/listings/:id/pause', async (c) => {
    const v = z
      .object({
        revision,
        state: availabilitySchema.exclude(['available']).default('paused'),
      })
      .strict()
      .parse(await c.req.json());
    return c.json({
      revision: await (
        await SalesStore.from(c.env)
      ).availability(c.req.param('id'), v.revision, v.state),
    });
  });
  app.post('/listings/:id/unpublish', async (c) => {
    const v = z
      .object({ revision })
      .strict()
      .parse(await c.req.json());
    await (
      await SalesStore.from(c.env)
    ).unpublish(c.req.param('id'), v.revision);
    return c.json({ ok: true });
  });
  app.post('/reviews', async (c) => {
    const v = z
      .object({
        items: z
          .array(z.object({ id: revision, revision }).strict())
          .min(1)
          .max(100),
      })
      .strict()
      .parse(await c.req.json());
    const review = await (
      await SalesStore.from(c.env)
    ).prepare(v.items, createSaleObserver(c.env));
    await requireRecipient(
      c.env,
      c.get('salesRecipientVerified'),
      review.items,
    );
    return c.json(review);
  });
  app.post('/bulk-reviews', async (c) => {
    const value = z
      .object({
        items: z
          .array(z.object({ id: revision, revision }).strict())
          .min(1)
          .max(500),
        requestKey: revision,
      })
      .strict()
      .parse(await c.req.json());
    const db = await SalesStore.from(c.env),
      reviews = [],
      observe = createSaleObserver(c.env);
    for (let offset = 0; offset < value.items.length; offset += 100) {
      const review = await db.prepare(
        value.items.slice(offset, offset + 100),
        observe,
      );
      await requireRecipient(
        c.env,
        c.get('salesRecipientVerified'),
        review.items,
      );
      reviews.push(review.id);
    }
    return c.json(
      await new SalesJobs(db).create(
        value.items,
        { kind: 'publish', reviewIds: reviews },
        value.requestKey,
      ),
    );
  });
  app.get('/reviews/:id', async (c) =>
    c.json(await (await SalesStore.from(c.env)).review(c.req.param('id'))),
  );
  app.post('/publications', async (c) => {
    const v = z
      .object({ reviewId: revision })
      .strict()
      .parse(await c.req.json());
    const db = await SalesStore.from(c.env);
    await requireRecipient(
      c.env,
      c.get('salesRecipientVerified'),
      (await db.review(v.reviewId)).items,
    );
    return c.json({
      items: await db.publish(v.reviewId, createSaleObserver(c.env)),
      message:
        'Publication review completed. Check the current listing state; domain setup is separate.',
    });
  });
  app.get('/destinations', async (c) =>
    c.json({
      items: await (await SalesStore.from(c.env)).destinations(),
      capabilities: SALES_PROVIDER_CAPABILITIES,
    }),
  );
  app.post('/destinations', async (c) => {
    const v = z
      .object({
        provider: destinationSchema.shape.provider,
        url: z.string().url(),
        domain: z.string().optional(),
        id: revision.optional(),
        revision: revision.nullable(),
      })
      .strict()
      .parse(await c.req.json());
    const db = await SalesStore.from(c.env),
      destination = {
        id: v.id ?? crypto.randomUUID(),
        provider: v.provider,
        url: validateSalesDestination(
          v.provider,
          v.url,
          v.domain ? canonicalDomain(v.domain) : undefined,
        ),
        revision: crypto.randomUUID(),
        check: 'manual' as const,
        checkedAt: null,
      };
    await db.saveDestination(destination, v.revision);
    return c.json(destination);
  });
  app.get('/shop', async (c) =>
    c.json(await (await SalesStore.from(c.env)).shop()),
  );
  app.get('/shop/site-copy', async (c) => {
    const db = await SalesStore.from(c.env),
      site = await new PublicationStore(
        c.env.DB,
        await aesGcmCipher(
          await deriveEncryptionKey(parseRootSecret(c.env.DOMBOT_SECRET)),
        ),
      ).draft();
    if (!site.revision)
      throw new SalesError(
        'MISSING',
        'There is no saved public-site presentation to copy.',
        404,
      );
    const current = await db.shop();
    return c.json(
      shopDraftSchema.parse({
        ...current.draft,
        handle: site.draft.handle,
        title: isOwnerSite(site.draft)
          ? site.draft.profile.name
          : site.draft.title,
        intro: isOwnerSite(site.draft)
          ? site.draft.profile.intro
          : site.draft.intro,
      }),
    );
  });
  app.put('/shop', async (c) => {
    const v = z
      .object({ draft: shopDraftSchema, revision: revision.nullable() })
      .strict()
      .parse(await c.req.json());
    return c.json({
      revision: await (
        await SalesStore.from(c.env)
      ).saveShop(v.draft, v.revision),
    });
  });
  app.post('/shop/reviews', async (c) => {
    const v = z
        .object({ revision })
        .strict()
        .parse(await c.req.json()),
      db = await SalesStore.from(c.env),
      shop = await db.shop();
    if (shop.revision !== v.revision)
      throw new SalesError(
        'REVISION_CHANGED',
        'The shop changed. Review again.',
        409,
      );
    const terms = [];
    for (const id of shop.draft.listingIds) {
      const item = await db.get(id);
      if (
        !item.published ||
        item.availability !== 'available' ||
        item.controlExpiresAt <= Date.now()
      )
        throw new SalesError(
          'LISTING_UNAVAILABLE',
          'Remove unavailable listings from this shop review.',
          409,
        );
      terms.push({
        id,
        revision: item.published.revision,
        domain: item.published.domain,
        price: item.published.publicPrice,
      });
    }
    const review = {
      id: crypto.randomUUID(),
      draft: shop.draft,
      before: shop.published,
      terms,
    };
    await db.db
      .prepare(
        'INSERT INTO sales_shop_reviews(id,revision,sealed,expires_at) VALUES(?,?,?,?)',
      )
      .bind(review.id, v.revision, await db.seal(review), Date.now() + 900_000)
      .run();
    return c.json(review);
  });
  app.post('/shop/publications', async (c) => {
    const v = z
        .object({ reviewId: revision })
        .strict()
        .parse(await c.req.json()),
      db = await SalesStore.from(c.env);
    const row = await db.db
      .prepare('SELECT * FROM sales_shop_reviews WHERE id=?')
      .bind(v.reviewId)
      .first<{
        revision: string;
        sealed: string;
        expires_at: number;
        consumed_at: number | null;
      }>();
    if (!row || row.expires_at <= Date.now())
      throw new SalesError(
        'REVIEW_EXPIRED',
        'Review the latest shop before publishing.',
        409,
      );
    if (row.consumed_at) return c.json({ ok: true });
    const review = await db.open(
      row.sealed,
      z
        .object({
          id: revision,
          draft: shopDraftSchema,
          before: shopDraftSchema.nullable(),
          terms: z.array(
            z
              .object({
                id: revision,
                revision,
                domain: z.string(),
                price: z.unknown(),
              })
              .strict(),
          ),
        })
        .strict(),
    );
    const statements = [
      ...db.guard(
        "EXISTS(SELECT 1 FROM sales_shop WHERE id='main' AND revision=?) AND EXISTS(SELECT 1 FROM sales_shop_reviews WHERE id=? AND consumed_at IS NULL)",
        [row.revision, v.reviewId],
      ),
    ];
    for (const term of review.terms)
      statements.push(
        ...db.guard(
          "EXISTS(SELECT 1 FROM published_sales p JOIN sale_drafts d ON d.id=p.id WHERE p.id=? AND p.revision=? AND d.availability='available' AND d.control_expires_at>?)",
          [term.id, term.revision, Date.now()],
        ),
      );
    statements.push(
      db.db
        .prepare("UPDATE sales_shop SET revision=?,published=? WHERE id='main'")
        .bind(crypto.randomUUID(), JSON.stringify(review.draft)),
      db.db
        .prepare('UPDATE sales_shop_reviews SET consumed_at=? WHERE id=?')
        .bind(Date.now(), v.reviewId),
    );
    await db.atomic(statements);
    return c.json({ ok: true });
  });
  app.get('/inbox', async (c) =>
    c.json(
      await (
        await inbox(c.env)
      ).list(
        c.req.query('cursor') ?? '',
        c.req.query('status') ?? '',
        c.req.query('verification') ?? '',
      ),
    ),
  );
  app.get('/inbox/:id', async (c) =>
    c.json(
      await (
        await inbox(c.env)
      ).thread(c.req.param('id'), false, c.req.query('cursor') ?? ''),
    ),
  );
  app.post('/inbox/:id/messages', async (c) => {
    const v = messageSchema.parse(await c.req.json());
    if (
      v.direction === 'reply' &&
      (c.env.SALES_MAIL_ENABLED !== 'true' || !c.get('salesRecipientVerified'))
    )
      throw new SalesError(
        'SENDING_DISABLED',
        'Email sending is disabled. Your reply draft is still here.',
        503,
      );
    return c.json(await (await inbox(c.env)).message(c.req.param('id'), v));
  });
  app.post('/inbox/:id/fresh-link', async (c) => {
    if (c.env.SALES_MAIL_ENABLED !== 'true' || !c.get('salesRecipientVerified'))
      throw new SalesError(
        'SENDING_DISABLED',
        'Email sending is disabled.',
        503,
      );
    await (await inbox(c.env)).freshLink(c.req.param('id'));
    return c.json({ ok: true });
  });
  app.patch('/inbox/:id', async (c) => {
    const v = z
      .object({
        revision,
        status: conversationStatusSchema,
        followUpAt: z.number().int().positive().nullable(),
        outcome: saleOutcomeSchema.optional(),
      })
      .strict()
      .parse(await c.req.json());
    await (
      await inbox(c.env)
    ).update(c.req.param('id'), v.revision, v.status, v.followUpAt, v.outcome);
    return c.json({ ok: true });
  });
  app.delete('/inbox/:id', async (c) => {
    const v = z
      .object({ revision })
      .strict()
      .parse(await c.req.json());
    await (await inbox(c.env)).remove(c.req.param('id'), v.revision);
    return c.json({ ok: true });
  });
  app.get('/activity', async (c) => {
    const db = await SalesStore.from(c.env),
      events = await db.db
        .prepare(
          'SELECT id,listing_id,lead_id,kind,created_at,sealed,provenance FROM sales_events ORDER BY created_at DESC LIMIT 50',
        )
        .all<{
          id: string;
          listing_id: string | null;
          lead_id: string | null;
          kind: string;
          created_at: number;
          sealed: string;
          provenance: string;
        }>();
    const items = await Promise.all(
      events.results.map(async (r) => {
        const summary =
          r.kind === 'publication'
            ? `Publication record: ${(await db.open(r.sealed, salesPublicationEventSchema)).domain}`
            : `Seller-entered outcome: ${(await db.open(r.sealed, saleOutcomeSchema)).state}`;
        return {
          id: r.id,
          listingId: r.listing_id,
          leadId: r.lead_id,
          createdAt: r.created_at,
          summary:
            (r.provenance === 'restored'
              ? 'Restored historical record · '
              : '') + summary,
        };
      }),
    );
    const deliveries = await db.db
      .prepare(
        'SELECT id,lead_id,kind,state,updated_at FROM sales_outbox ORDER BY updated_at DESC LIMIT 50',
      )
      .all<{
        id: string;
        lead_id: string;
        kind: string;
        state: string;
        updated_at: number;
      }>();
    for (const r of deliveries.results)
      items.push({
        id: r.id,
        listingId: null,
        leadId: r.lead_id,
        createdAt: r.updated_at,
        summary: `${r.kind}: ${r.state === 'accepted' ? 'Accepted by email service' : r.state}`,
      });
    return c.json({
      items: items.sort((a, b) => b.createdAt - a.createdAt).slice(0, 100),
    });
  });
  app.get('/health', async (c) => {
    const db = await SalesStore.from(c.env);
    const publications = await db.db
      .prepare(
        "SELECT p.id,p.domain,p.revision,d.availability,d.control_expires_at FROM published_sales p JOIN sale_drafts d ON d.id=p.id WHERE d.availability!='available' OR d.control_expires_at<=? ORDER BY p.id LIMIT 100",
      )
      .bind(Date.now())
      .all();
    const delivery = await db.db
      .prepare(
        "SELECT state,count(*) AS count,min(due_at) AS oldest FROM sales_outbox WHERE state NOT IN ('accepted','delivered','suppressed') GROUP BY state",
      )
      .all();
    return c.json({
      publications: publications.results,
      delivery: delivery.results,
      observedAt: Date.now(),
    });
  });
  app.post('/jobs', async (c) => {
    const v = z
      .object({
        items: z
          .array(z.object({ id: revision, revision }).strict())
          .min(1)
          .max(500),
        action: bulkActionSchema,
        requestKey: revision,
      })
      .strict()
      .parse(await c.req.json());
    return c.json(
      await new SalesJobs(await SalesStore.from(c.env)).create(
        v.items,
        v.action,
        v.requestKey,
      ),
    );
  });
  app.get('/jobs/:id/review', async (c) =>
    c.json(
      await new SalesJobs(await SalesStore.from(c.env)).review(
        c.req.param('id'),
      ),
    ),
  );
  app.post('/jobs/:id/approve', async (c) => {
    const value = z
        .object({ digest: z.string().min(20).max(128) })
        .strict()
        .parse(await c.req.json()),
      jobs = new SalesJobs(await SalesStore.from(c.env));
    await requireRecipient(
      c.env,
      c.get('salesRecipientVerified'),
      await jobs.publicationItems(c.req.param('id')),
    );
    await jobs.approve(c.req.param('id'), value.digest);
    return c.json({ ok: true });
  });
  app.get('/jobs/:id', async (c) =>
    c.json(
      await new SalesJobs(await SalesStore.from(c.env)).get(
        c.req.param('id'),
        Number(c.req.query('cursor') ?? -1),
      ),
    ),
  );
  app.get('/jobs', async (c) =>
    c.json({
      items: (
        await c.env.DB.prepare(
          'SELECT id,status,updated_at FROM sales_jobs ORDER BY updated_at DESC LIMIT 20',
        ).all()
      ).results,
    }),
  );
  app.post('/jobs/:id/step', async (c) => {
    const jobs = new SalesJobs(await SalesStore.from(c.env));
    await requireRecipient(
      c.env,
      c.get('salesRecipientVerified'),
      await jobs.publicationItems(c.req.param('id')),
    );
    return c.json(
      await jobs.step(c.req.param('id'), createSaleObserver(c.env)),
    );
  });
  // Internal scheduling endpoints live in their own purpose-gated app, never here.
  return app;
}
