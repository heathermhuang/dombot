import { canonicalDomain } from './publication';
/** Origin is configured by the operator, never derived from Host/return URLs. */
export function canonicalPublicUrl(
  origin: string | undefined,
  path: string,
): string {
  if (!origin) throw new Error('Canonical public routing is not configured.');
  const base = new URL(origin);
  if (
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !path.startsWith('/') ||
    path.startsWith('//')
  )
    throw new Error('Invalid canonical public routing.');
  return `${base.origin}${base.pathname.replace(/\/$/, '')}${path}`;
}
/** Hosted workspace prefixes are private routing, never listing identities.
 * Self-hosted instances retain their existing /d/ routes. */
export function publicDomainPath(base: string, domain: string): string {
  const prefix = base.replace(/\/$/, '');
  return `${/\/w\/[^/]+$/.test(prefix) ? '' : prefix + '/d'}/${canonicalDomain(domain)}`;
}
export function publicDomainUrl(origin: string | undefined, domain: string) {
  // Validate the operator origin before using any of its components.
  const validated = new URL(canonicalPublicUrl(origin, '/'));
  return validated.origin + publicDomainPath(validated.pathname, domain);
}
