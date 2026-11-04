import type { Domain } from './ipc';

/** Versioned, non-destructive interpretation of the old Gandi adapter cache.
 * Gandi's updated_at is not a renewal deadline. Keep the stored value and cache
 * age intact; only the read projection ignores it. A normal corrected provider
 * read replaces the obsolete value. Imported user dates are not provider data.
 */
export function qualifyRenewalDate<T extends Partial<Domain>>(
  domain: T,
  registrar = domain.registrar,
): T {
  if (
    registrar !== 'gandi' ||
    domain.source === 'imported' ||
    domain.renewalDate == null
  )
    return domain;
  return {
    ...domain,
    renewalDate: null,
    renewalDateIssue: 'gandi-updated-at-v1',
  };
}
