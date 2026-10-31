import { publishedBacklinks } from './publication-links';
import { publicShop, publicSalesCsv } from './sales-shop';
import {
  salesFormScript,
  salesFormScriptPath,
} from '../shared/sales-form-script';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { canonicalDomain } from '../shared/publication';
import { inquirySchema, salePriceLabel, saleModeLabel } from '../shared/sales';
import {
  renderSalesLander,
  salesPage,
  salesEscape as e,
  salesHeaders,
} from '../shared/render-sales-lander';
import { verifyTenantAdmission } from '../shared/gateway-proof';
import { SalesError } from '../shared/sales-review';
import { SalesStore, readPublicSale } from './sales-store';
import { SalesInquiryStore, tokenHash } from './sales-inquiry-store';
import { brandFontBytes, brandFontPath } from '../shared/brand-font';

export function createPublicSalesRoutes() {
  const app = new Hono<{
    Bindings: Env;
    Variables: { salesBase: string; customSalesHost: boolean };
  }>();
  app.get(salesFormScriptPath, (c) =>
    c.body(salesFormScript, 200, {
      'Content-Type': 'text/javascript',
      'Cache-Control': 'public,max-age=3600',
    }),
  );
  app.get(
    brandFontPath,
    () =>
      new Response(brandFontBytes, {
        headers: {
          'Content-Type': 'font/woff2',
          'Cache-Control': 'public,max-age=31536000,immutable',
        },
      }),
  );
  const patterns = ['/d/*', '/i/*', '/t/*', '/shop/*'];
  for (const path of patterns)
    app.use(path, async (c, next) => {
      c.set('salesBase', c.env.DOMBOT_PUBLIC_BASE_PATH ?? '');
      c.set('customSalesHost', false);
      for (const [k, v] of Object.entries(salesHeaders)) c.header(k, v);
      if (c.env.DOMBOT_AUTH === 'gateway') {
        const proof = await verifyTenantAdmission(c.env, c.req.raw);
        if (
          proof?.sales?.purpose !== 'sales-public' ||
          proof.sales.host !== new URL(c.req.url).hostname
        )
          return c.text('Sales page not found', 404);
        if (proof.sales.listing) {
          c.set('salesBase', '');
          c.set('customSalesHost', true);
          const binding = await c.env.DB.prepare(
            'SELECT 1 FROM sales_host_bindings WHERE hostname=? AND listing_id=? AND epoch=? AND enabled=1',
          )
            .bind(proof.sales.host, proof.sales.listing, proof.sales.epoch)
            .first();
          if (!binding) return c.text('Sales page not found', 404);
          if (/^\/(?:i|t)\//.test(c.req.path)) {
            const raw = c.req.path.split('/')[2];
            const scoped = await c.env.DB.prepare(
              'SELECT 1 FROM sales_tokens t JOIN sales_leads l ON l.id=t.lead_id WHERE t.token_hash=? AND l.listing_id=?',
            )
              .bind(await tokenHash(raw), proof.sales.listing)
              .first();
            if (!scoped) return c.text('Conversation unavailable', 404);
          }
          const mapped = await c.env.DB.prepare(
            'SELECT domain FROM published_sales WHERE id=?',
          )
            .bind(proof.sales.listing)
            .first<{ domain: string }>();
          if (
            !mapped ||
            (c.req.path.startsWith('/d/') &&
              canonicalDomain(
                c.req.param('domain') ?? c.req.path.split('/')[2],
              ) !== mapped.domain)
          )
            return c.text('Sales page not found', 404);
        }
      }
      if (
        c.req.method === 'POST' &&
        c.req.header('origin') !== new URL(c.req.url).origin
      )
        return c.text('Bad origin', 403);
      await next();
    });
  for (const path of patterns)
    app.use(
      path,
      bodyLimit({
        maxSize: 16384,
        onError: (c) => c.text('Message is too large.', 413),
      }),
    );
  app.onError((error, c) => {
    if (error instanceof SalesError)
      return c.html(
        salesPage(
          'Please review',
          `<h1>Please review</h1><p role="alert">${e(error.message)}</p>`,
        ),
        error.status,
        salesHeaders,
      );
    if (error instanceof z.ZodError)
      return c.html(
        salesPage(
          'Check your message',
          `<h1>Check your message</h1><p role="alert">${e(
            error.issues
              .slice(0, 3)
              .map((i) =>
                i.code === 'unrecognized_keys'
                  ? 'Remove unsupported fields.'
                  : i.path.join('.') + ': ' + i.message,
              )
              .join('; '),
          )}</p>`,
        ),
        400,
        salesHeaders,
      );
    return c.html(
      salesPage(
        'Temporarily unavailable',
        '<h1>Temporarily unavailable</h1><p>Please try again later.</p>',
      ),
      503,
      salesHeaders,
    );
  });
  const inbox = async (env: Env) => {
    if (!env.DOMBOT_SALES_ORIGIN?.startsWith('https://'))
      throw new SalesError(
        'NOT_CONFIGURED',
        'Inquiry delivery is not configured.',
        503,
      );
    return new SalesInquiryStore(
      await SalesStore.from(env),
      env.DOMBOT_SALES_ORIGIN,
    );
  };
  const base = (c: { get: (key: 'salesBase') => string }) => c.get('salesBase');
  app.get('/d/:domain', async (c) => {
    const snapshot = await readPublicSale(
      c.env.DB,
      canonicalDomain(c.req.param('domain')),
    );
    if (!snapshot) return c.text('Sales page unavailable', 404, salesHeaders);
    const admission =
      c.env.DOMBOT_AUTH === 'gateway'
        ? await verifyTenantAdmission(c.env, c.req.raw)
        : null;
    c.header('X-Domains-Sales-Revision', snapshot.revision);
    return c.html(
      renderSalesLander(
        snapshot,
        base(c),
        c.env.SALES_INQUIRIES_ENABLED === 'true' &&
          c.env.SALES_PRIVACY_REVIEWED === 'true'
          ? (c.env.SALES_TURNSTILE_SITEKEY ?? null)
          : null,
        admission?.sales?.purpose === 'sales-public' && admission.sales.listing
          ? {
              backlinks: await publishedBacklinks(
                c.env.DB,
                snapshot,
                c.env.DOMBOT_SALES_ORIGIN,
              ),
              inquiryPath: '/inquiries',
              privacyUrl: new URL(
                '/privacy',
                c.env.DOMBOT_SALES_ORIGIN ?? c.req.url,
              ).href,
            }
          : {
              backlinks: await publishedBacklinks(
                c.env.DB,
                snapshot,
                c.env.DOMBOT_SALES_ORIGIN,
              ),
              privacyUrl: new URL(
                '/privacy',
                c.env.DOMBOT_SALES_ORIGIN ?? c.req.url,
              ).href,
            },
      ),
      200,
      salesHeaders,
    );
  });
  app.post('/d/:domain/inquiries', async (c) => {
    if (
      c.env.SALES_INQUIRIES_ENABLED !== 'true' ||
      c.env.SALES_PRIVACY_REVIEWED !== 'true' ||
      !c.env.SALES_TURNSTILE_SECRET
    )
      return c.text('Inquiries are temporarily unavailable.', 503);
    const s = await readPublicSale(
      c.env.DB,
      canonicalDomain(c.req.param('domain')),
    );
    if (!s) return c.text('Sales page unavailable', 404);
    const json = c.req.header('content-type')?.includes('application/json');
    const fields = json ? null : await c.req.parseBody();
    const input = inquirySchema.parse(
      json
        ? await c.req.json()
        : {
            observedRevision: fields!.observedRevision,
            idempotencyKey: fields!.idempotencyKey,
            name: fields!.name,
            email: fields!.email,
            message: fields!.message,
            website: fields!.website,
            offer:
              fields!.intent === 'offer' && fields!.amount
                ? { amount: fields!.amount, currency: fields!.currency }
                : null,
            turnstileToken: fields!['cf-turnstile-response'] ?? '',
          },
    );
    const db = await inbox(c.env),
      ip = c.req.header('cf-connecting-ip');
    if (!ip) return c.text('Cannot identify request source.', 503);
    await db.reserve(`intake:${s.id}:${ip}`, 5, 3600_000);
    const previous = await db.receipt(input, s.id);
    if (!previous && input.observedRevision !== s.revision) {
      if (json)
        return c.json(
          {
            code: 'PUBLIC_REVISION_CHANGED',
            error: 'Review the latest terms before sending.',
            current: s,
          },
          409,
        );
      const nextCurrency =
        s.publicPrice?.currency ?? s.publicMinimumOffer?.currency ?? 'USD';
      return c.html(
        renderSalesLander(s, base(c), c.env.SALES_TURNSTILE_SITEKEY ?? null, {
          ...(c.get('customSalesHost') ? { inquiryPath: '/inquiries' } : {}),
          revisionConflict: true,
          error:
            'The terms changed. Review the latest price, currency and sales path below before sending again.',
          fields: {
            name: input.name,
            email: input.email,
            message: input.message,
            amount:
              input.offer?.currency === nextCurrency ? input.offer.amount : '',
          },
        }),
        409,
        salesHeaders,
      );
    }
    let receipt = previous;
    if (!previous) {
      if (!input.turnstileToken)
        throw new SalesError(
          'CHALLENGE_REQUIRED',
          'Wait for the security check to finish, then try again. Your message is still here.',
        );
      const checked = await fetch(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        {
          method: 'POST',
          body: new URLSearchParams({
            secret: c.env.SALES_TURNSTILE_SECRET,
            response: input.turnstileToken,
            remoteip: ip,
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      const result = (await checked.json()) as {
        success?: boolean;
        hostname?: string;
        action?: string;
      };
      if (
        !result.success ||
        result.hostname !== new URL(c.req.url).hostname ||
        result.action !== 'sales-inquiry'
      ) {
        if (!json)
          return c.html(
            renderSalesLander(
              s,
              base(c),
              c.env.SALES_TURNSTILE_SITEKEY ?? null,
              {
                ...(c.get('customSalesHost')
                  ? { inquiryPath: '/inquiries' }
                  : {}),
                error:
                  'Please complete a fresh security check. Your message is still here.',
                fields: Object.fromEntries(
                  Object.entries(fields!).filter(
                    (p): p is [string, string] => typeof p[1] === 'string',
                  ),
                ),
              },
            ),
            400,
          );
        return c.json(
          {
            code: 'CHALLENGE_REQUIRED',
            error:
              'Complete a fresh security check. Your message is still here.',
          },
          400,
        );
      }
      receipt = await db.intake(input, s);
    }
    return json
      ? c.json(
          {
            ...receipt,
            delivery:
              c.env.SALES_MAIL_ENABLED === 'true'
                ? 'queued'
                : 'temporarily-unavailable',
          },
          202,
        )
      : c.html(
          salesPage(
            'Check your email',
            `<section class="flow"><span class="eyebrow">Inquiry saved</span><h1>Check your inbox.</h1><div class="panel"><p>We saved your inquiry about <strong>${e(s.domain)}</strong>.</p><p>${c.env.SALES_MAIL_ENABLED === 'true' ? `A confirmation email is on its way to <strong>${e(input.email)}</strong>.` : 'Email delivery is temporarily unavailable. Your inquiry is saved and waiting for delivery.'}</p><ol><li>Open the email from domains.domains.</li><li>Choose <strong>Confirm email address</strong>.</li><li>Continue the conversation by email.</li></ol><p class="note">Can’t see it? Check Spam or All Mail. Delivery can take a few minutes.</p></div><p class="receipt">Inquiry reference: ${e(receipt!.id)}</p></section>`,
          ),
          202,
        );
  });
  app.get('/i/:token', async (c) => {
    const db = await inbox(c.env),
      grant = await db.token(c.req.param('token'), 'verify');
    return c.html(
      salesPage(
        'Confirm inquiry',
        grant
          ? `<section class="flow"><span class="eyebrow">Email confirmation</span><h1>Ready to start the conversation?</h1><div class="panel"><p>Confirm your email so we can reply to your inquiry. This does not accept an offer or commit you to a purchase.</p><form method="post" action="${e(base(c))}/i/${e(c.req.param('token'))}/confirm"><button>Confirm email address</button></form></div></section>`
          : '<section class="flow"><h1>This link expired or was revoked.</h1><p>It can no longer confirm an inquiry. If you still want to get in touch, return to the public domain page you visited and send a new inquiry.</p><p><a class="cta" href="https://domains.domains/">Go to domains.domains</a></p><p class="note">Need help? <a href="mailto:domains@domains.domains">Contact support</a>. Do not forward private conversation links.</p></section>',
      ),
      grant ? 200 : 403,
    );
  });
  app.post('/i/:token/confirm', async (c) => {
    await (await inbox(c.env)).confirm(c.req.param('token'));
    return c.html(
      salesPage(
        'Inquiry confirmed',
        '<section class="flow"><span class="eyebrow">Email confirmed</span><h1>You’re all set.</h1><div class="panel"><p>Your inquiry is confirmed. We’ll send any reply to your inbox, with a link to this conversation.</p><p class="note">You can close this page. There’s no account to create and no purchase commitment.</p></div></section>',
      ),
    );
  });
  app.get('/t/:token', async (c) => {
    const db = await inbox(c.env),
      raw = c.req.param('token'),
      grant = await db.token(raw, 'thread');
    if (!grant || grant.verification !== 'verified' || grant.status === 'spam')
      return c.html(
        salesPage(
          'Conversation link expired',
          `<h1>This conversation link expired.</h1><form method="post" action="${e(base(c))}/t/${e(raw)}/resend"><button>Email a fresh link</button></form>`,
        ),
        403,
      );
    const thread = await db.thread(
      grant.lead_id,
      true,
      c.req.query('cursor') ?? '',
    );
    return c.html(
      salesPage(
        'Your inquiry',
        `<section class="conversation"><span class="eyebrow">Your conversation</span><h1>${e(thread.original.snapshot.domain)}</h1><p class="note">Forwarding this link shares this conversation until it expires or is revoked.</p><p class="message">${e(thread.original.message)}</p>${thread.messages.map((m) => `<article class="message"><div class="message-meta"><strong>${m.direction === 'reply' ? 'Reply' : 'You'}</strong> · <time datetime="${e(new Date(m.createdAt).toISOString())}">${e(new Date(m.createdAt).toUTCString())}</time></div><p>${e(m.body)}</p></article>`).join('')}${thread.cursor ? `<a href="?cursor=${e(thread.cursor)}">More messages</a>` : ''}<form method="post" action="${e(base(c))}/t/${e(raw)}/messages"><input type="hidden" name="idempotencyKey" value="${crypto.randomUUID()}"><label for="body">Your reply</label><textarea id="body" name="body" maxlength="4000" required></textarea><button>Send message</button></form></section>`,
      ),
    );
  });
  app.post('/t/:token/messages', async (c) => {
    const db = await inbox(c.env),
      grant = await db.token(c.req.param('token'), 'thread');
    if (!grant || grant.verification !== 'verified' || grant.status === 'spam')
      return c.text('Conversation unavailable', 403);
    await db.reserve(`buyer-message:${grant.lead_id}`, 20, 3600_000);
    const body = await c.req.parseBody(),
      lead = await db.lead(grant.lead_id);
    await db.message(lead.id, messageSchemaInput(body, lead.revision), true);
    return c.redirect(`${base(c)}/t/${c.req.param('token')}`, 303);
  });
  app.post('/t/:token/resend', async (c) => {
    await (await inbox(c.env)).resend(c.req.param('token'), 'thread');
    return c.html(
      salesPage(
        'Check your email',
        '<h1>If this conversation is eligible, we’ll email a fresh link.</h1>',
      ),
    );
  });
  app.get('/shop/:handle/export', async (c) => {
    const result = await publicShop(
      c.env.DB,
      c.req.param('handle'),
      c.req.query(),
    );
    return c.body(publicSalesCsv(result.items), 200, {
      ...salesHeaders,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="selected-domains.csv"',
      ...(result.cursor ? { 'X-Next-Cursor': result.cursor } : {}),
    });
  });
  app.get('/shop/:handle', async (c) => {
    const result = await publicShop(
        c.env.DB,
        c.req.param('handle'),
        c.req.query(),
      ),
      { shop, filters: f, items, cursor } = result;
    const values = new URLSearchParams(f),
      exportQuery = new URLSearchParams(f);
    if (cursor) values.set('cursor', cursor);
    return c.html(
      salesPage(
        shop.title,
        `<span class="eyebrow">Selected domains</span><h1>${e(shop.title)}</h1><p>${e(shop.intro)}</p>
<form class="shop-search"><label for="q">Find a domain</label><div class="shop-search-row"><input id="q" name="q" value="${e(f.q)}" placeholder="Search names or keywords"><button>Search</button></div>
<details class="shop-filters" ${Object.entries(f).some(([key, value]) => key !== 'q' && key !== 'cursor' && value) ? 'open' : ''}><summary>Advanced filters</summary><div class="shop-filter-grid">
<label for="mode">Sales path<select id="mode" name="mode"><option value="">All sales paths</option>${['inquiry', 'offer', 'buy-now', 'external'].map((m) => `<option value="${m}" ${f.mode === m ? 'selected' : ''}>${e(saleModeLabel(m))}</option>`).join('')}</select></label>
<label for="tld">Extension<input id="tld" name="tld" value="${e(f.tld)}" placeholder="e.g. com"></label><label for="category">Category<input id="category" name="category" value="${e(f.category)}" placeholder="e.g. Technology"></label><label for="currency">Price currency<input id="currency" name="currency" maxlength="3" value="${e(f.currency)}" placeholder="e.g. USD"></label><label for="min">Minimum asking amount<input id="min" name="min" inputmode="numeric" value="${e(f.min)}" placeholder="e.g. 1000"></label><label for="max">Maximum asking amount<input id="max" name="max" inputmode="numeric" value="${e(f.max)}" placeholder="e.g. 10000"></label></div><button>Apply filters</button></details></form>
<p class="shop-results">${items.length} ${items.length === 1 ? 'domain' : 'domains'} shown${cursor ? ' · More on the next page' : ''}${
          Object.entries(f).some(([key, value]) => key !== 'cursor' && value)
            ? ` · Filters: ${e(
                Object.entries(f)
                  .filter(([key, value]) => key !== 'cursor' && value)
                  .map(
                    ([key, value]) =>
                      `${({ q: 'Search', mode: 'Sales path', tld: 'Extension', category: 'Category', currency: 'Currency', min: 'Minimum', max: 'Maximum' } as Record<string, string>)[key]}: ${key === 'mode' ? saleModeLabel(value) : value}`,
                  )
                  .join(' · '),
              )} · <a href="?">Reset filters</a>`
            : ''
        }</p>
<table class="ledger"><thead><tr><th>Domain</th><th>Price</th><th>Sales path</th></tr></thead><tbody>${items.map((s) => `<tr><td><a href="${e(base(c))}/d/${e(s.domain)}">${e(s.displayName)}</a><span class="shop-mobile-mode">${e(saleModeLabel(s.mode))}</span></td><td>${e(salePriceLabel(s.publicPrice))}</td><td>${e(saleModeLabel(s.mode))}</td></tr>`).join('')}</tbody></table>${!items.length ? '<p>No matching domains. Adjust your filters or <a href="?">reset filters</a>.</p>' : ''}${cursor ? `<a class="cta secondary" href="?${e(values.toString())}">Next page</a>` : ''}<p class="note"><a href="${e(base(c))}/shop/${e(shop.handle)}/export?${e(exportQuery.toString())}">Download these results as CSV (up to 100)</a></p>`,
      ),
    );
  });

  return app;
}
function messageSchemaInput(body: Record<string, unknown>, revision: string) {
  return z
    .object({
      direction: z.literal('reply'),
      body: z.string().trim().min(1).max(4000),
      revision: z.string().uuid(),
      idempotencyKey: z.string().uuid(),
    })
    .strict()
    .parse({
      direction: 'reply',
      body: body.body,
      revision,
      idempotencyKey: body.idempotencyKey,
    });
}
