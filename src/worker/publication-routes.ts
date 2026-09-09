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
import { draftSchema, type PublicationState } from '../shared/publication';
import { isAuthenticated, sameOrigin, type AuthConfig } from './auth';
import { deriveEncryptionKey, parseRootSecret } from './keys';
import { PublicationStore, PublicationConflict } from './publication-store';
import { renderPortfolio, publicHeaders } from './public-portfolio';

type PublicationEnv = { Bindings: Env; Variables: { auth: AuthConfig } };
const revisionSchema = z.object({ revision: z.string().uuid() }).strict();

export function createPublicationRoutes(
  stateful: MiddlewareHandler<PublicationEnv>,
) {
  const app = new Hono<PublicationEnv>();
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    if (!(await isAuthenticated(c.get('auth'), c.req.raw)))
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
  app.use('*', stateful);
  const store = async (env: Env) =>
    new PublicationStore(
      env.DB,
      await aesGcmCipher(
        await deriveEncryptionKey(parseRootSecret(env.DOMBOT_SECRET)),
      ),
    );
  const review = (draft: z.infer<typeof draftSchema>) =>
    reconcilePortfolio(
      draft,
      getCachedPortfolio()?.domains ?? [],
      getRegistrarMetadata(),
    );

  app.onError((error, c) => {
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
    const result: PublicationState = {
      draft,
      revision,
      review: review(draft),
      published: published
        ? {
            handle: published.snapshot.handle,
            publishedAt: published.snapshot.publishedAt,
            count: published.snapshot.listings.length,
            revision: published.revision,
          }
        : null,
      accounts: getRegistrarMetadata()
        .filter((a) => a.saved || a.configured)
        .map((a) => ({
          label: `${a.displayName} · ${a.accountLabel ?? 'Default'}`,
          count: a.sync.domainCount,
          healthy:
            a.configured &&
            a.enabled &&
            !a.sync.lastError &&
            a.sync.lastSyncedAt !== null &&
            Date.now() - a.sync.lastSyncedAt < 86_400_000,
          lastSyncedAt: a.sync.lastSyncedAt,
        })),
    };
    return c.json(result);
  });
  app.put('/', async (c) => {
    const input = z
      .object({ draft: draftSchema, revision: z.string().uuid().nullable() })
      .strict()
      .parse(await c.req.json());
    return c.json({
      revision: await (await store(c.env)).save(input.draft, input.revision),
    });
  });
  app.get('/preview', async (c) => {
    const { draft } = await (await store(c.env)).draft();
    try {
      return c.html(
        renderPortfolio(
          publicSnapshot(draft, review(draft)),
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
      snapshot = publicSnapshot(saved.draft, review(saved.draft));
    } catch (err) {
      return c.json(
        {
          error:
            err instanceof Error ? err.message : 'Review selected domains.',
        },
        400,
      );
    }
    if (!snapshot.listings.length)
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
    await (await store(c.env)).unpublish(revision);
    return c.json({ ok: true });
  });
  return app;
}
