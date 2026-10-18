import { Hono } from 'hono';
import { anyPublishedSchema, isOwnerSite } from '../shared/owner-site';
import { renderOwnerSite } from '../shared/render-owner-site';
import { renderPortfolio, publicHeaders } from '../shared/render-portfolio';
export { renderPortfolio, publicHeaders } from '../shared/render-portfolio';

/** Mounted BEFORE private boot. It does not derive keys or hydrate private stores. */
export function createPublicPortfolioRoutes() {
  const app = new Hono<{ Bindings: Env }>();
  app.on('GET', ['/p/:handle', '/p/:handle/c/:slug'], async (c) => {
    const handle = c.req.param('handle') ?? '';
    if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(handle))
      return c.text('Portfolio not found', 404, publicHeaders);
    const row = await c.env.DB.prepare(
      'SELECT payload FROM published_portfolios WHERE handle = ?1',
    )
      .bind(handle)
      .first<{ payload: string }>();
    if (!row) return c.text('Portfolio not found', 404, publicHeaders);
    let payload: unknown;
    try {
      payload = JSON.parse(row.payload);
    } catch {
      return c.text('Portfolio unavailable', 503, publicHeaders);
    }
    const parsed = anyPublishedSchema.safeParse(payload);
    if (!parsed.success)
      return c.text('Portfolio unavailable', 503, publicHeaders);
    if (isOwnerSite(parsed.data)) {
      const slug = c.req.param('slug');
      const queryCollection = new URL(c.req.url).searchParams.get('collection');
      if (
        (slug && !parsed.data.collections.some((v) => v.slug === slug)) ||
        (queryCollection !== null &&
          !parsed.data.collections.some(
            (v) => v.slug === queryCollection || v.title === queryCollection,
          ))
      )
        return c.text('Collection not found', 404, publicHeaders);
      const url = new URL(c.req.url);
      url.pathname = (c.env.DOMBOT_PUBLIC_BASE_PATH ?? '') + url.pathname;
      return c.html(renderOwnerSite(parsed.data, url), 200, publicHeaders);
    }
    if (c.req.param('slug'))
      return c.text('Collection not found', 404, publicHeaders);
    return c.html(
      renderPortfolio(parsed.data, new URL(c.req.url)),
      200,
      publicHeaders,
    );
  });
  return app;
}
