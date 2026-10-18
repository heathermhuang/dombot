import { canonicalDomain } from './publication';
import type { SaleDestination } from './sales';
import { SalesError } from './sales-review';

const hosts: Record<SaleDestination['provider'], string[]> = {
  Spaceship: ['spaceship.com', 'www.spaceship.com'],
  Afternic: ['afternic.com', 'www.afternic.com'],
  Sedo: ['sedo.com', 'www.sedo.com'],
  Atom: ['atom.com', 'www.atom.com'],
  Efty: ['efty.com', 'www.efty.com', 'efty.com'],
};
/** Syntactic manual inspection only. No fetch proxy or purchase verification. */
export function validateSalesDestination(
  provider: SaleDestination['provider'],
  value: string,
  domain?: string,
): string {
  const u = new URL(value);
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    u.port ||
    !hosts[provider].includes(u.hostname.toLowerCase())
  )
    throw new SalesError(
      'DESTINATION_INVALID',
      'Use an HTTPS link on the selected provider’s supported domain.',
    );
  if (domain) {
    const names =
      decodeURIComponent(u.pathname + u.search).match(
        /(?:[a-z0-9-]+\.)+[a-z]{2,}/gi,
      ) ?? [];
    if (names.length && !names.some((n) => canonicalDomain(n) === domain))
      throw new SalesError(
        'DESTINATION_MISMATCH',
        'This link appears to refer to another domain. Check it before publishing.',
      );
  }
  return u.href;
}
export const SALES_PROVIDER_CAPABILITIES = {
  mode: 'Manual link',
  csv: 'Generic sales settings export for manual review',
  apiRead: false,
  apiWrite: false,
  checkoutCreation: false,
} as const;
