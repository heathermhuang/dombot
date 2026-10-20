/** Operator-set ceilings remain bounded; absent/invalid budgets keep pilot defaults. */
export function authLimit(
  value: string | undefined,
  fallback: number,
  max: number,
) {
  return value && /^[1-9]\d*$/.test(value) && Number(value) <= max
    ? Number(value)
    : fallback;
}
export const authRetrySeconds = () =>
  Math.max(1, Math.ceil((600_000 - (Date.now() % 600_000)) / 1000));

export class AuthEmailUnavailable extends Error {
  constructor(readonly retryAfter: number) {
    super('Email sign-in is temporarily at capacity. Please try again later.');
  }
}
