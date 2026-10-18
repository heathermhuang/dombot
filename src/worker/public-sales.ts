import { publicShop, publicSalesCsv } from './sales-shop';
import {
  salesFormScript,
  salesFormScriptPath,
} from '../shared/sales-form-script';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { canonicalDomain } from '../shared/publication';
import { inquirySchema, salePriceLabel } from '../shared/sales';
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
          ? { inquiryPath: '/inquiries' }
          : {},
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
            `<h1>Check your email to confirm this inquiry.</h1><p>Reference ${e(receipt!.id)}</p><p>We saved your message. ${c.env.SALES_MAIL_ENABLED === 'true' ? 'Confirming your email lets the seller reply.' : 'Email delivery is temporarily unavailable; your message is queued.'}</p>`,
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
          ? `<h1>Confirm your inquiry</h1><p>This verifies your email for this conversation. It gives no access to a seller account.</p><form method="post" action="${e(base(c))}/i/${e(c.req.param('token'))}/confirm"><button>Confirm inquiry</button></form>`
          : '<h1>This link expired or was revoked.</h1>',
      ),
      grant ? 200 : 403,
    );
  });
  app.post('/i/:token/confirm', async (c) => {
    await (await inbox(c.env)).confirm(c.req.param('token'));
    return c.html(
      salesPage(
        'Inquiry confirmed',
        '<h1>Your inquiry has been confirmed.</h1><p>The seller can now reply. We’ll email a secure conversation link when they do.</p>',
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
        `<span class="eyebrow">Private conversation</span><h1>${e(thread.original.snapshot.domain)}</h1><p class="note">Forwarding this link shares this conversation until it expires or is revoked.</p><p class="message">${e(thread.original.message)}</p>${thread.messages.map((m) => `<p><strong>${m.direction === 'reply' ? 'Seller reply' : 'Your message'}</strong></p><p class="message">${e(m.body)}</p>`).join('')}${thread.cursor ? `<a href="?cursor=${e(thread.cursor)}">More messages</a>` : ''}<form method="post" action="${e(base(c))}/t/${e(raw)}/messages"><input type="hidden" name="idempotencyKey" value="${crypto.randomUUID()}"><label for="body">Your reply</label><textarea id="body" name="body" maxlength="4000" required></textarea><button>Send message</button></form>`,
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
        `<span class="eyebrow">Selected domains</span><h1>${e(shop.title)}</h1><p>${e(shop.intro)}</p><form><label for="q">Find a domain</label><input id="q" name="q" value="${e(f.q)}"><label for="mode">Sale mode</label><select id="mode" name="mode"><option value="">All modes</option>${['inquiry', 'offer', 'buy-now', 'external'].map((m) => `<option ${f.mode === m ? 'selected' : ''}>${m}</option>`).join('')}</select><label for="tld">Extension</label><input id="tld" name="tld" value="${e(f.tld)}"><label for="category">Category</label><input id="category" name="category" value="${e(f.category)}"><label for="currency">Price currency</label><input id="currency" name="currency" maxlength="3" value="${e(f.currency)}"><label for="min">Minimum asking amount</label><input id="min" name="min" inputmode="numeric" value="${e(f.min)}"><label for="max">Maximum asking amount</label><input id="max" name="max" inputmode="numeric" value="${e(f.max)}"><button>Search</button> <a href="?">Reset</a></form><p><a href="${e(base(c))}/shop/${e(shop.handle)}/export?${e(exportQuery.toString())}">Download these results as CSV (up to 100)</a></p><table class="ledger"><thead><tr><th>Domain</th><th>Price</th><th>Sales path</th></tr></thead><tbody>${items.map((s) => `<tr><td><a href="${e(base(c))}/d/${e(s.domain)}">${e(s.displayName)}</a></td><td>${e(salePriceLabel(s.publicPrice))}</td><td>${e(s.mode)}</td></tr>`).join('')}</tbody></table>${!items.length ? '<p>No matching domains. Adjust your filters or Reset.</p>' : ''}${cursor ? `<a href="?${e(values.toString())}">Next page</a>` : ''}`,
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
