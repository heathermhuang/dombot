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
  selectedSite,
  ownerSiteDraftSchema,
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

type PublicationEnv = { Bindings: Env; Variables: { auth: AuthConfig } };
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
      enabled: c.env.DOMBOT_OWNER_SITE_V2 === 'true',
      publishedSnapshot: published?.snapshot ?? null,
      review: isOwnerSite(saved.draft)
        ? reconcileOwnerSite(saved.draft, inputs(c).domains, inputs(c).accounts)
        : review(saved.draft, inputs(c)),
    });
  });
  app.put('/site', async (c) => {
    if (c.env.DOMBOT_OWNER_SITE_V2 !== 'true')
      return c.json({ error: 'Site editing is currently disabled.' }, 403);
    const input = z
      .object({
        draft: ownerSiteDraftSchema,
        revision: z.string().uuid().nullable(),
      })
      .strict()
      .parse(await c.req.json());
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
          renderOwnerSite(
            { ...selectedSite(draft), publishedAt: Date.now() },
            new URL(c.req.url),
            true,
          ),
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
        if (c.env.DOMBOT_OWNER_SITE_V2 !== 'true')
          return c.json(
            {
              error:
                'Site editing is currently disabled. Export or unpublish remains available.',
            },
            403,
          );
        snapshot = ownerSiteSnapshot(
          saved.draft,
          reconcileOwnerSite(
            saved.draft,
            getCachedPortfolio()?.domains ?? [],
            getRegistrarMetadata(),
          ),
        );
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
