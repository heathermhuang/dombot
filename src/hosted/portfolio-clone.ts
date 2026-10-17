/** Public-only snapshot. Exact routes leave the existing self-hosted API/MCP alone. */
export default {
  async fetch(
    request: Request,
    env: { ASSETS: Fetcher; LEGACY: Fetcher },
  ): Promise<Response> {
    const url = new URL(request.url);
    if (
      !['/', '/domains', '/domains/'].includes(url.pathname) &&
      !url.pathname.startsWith('/public-portfolio/')
    )
      return env.LEGACY.fetch(request);
    if (request.method !== 'GET' && request.method !== 'HEAD')
      return new Response('Method not allowed', {
        status: 405,
        headers: { Allow: 'GET, HEAD' },
      });
    if (url.pathname === '/domains' || url.pathname === '/domains/')
      return Response.redirect(
        'https://alternative.domains/' + url.search,
        308,
      );
    if (url.pathname === '/') url.pathname = '/index.html';
    else if (!url.pathname.startsWith('/public-portfolio/'))
      return new Response('Not found', { status: 404 });
    const response = await env.ASSETS.fetch(new Request(url, request));
    const headers = new Headers(response.headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set(
      'Content-Security-Policy',
      "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    );
    return new Response(request.method === 'HEAD' ? null : response.body, {
      status: response.status,
      headers,
    });
  },
};
