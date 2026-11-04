import {
  STALE_AFTER_MS,
  type RenewalPriceAge,
  type RenewalPricing,
  type RenewalPricingProgress,
} from './ipc';
import { currencyInfo } from './money';

/** Do not turn absent, malformed or future observations into fresh quotes. */
export function observationAt(value: unknown, now = Date.now()): number | null {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= now
    ? value
    : null;
}

export function renewalPriceAge(
  price: RenewalPricing | undefined,
  now = Date.now(),
): RenewalPriceAge {
  if (
    !price ||
    price.renewal === null ||
    !Number.isFinite(price.renewal) ||
    price.renewal < 0 ||
    price.renewal > 1e12 ||
    !currencyInfo(price.currency) ||
    price.source === 'unavailable'
  )
    return 'unavailable';
  if (price.source === 'manual') return 'manual';
  if (price.source === 'tld' || price.source === 'base') return 'estimate';
  const at = observationAt(price.observedAt, now);
  return at === null
    ? 'unknown'
    : now - at >= STALE_AFTER_MS
      ? 'stale'
      : 'current';
}

/** Shared by normal owner reads; introduces no refresh, write or provider call. */
export function observedPricing(
  price: RenewalPricing,
  quoteAt: unknown,
  inventoryAt: unknown,
  now = Date.now(),
): RenewalPricing {
  const at =
    price.source === 'api'
      ? observationAt(quoteAt, now)
      : price.source === 'portal'
        ? observationAt(price.observedAt, now)
        : null;
  const observed = {
    ...price,
    observedAt: at ?? undefined,
    inventoryAt: observationAt(inventoryAt, now),
  };
  return { ...observed, priceAge: renewalPriceAge(observed, now) };
}

export const RENEWAL_AGE_LABEL: Record<RenewalPriceAge, string> = {
  current: 'Current quote',
  stale: 'Stale quote',
  unknown: 'Quote age unknown',
  estimate: 'Estimate',
  manual: 'Manual rate',
  unavailable: 'Unavailable',
};

export const RENEWAL_SOURCE_LABEL: Record<RenewalPricing['source'], string> = {
  api: 'API quote',
  portal: 'Portal observation',
  tld: 'Account TLD rate',
  base: 'Base TLD rate',
  manual: 'Manual rate',
  unavailable: 'Unavailable',
};

export function observationLabel(at: unknown): string {
  const value = observationAt(at);
  return value === null
    ? 'Unknown'
    : new Date(value).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZoneName: 'short',
      });
}

/** Presentation of the existing queue; never schedules or retries anything. */
export function renewalProgressText(
  progress: RenewalPricingProgress | null,
  transportRetry = 0,
  now = Date.now(),
): string | null {
  if (!progress) return null;
  const parts: string[] = [];
  const retry = Math.max(transportRetry, progress.nextAt ?? 0);
  if (progress.remaining)
    parts.push(
      retry > now
        ? `${progress.remaining} renewal prices pending · retry at ${new Date(retry).toLocaleString(undefined, { timeZoneName: 'short' })}`
        : `Updating renewal prices · ${progress.remaining} left`,
    );
  if (progress.blocked)
    parts.push(
      `${progress.blocked} renewal prices waiting for inventory recovery`,
    );
  if (progress.failed)
    parts.push(`${progress.failed} renewal prices could not update`);
  return parts.length ? parts.join(' · ') : null;
}
