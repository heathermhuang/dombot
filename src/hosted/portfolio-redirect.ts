/** Canonicalize the old public portfolio without passing traffic to DomBot. */
export default {
  fetch(request: Request): Response {
    const url = new URL(request.url);
    if (url.hostname !== 'www.domains.domains')
      return new Response('Not found', { status: 404 });
    url.protocol = 'https:';
    url.hostname = 'domains.domains';
    url.port = '';
    return new Response(null, {
      status: 308,
      headers: { Location: url.href, 'Cache-Control': 'public, max-age=300' },
    });
  },
};
