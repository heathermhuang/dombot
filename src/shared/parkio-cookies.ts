import { ParkioError, parkioCookieSchema, type ParkioCookie } from './parkio';
export function parkioCookieHeader(
  cookies: ParkioCookie[],
  target: string,
  now = Date.now(),
) {
  const url = new URL(target);
  if (url.origin !== 'https://park.io')
    throw new ParkioError('unsafe_destination');
  return cookies
    .filter(
      (c) =>
        (c.expires === undefined || c.expires <= 0 || c.expires * 1000 > now) &&
        (url.pathname === c.path ||
          url.pathname.startsWith(
            c.path.endsWith('/') ? c.path : c.path + '/',
          )),
    )
    .sort((a, b) => b.path.length - a.path.length)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}
export function rotateParkioCookies(
  cookies: ParkioCookie[],
  headers: string[],
  now = Date.now(),
): ParkioCookie[] {
  const next = [...cookies];
  for (const line of headers) {
    if (line.length > 16384 || /[\r\n]/.test(line))
      throw new ParkioError('cookie_contract_required');
    const [first, ...parts] = line.split(';');
    const at = first.indexOf('=');
    const name = first.slice(0, at).trim();
    if (!['parkio_user_signin', 'flashId'].includes(name)) continue;
    const attrs = new Map<string, string>();
    for (const part of parts) {
      const index = part.indexOf('=');
      attrs.set(
        (index < 0 ? part : part.slice(0, index)).trim().toLowerCase(),
        index < 0 ? '' : part.slice(index + 1).trim(),
      );
    }
    if (attrs.has('partitioned'))
      throw new ParkioError('cookie_contract_required');
    const domain = (attrs.get('domain') ?? 'park.io').toLowerCase(),
      path = attrs.get('path') ?? '/';
    const rawMax = attrs.get('max-age');
    let expires = attrs.has('expires')
      ? Date.parse(attrs.get('expires')!) / 1000
      : undefined;
    if (rawMax !== undefined) {
      if (!/^-?\d{1,10}$/.test(rawMax))
        throw new ParkioError('cookie_contract_required');
      expires = now / 1000 + Number(rawMax);
    }
    if (expires !== undefined && !Number.isFinite(expires))
      throw new ParkioError('cookie_contract_required');
    const cookie = parkioCookieSchema.parse({
      name,
      value:
        first.slice(at + 1) ||
        (expires !== undefined && expires * 1000 <= now ? 'deleted' : ''),
      domain,
      path,
      secure: attrs.has('secure'),
      httpOnly: attrs.has('httponly'),
      ...(expires === undefined ? { session: true } : { expires }),
    });
    const index = next.findIndex(
      (c) =>
        c.name === name &&
        c.domain.replace(/^\./, '') === domain.replace(/^\./, '') &&
        c.path === path,
    );
    if (index >= 0) next.splice(index, 1);
    if (expires === undefined || expires * 1000 > now) next.push(cookie);
  }
  return next;
}
