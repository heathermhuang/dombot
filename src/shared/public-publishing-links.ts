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
export const publicDomainUrl = (origin: string | undefined, domain: string) =>
  canonicalPublicUrl(origin, `/d/${canonicalDomain(domain)}`);
