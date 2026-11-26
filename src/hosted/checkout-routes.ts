import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { Accounts } from './accounts';
import {
  checkoutCaseSchema,
  checkoutThreadToken,
} from './checkout-case-schema';
import {
  findCheckoutCase,
  readCheckoutQuote,
  stagingCheckout,
  verifyCheckoutCase,
} from './checkout-case';
import { CheckoutCoordinator } from './checkout-coordinator';
import {
  CheckoutConflict,
  CheckoutReservations,
  type CheckoutReservation,
} from './checkout-reservations';
import {
  CheckoutSimulatorProvider,
  simulatorProviderId,
} from './checkout-simulator-provider';
import { salePriceLabel } from '../shared/hosted-sales';
import { escapeHtml, page } from './views';

type Session = (
  request: Request,
  env: HostedEnv,
) => ReturnType<Accounts['session']>;
const approvalSchema = checkoutCaseSchema
  .omit({ thread: true })
  .extend({
    approval: z.uuid(),
    expiresAt: z.number().int(),
  })
  .strict();
const eligibility = (row: CheckoutReservation) => ({
  caseId: row.case_id,
  domain: row.domain,
  listing: row.listing_id,
  revision: row.listing_revision,
  price: { currency: row.currency, amount: row.amount },
});

function coordinator(env: HostedEnv, workspace: string, thread?: string) {
  return new CheckoutCoordinator(
    new CheckoutReservations(env.CONTROL_DB),
    new CheckoutSimulatorProvider(
      env.CHECKOUT_SIMULATOR!,
      env.CHECKOUT_SIMULATOR_KEY!,
      env.CANONICAL_ORIGIN!,
    ),
    (row) =>
      verifyCheckoutCase(env, workspace, { ...eligibility(row), thread }),
  );
}

export function checkoutRoutes(session: Session) {
  const app = new Hono<{ Bindings: HostedEnv }>();
  const canonicalPost = (request: Request) =>
    request.headers.get('Origin') === new URL(request.url).origin;

  app.use('/checkout/staging/*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    if (
      !stagingCheckout(c.env, c.env.CHECKOUT_STAGING_WORKSPACE ?? '') ||
      new URL(c.req.url).origin !== c.env.CANONICAL_ORIGIN
    )
      return c.notFound();
    await next();
  });

  app.get('/checkout/staging/approve', async (c) => {
    const user = await session(c.req.raw, c.env);
    if (!user || !stagingCheckout(c.env, user.workspace_id))
      return c.notFound();
    const caseId = z.uuid().safeParse(c.req.query('case'));
    if (!caseId.success)
      return c.html(
        page(
          'Approve staging checkout',
          '<h1>Approve staging checkout</h1><form method="get"><label>Sales Inbox case reference<input name="case" required></label><button>Review checkout</button></form>',
        ),
      );
    const terms = await readCheckoutQuote(
      c.env,
      user.workspace_id,
      caseId.data,
    );
    if (!terms) return c.text('This case has no current checkout terms.', 409);
    const input = (name: string, value: string) =>
      '<input type="hidden" name="' +
      name +
      '" value="' +
      escapeHtml(value) +
      '">';
    return c.html(
      page(
        'Review staging checkout',
        '<h1>Review staging checkout</h1><p>' +
          escapeHtml(terms.domain) +
          ' · ' +
          escapeHtml(salePriceLabel(terms.price)) +
          '</p><p>Sales Inbox case ' +
          escapeHtml(terms.caseId) +
          '</p><p>This approval expires in 15 minutes.</p><form method="post">' +
          input('caseId', terms.caseId) +
          input('domain', terms.domain) +
          input('listing', terms.listing) +
          input('revision', terms.revision) +
          input('amount', terms.price.amount) +
          input('currency', terms.price.currency) +
          input('approval', crypto.randomUUID()) +
          input('expiresAt', String(Date.now() + 15 * 60_000)) +
          '<button>Approve staging checkout</button></form>',
      ),
    );
  });
  app.post(
    '/checkout/staging/approve',
    bodyLimit({ maxSize: 2048 }),
    async (c) => {
      if (!canonicalPost(c.req.raw)) return c.text('Bad origin', 403);
      const user = await session(c.req.raw, c.env);
      if (!user || !stagingCheckout(c.env, user.workspace_id))
        return c.notFound();
      const json = c.req.header('Content-Type')?.includes('application/json');
      const fields = json ? null : await c.req.parseBody();
      const approved = approvalSchema.safeParse(
        json
          ? await c.req.json().catch(() => null)
          : {
              caseId: fields!.caseId,
              domain: fields!.domain,
              listing: fields!.listing,
              revision: fields!.revision,
              price: { amount: fields!.amount, currency: fields!.currency },
              approval: fields!.approval,
              expiresAt: Number(fields!.expiresAt),
            },
      );
      if (!approved.success) return c.text('Invalid checkout approval', 400);
      const { approval, expiresAt, ...terms } = approved.data;
      if (!(await verifyCheckoutCase(c.env, user.workspace_id, terms)))
        return c.text('Review the case and current listing terms.', 409);
      const { caseId, domain, listing, revision, price } = terms;
      const row = await coordinator(c.env, user.workspace_id).approve({
        domain,
        listing,
        revision,
        price,
        approval,
        expiresAt,
        case: caseId,
        seller: user.id,
        workspace: user.workspace_id,
        provider: simulatorProviderId,
      });
      return json
        ? c.json({ id: row.id, state: row.state })
        : c.html(
            page(
              'Staging checkout approved',
              '<h1>Staging checkout approved</h1><p>The verified buyer can open the simulator from their private conversation.</p><p>Reservation ' +
                escapeHtml(row.id) +
                '</p>',
            ),
          );
    },
  );

  app.post('/checkout/staging/cancel/:id', async (c) => {
    if (!canonicalPost(c.req.raw)) return c.text('Bad origin', 403);
    const user = await session(c.req.raw, c.env);
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!user || !stagingCheckout(c.env, user.workspace_id) || !id.success)
      return c.notFound();
    const flow = coordinator(c.env, user.workspace_id);
    const row = await flow.reservations.get(id.data);
    if (
      !row ||
      row.workspace_id !== user.workspace_id ||
      row.seller_id !== user.id
    )
      return c.notFound();
    return c.json({ state: (await flow.cancel(row.id)).state });
  });

  app.post(
    '/checkout/staging/buyer',
    bodyLimit({ maxSize: 1024 }),
    async (c) => {
      if (!canonicalPost(c.req.raw)) return c.text('Bad origin', 403);
      const data = z
        .object({ id: z.uuid(), thread: checkoutThreadToken })
        .strict()
        .safeParse(await c.req.parseBody());
      if (!data.success) return c.notFound();
      const workspace = c.env.CHECKOUT_STAGING_WORKSPACE!;
      const flow = coordinator(c.env, workspace, data.data.thread);
      const row = await flow.reservations.get(data.data.id);
      if (
        !row ||
        row.workspace_id !== workspace ||
        !(await verifyCheckoutCase(c.env, workspace, {
          ...eligibility(row),
          thread: data.data.thread,
        }))
      )
        return c.notFound();
      const result = await flow.open(row.id);
      return result.checkoutUrl
        ? c.redirect(result.checkoutUrl, 303)
        : c.text('This reservation can no longer open checkout.', 409);
    },
  );

  app.post(
    '/checkout/staging/callback',
    bodyLimit({ maxSize: 1024 }),
    async (c) => {
      const result = await coordinator(
        c.env,
        c.env.CHECKOUT_STAGING_WORKSPACE!,
      ).callback(c.req.raw);
      return result ? c.body(null, 204) : c.text('Invalid callback', 403);
    },
  );

  app.get('/checkout/staging/session/:id', (c) =>
    z.uuid().safeParse(c.req.param('id')).success
      ? c.html(
          page(
            'Staging escrow',
            '<h1>Staging escrow</h1><p>This simulator does not collect payments or transfer domains.</p>',
          ),
        )
      : c.notFound(),
  );

  app.onError((error, c) =>
    error instanceof CheckoutConflict
      ? c.text(error.message, 409)
      : c.text(
          'Checkout state is temporarily unavailable. Retry to check the original reservation.',
          503,
        ),
  );
  return app;
}

export async function stagingBuyerCheckout(
  env: HostedEnv,
  workspace: string,
  thread: string,
) {
  if (
    !stagingCheckout(env, workspace) ||
    !checkoutThreadToken.safeParse(thread).success
  )
    return '';
  const caseId = await findCheckoutCase(env, workspace, thread);
  if (!caseId) return '';
  const row = await env.CONTROL_DB.prepare(
    "SELECT * FROM checkout_reservations WHERE workspace_id=? AND case_id=? AND provider=? AND state IN ('held','creating','open') AND expires_at>? LIMIT 1",
  )
    .bind(workspace, caseId, simulatorProviderId, Date.now())
    .first<CheckoutReservation>();
  if (
    row &&
    (await verifyCheckoutCase(env, workspace, { ...eligibility(row), thread }))
  )
    return (
      '<form method="post" action="/checkout/staging/buyer"><p>Approved staging checkout · ' +
      escapeHtml(
        salePriceLabel({ amount: row.amount, currency: row.currency }),
      ) +
      '</p><input type="hidden" name="id" value="' +
      escapeHtml(row.id) +
      '"><input type="hidden" name="thread" value="' +
      escapeHtml(thread) +
      '"><button>Open staging checkout</button></form>'
    );
  return '';
}

export async function reconcileStagingCheckout(env: HostedEnv) {
  const workspace = env.CHECKOUT_STAGING_WORKSPACE;
  if (!workspace || !stagingCheckout(env, workspace)) return;
  const flow = coordinator(env, workspace);
  const candidates = await env.CONTROL_DB.prepare(
    `SELECT c.* FROM checkout_reservations c LEFT JOIN public_domain_routes r ON r.domain=c.domain
     WHERE c.workspace_id=? AND c.provider=? AND c.state IN ('held','creating','open','canceling')
       AND (c.state='canceling' OR c.expires_at<=? OR r.state IS NOT 'active' OR r.revision IS NOT c.listing_revision
         OR r.generation IS NOT c.listing_generation OR r.workspace_id IS NOT c.workspace_id)
     ORDER BY c.expires_at LIMIT 10`,
  )
    .bind(workspace, simulatorProviderId, Date.now())
    .all<CheckoutReservation>();
  const results = await Promise.allSettled(
    candidates.results.map((row) => flow.cancel(row.id)),
  );
  if (results.some((result) => result.status === 'rejected'))
    throw new Error('Staging checkout needs reconciliation');
}
