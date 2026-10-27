import { anyPublishedSchema, isOwnerSite } from '../shared/owner-site';
import { renderOwnerSite } from '../shared/render-owner-site';
import { renderPortfolio, publicHeaders } from '../shared/render-portfolio';

/** Reads the published row directly: no private stores, decryption or registrar I/O. */
export async function publicSite(
  request: Request,
  db: D1Database,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.searchParams.get('__public_path');
  if (!path || !/^\/[a-z0-9-]+(?:\/c\/[a-z0-9-]+)?$/.test(path))
    return new Response('Profile not found', {
      status: 404,
      headers: publicHeaders,
    });
  const row = await db
    .prepare("SELECT payload FROM published_portfolios WHERE id='main'")
    .first<{ payload: string }>();
  if (!row)
    return new Response('Profile not found', {
      status: 404,
      headers: publicHeaders,
    });
  let raw: unknown;
  try {
    raw = JSON.parse(row.payload);
  } catch {
    return new Response('Profile unavailable', {
      status: 503,
      headers: publicHeaders,
    });
  }
  const parsed = anyPublishedSchema.safeParse(raw);
  if (!parsed.success)
    return new Response('Profile unavailable', {
      status: 503,
      headers: publicHeaders,
    });
  url.pathname = path;
  url.searchParams.delete('__public_path');
  if (isOwnerSite(parsed.data)) {
    const slug = path.match(/\/c\/([^/]+)$/)?.[1];
    const collection = slug ?? url.searchParams.get('collection');
    if (
      collection != null &&
      !parsed.data.collections.some(
        (c) => c.slug === collection || (!slug && c.title === collection),
      )
    )
      return new Response('Collection not found', {
        status: 404,
        headers: publicHeaders,
      });
    return new Response(renderOwnerSite(parsed.data, url), {
      headers: { ...publicHeaders, 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
  if (path.includes('/c/'))
    return new Response('Collection not found', {
      status: 404,
      headers: publicHeaders,
    });
  return new Response(renderPortfolio(parsed.data, url), {
    headers: { ...publicHeaders, 'Content-Type': 'text/html; charset=utf-8' },
  });
}
