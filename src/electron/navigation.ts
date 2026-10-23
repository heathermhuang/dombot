/** Only the packaged renderer entry (plus hash routes) receives the preload. */
export function isAllowedRendererNavigation(
  target: string,
  entry: string,
  development = false,
): boolean {
  try {
    const candidate = new URL(target),
      trusted = new URL(entry);
    if (candidate.username || candidate.password) return false;
    if (development)
      return (
        ['http:', 'https:'].includes(trusted.protocol) &&
        candidate.origin === trusted.origin
      );
    return (
      trusted.protocol === 'file:' &&
      candidate.protocol === 'file:' &&
      candidate.host === trusted.host &&
      candidate.pathname === trusted.pathname &&
      candidate.search === trusted.search
    );
  } catch {
    return false;
  }
}
