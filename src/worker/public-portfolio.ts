import { Hono } from 'hono';
import { publishedSchema } from '../shared/publication';
import { renderPortfolio, publicHeaders } from '../shared/render-portfolio';
export { renderPortfolio, publicHeaders } from '../shared/render-portfolio';

/** Mounted BEFORE private boot. It does not derive keys or hydrate private stores. */
export function createPublicPortfolioRoutes() {
  const app = new Hono<{ Bindings: Env }>();
  app.get('/p/:handle', async (c) => {
    const handle = c.req.param('handle');
    if (!/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(handle))
      return c.text('Portfolio not found', 404, publicHeaders);
    const row = await c.env.DB.prepare(
      'SELECT payload FROM published_portfolios WHERE handle = ?1',
    )
      .bind(handle)
      .first<{ payload: string }>();
    if (!row) return c.text('Portfolio not found', 404, publicHeaders);
    const parsed = publishedSchema.safeParse(JSON.parse(row.payload));
    if (!parsed.success)
      return c.text('Portfolio unavailable', 503, publicHeaders);
    return c.html(
      renderPortfolio(parsed.data, new URL(c.req.url)),
      200,
      publicHeaders,
    );
  });
  return app;
}
