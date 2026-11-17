/** A short recognition label; the selected destination still shows its exact URL. */
export function salesDestinationLabel(value: string): string {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '');
    const domain = ['domain', 'query', 'name']
      .map((key) => url.searchParams.get(key))
      .find((part) => part && /^[\p{L}\p{N}.-]+\.[\p{L}\p{N}-]+$/u.test(part));
    if (domain) return `${domain} · ${host}`;
    const path = url.pathname
      .split('/')
      .filter(Boolean)
      .map((part) => {
        try {
          return decodeURIComponent(part);
        } catch {
          return part;
        }
      });
    const namedDomain = path.find((part) =>
      /^[\p{L}\p{N}.-]+\.[\p{L}\p{N}-]+$/u.test(part),
    );
    if (namedDomain) return `${namedDomain} · ${host}`;
    const detail = path.join(' / ');
    return detail
      ? `${host} · ${detail.length > 56 ? detail.slice(0, 53) + '…' : detail}`
      : host;
  } catch {
    return 'Destination unavailable';
  }
}
