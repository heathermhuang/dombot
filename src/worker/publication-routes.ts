import { Hono, type MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { aesGcmCipher } from '../core/storage/encrypted';
import {
  getCachedPortfolio,
  getRegistrarMetadata,
} from '../core/services/registrars';
import {
  reconcilePortfolio,
  publicSnapshot,
} from '../core/publication/reconcile';
import {
  isOwnerSite,
  previewOwnerSite,
  editableOwnerSiteSchema,
  convertOwnerSiteV3,
  convertOwnerSite,
  emptyOwnerSite,
} from '../shared/owner-site';
import {
  ownerSiteSnapshot,
  reconcileOwnerSite,
} from '../core/publication/owner-site';
import { renderOwnerSite } from '../shared/render-owner-site';
import { previewSnapshot } from '../shared/publication-edit';
import { draftSchema, type PublicationState } from '../shared/publication';
import { isAuthenticated, sameOrigin, type AuthConfig } from './auth';
import { deriveEncryptionKey, parseRootSecret } from './keys';
import {
  PublicationStore,
  PublicationConflict,
  PublicationInputError,
} from './publication-store';
import { renderPortfolio, publicHeaders } from './public-portfolio';
import type { PublicationInputs } from './publication-inputs';
import { SalesStore } from './sales-store';
import { publishingPresence } from './publishing-presence';
import { previewSalesLinks } from './preview-sales-links';
import { prepareChangeSetSchema } from '../shared/publication-change-set';
import { PublicationChangeSets } from './publication-change-sets';
import { createVerifiedSaleObserver } from './sales-observation';
import { verifyGatewayRequest } from '../shared/gateway-proof';
import { SalesError } from '../shared/sales-review';
import { bindSiteLinks } from './publication-links';

type PublicationEnv = {
  Bindings: Env;
  Variables: { auth: AuthConfig; publishingRecipient?: boolean };
};
const revisionSchema = z.object({ revision: z.string().uuid() }).strict();

export function createPublicationRoutes(
  stateful: MiddlewareHandler<PublicationEnv>,
  readInputs: () => PublicationInputs | null = () => null,
) {
  const app = new Hono<PublicationEnv>();
  const readInventory = new WeakMap<Request, PublicationInputs>();
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    if (!(await isAuthenticated(c.get('auth'), c.req.raw, c.env.DB)))
      return c.json({ error: 'Not signed in' }, 401);
    if (
      c.env.DOMBOT_AUTH === 'gateway' &&
      /\/change-sets(?:\/|$)/.test(c.req.path)
    ) {
      const proof = await verifyGatewayRequest(
        c.env.DOMBOT_GATEWAY_SECRET ?? '',
        c.env.DOMBOT_WORKSPACE_ID ?? '',
        c.req.raw,
      );
      if (proof?.sales?.purpose === 'sales-owner')
        c.set('publishingRecipient', proof.sales.recipientVerified);
    }
    if (c.req.method !== 'GET' && !sameOrigin(c.req.raw))
      return c.json({ error: 'Bad origin' }, 403);
    await next();
  });
  app.use(
    '*',
    bodyLimit({
      maxSize: 4 * 1024 * 1024,
      onError: (c) => c.json({ error: 'Portfolio draft is too large.' }, 413),
    }),
  );
  app.post('/site/preview-links', async (c) =>
    c.json(
      await previewSalesLinks(
        c.env.DB,
        await c.req.json(),
        c.env.DOMBOT_SALES_ORIGIN,
      ),
    ),
  );
  app.use('*', async (c, next) => {
    // Reads need no mutable service state once inventory has been hydrated.
    // Keep the authenticated read out of the provider queue; a cold start and
    // every write retain the original serialized hydrate/flush path.
    const input = c.req.method === 'GET' ? readInputs() : null;
    if (input) {
      readInventory.set(c.req.raw, input);
      return next();
    }
    return stateful(c, next);
  });
  const inputs = (c: { req: { raw: Request } }) =>
    readInventory.get(c.req.raw) ?? {
      domains: getCachedPortfolio()?.domains ?? [],
      accounts: getRegistrarMetadata(),
    };
  const store = async (env: Env) =>
    new PublicationStore(
      env.DB,
      await aesGcmCipher(
        await deriveEncryptionKey(parseRootSecret(env.DOMBOT_SECRET)),
      ),
    );
  const review = (
    draft: z.infer<typeof draftSchema>,
    input: PublicationInputs,
  ) => reconcilePortfolio(draft, input.domains, input.accounts);

  app.onError((error, c) => {
    if (error instanceof SalesError)
      return c.json({ error: error.message, code: error.code }, error.status);
    if (error instanceof PublicationInputError)
      return c.json({ error: error.message }, 400);
    if (error instanceof PublicationConflict)
      return c.json({ error: error.message }, 409);
    if (error instanceof z.ZodError)
      return c.json(
        {
          error: error.issues
            .map((i) => `${i.path.join('.')}: ${i.message}`)
            .slice(0, 3)
            .join('; '),
        },
        400,
      );
    // No database contents, credential errors, or encrypted payloads in responses.
    return c.json(
      {
        error:
          'Could not load or save the portfolio. Check the publication migration and try again.',
      },
      500,
    );
  });
  app.get('/presence', async (c) =>
    c.json(
      await publishingPresence(
        await store(c.env),
        await SalesStore.from(c.env),
        inputs(c),
        c.req.query(),
        c.env.DOMBOT_PUBLIC_BASE_PATH ?? '',
      ),
    ),
  );
  app.get('/presence/:domain', async (c) =>
    c.json(
      await publishingPresence(
        await store(c.env),
        await SalesStore.from(c.env),
        inputs(c),
        { names: JSON.stringify([c.req.param('domain')]) },
        c.env.DOMBOT_PUBLIC_BASE_PATH ?? '',
      ),
    ),
  );
  app.get('/', async (c) => {
    const db = await store(c.env);
    const { draft, revision } = await db.draft();
    const published = await db.published();
    if (isOwnerSite(draft) || (published && isOwnerSite(published.snapshot)))
      return c.json({ error: 'Use Your site to edit this version.' }, 409);
    const legacySnapshot =
      published && !isOwnerSite(published.snapshot) ? published.snapshot : null;
    const result: PublicationState = {
      draft,
      revision,
      review: review(draft, inputs(c)),
      published: published
        ? {
            handle: published.snapshot.handle,
            publishedAt: published.snapshot.publishedAt,
            count: legacySnapshot!.listings.length,
            revision: published.revision,
          }
        : null,
      publishedSnapshot: legacySnapshot,
      accounts: inputs(c)
        .accounts.filter((a) => a.saved || a.configured)
        .map((a) => ({
          label: `${a.displayName} · ${a.accountLabel ?? 'Default'}`,
          count: a.sync.domainCount,
          healthy:
            a.configured &&
            a.enabled &&
            !a.sync.lastError &&
            a.sync.lastSyncedAt !== null &&
            a.sync.lastSyncedAt <= Date.now() &&
            Date.now() - a.sync.lastSyncedAt < 86_400_000,
          lastSyncedAt: a.sync.lastSyncedAt,
        })),
    };
    return c.json(result);
  });
  app.get('/site', async (c) => {
    const db = await store(c.env);
    const saved = await db.draft();
    const published = await db.published();
    return c.json({
      ...saved,
      enabled:
        isOwnerSite(saved.draft) && saved.draft.version === 3
          ? c.env.DOMBOT_OWNER_SITE_V3 === 'true'
          : c.env.DOMBOT_OWNER_SITE_V2 === 'true',
      v3Enabled: c.env.DOMBOT_OWNER_SITE_V3 === 'true',
      compositeEnabled: c.env.DOMBOT_COMPOSITE_PUBLISH === 'true',
      publishedRevision: published?.revision ?? null,
      publishedSnapshot: published?.snapshot ?? null,
      review: isOwnerSite(saved.draft)
        ? reconcileOwnerSite(saved.draft, inputs(c).domains, inputs(c).accounts)
        : review(saved.draft, inputs(c)),
    });
  });
  app.put('/site', async (c) => {
    const input = z
      .object({
        draft: editableOwnerSiteSchema,
        revision: z.string().uuid().nullable(),
      })
      .strict()
      .parse(await c.req.json());
    if (
      (input.draft.version === 3
        ? c.env.DOMBOT_OWNER_SITE_V3
        : c.env.DOMBOT_OWNER_SITE_V2) !== 'true'
    )
      return c.json({ error: 'Site editing is currently disabled.' }, 403);
    const db = await store(c.env);
    const saved = await db.draft();
    if (!isOwnerSite(saved.draft) && saved.revision)
      return c.json(
        { error: 'Review the legacy conversion before saving.' },
        409,
      );
    return c.json({ revision: await db.save(input.draft, input.revision) });
  });
  app.post('/site/convert', async (c) => {
    if (c.env.DOMBOT_OWNER_SITE_V2 !== 'true')
      return c.json({ error: 'Site editing is currently disabled.' }, 403);
    const { revision } = z
      .object({ revision: z.string().uuid().nullable() })
      .strict()
      .parse(await c.req.json());
    const db = await store(c.env);
    const saved = await db.draft();
    if (saved.revision !== revision) throw new PublicationConflict();
    const draft = saved.revision
      ? convertOwnerSite(saved.draft)
      : emptyOwnerSite();
    return c.json({ revision: await db.save(draft, revision) });
  });
  app.post('/site/convert-v3', async (c) => {
    if (c.env.DOMBOT_OWNER_SITE_V3 !== 'true')
      return c.json({ error: 'V3 editing is disabled.' }, 403);
    const { revision } = z
      .object({ revision: z.string().uuid() })
      .strict()
      .parse(await c.req.json());
    const db = await store(c.env),
      saved = await db.draft();
    if (saved.revision !== revision) throw new PublicationConflict();
    return c.json({
      revision: await db.save(convertOwnerSiteV3(saved.draft), revision),
    });
  });
  const coordinator = async (env: Env) =>
    new PublicationChangeSets(
      await store(env),
      await SalesStore.from(env),
      env.DOMBOT_WORKSPACE_ID ?? 'self-hosted',
      env.DOMBOT_SALES_ORIGIN,
    );
  const authority = async (c: {
    env: Env;
    get(name: 'publishingRecipient'): boolean | undefined;
  }) => {
    let recipient = c.env.DOMBOT_AUTH !== 'gateway';
    if (c.env.DOMBOT_AUTH === 'gateway') {
      const admission = c.get('publishingRecipient');
      if (admission === undefined)
        throw new SalesError(
          'ADMISSION',
          'Publishing owner admission is required.',
          403,
        );
      recipient = admission;
    }
    return JSON.stringify({
      tenant: c.env.DOMBOT_WORKSPACE_ID ?? 'self-hosted',
      recipient,
      v3: c.env.DOMBOT_OWNER_SITE_V3 === 'true',
      composite: c.env.DOMBOT_COMPOSITE_PUBLISH === 'true',
      sales: c.env.DOMBOT_SALES_V1 === 'true',
    });
  };
  app.post('/change-sets/review', async (c) => {
    const body = prepareChangeSetSchema.parse(await c.req.json());
    if (
      body?.operation?.kind !== 'withdraw' &&
      c.env.DOMBOT_COMPOSITE_PUBLISH !== 'true'
    )
      return c.json({ error: 'Combined publication is disabled.' }, 403);
    const auth = await authority(c);
    if (body?.operation?.kind === 'publish') {
      if (body.operation.sales?.length && c.env.DOMBOT_SALES_V1 !== 'true')
        return c.json(
          {
            error:
              'Enable Sales and verify the inquiry recipient before combined publication.',
          },
          409,
        );
      const draft = (await (await store(c.env)).draft()).draft;
      if (
        isOwnerSite(draft) &&
        (draft.version === 3
          ? c.env.DOMBOT_OWNER_SITE_V3
          : c.env.DOMBOT_OWNER_SITE_V2) !== 'true'
      )
        return c.json({ error: 'Site editing is disabled.' }, 403);
    }
    const m = await (
      await coordinator(c.env)
    ).prepare(body, inputs(c), createVerifiedSaleObserver(c.env), auth);
    if (body.operation.kind === 'publish' && !JSON.parse(auth).recipient) {
      const sales = await SalesStore.from(c.env);
      const changed = m.salesReviewId
        ? (await sales.review(m.salesReviewId)).items.map((i) => i.after)
        : [];
      if (m.after && isOwnerSite(m.after) && m.after.version === 3)
        for (const link of m.after.salesLinks) {
          if (
            !body.operation.domains.includes(
              m.after.domainPresentations.find(
                (d) => d.id === link.presentationId,
              )?.domain ?? '',
            )
          )
            continue;
          const current =
            changed.find((s) => s.id === link.listingId) ??
            (await sales.get(link.listingId)).published;
          if (current) changed.push(current);
        }
      if (
        changed.some(
          (s) => s.allowQuestions || ['inquiry', 'offer'].includes(s.mode),
        )
      )
        return c.json(
          {
            error:
              'Verify the inquiry recipient before linking or publishing inquiry paths.',
          },
          409,
        );
    }
    return c.json(m);
  });
  app.post('/change-sets/:id/commit', async (c) => {
    const { requestKey } = z
      .object({ requestKey: z.string().uuid() })
      .strict()
      .parse(await c.req.json());
    const db = await coordinator(c.env);
    const receipt = await db.receipt(c.req.param('id'), requestKey);
    if (receipt) return c.json(receipt);
    const m = await db.get(c.req.param('id'));
    if (
      m.request.operation.kind !== 'withdraw' &&
      c.env.DOMBOT_COMPOSITE_PUBLISH !== 'true'
    )
      return c.json({ error: 'Combined publication is disabled.' }, 403);
    return c.json(
      await db.commit(
        m.id,
        requestKey,
        inputs(c),
        createVerifiedSaleObserver(c.env),
        await authority(c),
      ),
    );
  });
  app.get('/change-sets/:id/receipt', async (c) =>
    c.json(
      await (
        await coordinator(c.env)
      ).receipt(
        c.req.param('id'),
        z.string().uuid().parse(c.req.query('requestKey')),
      ),
    ),
  );
  app.put('/', async (c) => {
    const input = z
      .object({ draft: draftSchema, revision: z.string().uuid().nullable() })
      .strict()
      .parse(await c.req.json());
    const db = await store(c.env);
    if (isOwnerSite((await db.draft()).draft))
      return c.json({ error: 'Use Your site to edit this version.' }, 409);
    return c.json({ revision: await db.save(input.draft, input.revision) });
  });
  app.get('/preview', async (c) => {
    const { draft } = await (await store(c.env)).draft();
    try {
      if (isOwnerSite(draft))
        return c.html(
          renderOwnerSite(previewOwnerSite(draft), new URL(c.req.url), true),
          200,
          publicHeaders,
        );
      return c.html(
        renderPortfolio(
          previewSnapshot(draftSchema.parse(draft)),
          new URL(c.req.url),
          true,
        ),
        200,
        publicHeaders,
      );
    } catch (err) {
      if (err instanceof z.ZodError) throw err;
      return c.text(
        err instanceof Error
          ? err.message
          : 'Review the draft before previewing.',
        400,
        publicHeaders,
      );
    }
  });
  app.post('/publish', async (c) => {
    const { revision } = revisionSchema.parse(await c.req.json());
    const db = await store(c.env);
    const saved = await db.draft();
    if (saved.revision !== revision) throw new PublicationConflict();
    let snapshot;
    try {
      if (isOwnerSite(saved.draft)) {
        if (
          (saved.draft.version === 3
            ? c.env.DOMBOT_OWNER_SITE_V3
            : c.env.DOMBOT_OWNER_SITE_V2) !== 'true'
        )
          return c.json(
            {
              error:
                'Site editing is currently disabled. Export or unpublish remains available.',
            },
            403,
          );
        if (saved.draft.version === 3 && saved.draft.salesLinks.length)
          return c.json(
            {
              error:
                'Use the revision-bound combined review for linked content.',
            },
            409,
          );
        ownerSiteSnapshot(
          saved.draft.version === 3
            ? { ...saved.draft, salesLinks: [] }
            : saved.draft,
          reconcileOwnerSite(
            saved.draft,
            getCachedPortfolio()?.domains ?? [],
            getRegistrarMetadata(),
          ),
        );
        snapshot = await bindSiteLinks(c.env.DB, saved.draft);
      } else
        snapshot = publicSnapshot(saved.draft, review(saved.draft, inputs(c)));
    } catch (err) {
      return c.json(
        {
          error:
            err instanceof Error ? err.message : 'Review selected domains.',
        },
        400,
      );
    }
    if (!isOwnerSite(snapshot) && !snapshot.listings.length)
      return c.json(
        {
          error: 'Select at least one domain, or unpublish the existing page.',
        },
        400,
      );
    await db.publish(snapshot, revision);
    return c.json({ url: `/p/${snapshot.handle}` });
  });
  app.post('/unpublish', async (c) => {
    const { revision } = revisionSchema.parse(await c.req.json());
    const next = await (await store(c.env)).unpublish(revision);
    return c.json({ ok: true, revision: next });
  });
  return app;
}
