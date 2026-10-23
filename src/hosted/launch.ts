/** Public aliases are explicit deployment configuration, never request input. */
export function portfolioAlias(value: string | undefined): string | null {
  return value &&
    /^\/w\/[a-f0-9-]{36}\/p\/[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(value)
    ? value
    : null;
}

export function canonicalRedirect(
  request: Request,
  origin: string | undefined,
): Response | null {
  const incoming = new URL(request.url);
  // Template-only deployments still refuse credential-bearing plain HTTP.
  // Loopback remains available to local development and test servers.
  if (!origin) {
    if (
      incoming.protocol !== 'http:' ||
      ['localhost', '127.0.0.1', '[::1]'].includes(incoming.hostname)
    )
      return null;
    const secure = new URL(incoming);
    secure.protocol = 'https:';
    origin = secure.origin;
  }
  const configured = new URL(origin);
  if (configured.protocol !== 'https:' || configured.origin !== origin)
    throw new Error('Canonical origin must be an HTTPS origin');
  if (incoming.origin === origin) return null;
  // Do not forward request bodies, cookies or stale OAuth grants between hosts.
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return Response.json(
      { error: 'Use the canonical service origin', origin },
      { status: 421, headers: { 'Cache-Control': 'no-store' } },
    );
  return new Response(null, {
    status: 308,
    headers: {
      Location: origin + incoming.pathname + incoming.search,
      'Cache-Control': 'no-store',
    },
  });
}
