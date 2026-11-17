import { registrars } from '@aoxborrow/registrar-client';
import type { RenewalNoticeRow } from './notification-policy';

export function needsRecoveryCheck(row: RenewalNoticeRow, at: number) {
  return (
    row.expiryStatus !== undefined ||
    row.failure?.reason === 'expired-status' ||
    (!!row.expiryDate &&
      row.expiryDate < new Date(at).toISOString().slice(0, 10))
  );
}

/** The email and authenticated review page describe the same cached facts. */
export function renewalReview(row: RenewalNoticeRow, at: number) {
  const recovery = needsRecoveryCheck(row, at);
  const registrar = row.registrar || 'Registrar not recorded';
  const provider = Object.entries(registrars).find(
    ([id, info]) =>
      id === row.registrarId || info.displayName === row.registrar,
  )?.[1];
  const today = new Date(at).toISOString().slice(0, 10);
  const status =
    row.expiryStatus === 'pendingdelete'
      ? 'Pending deletion reported'
      : row.expiryStatus === 'redemptionperiod'
        ? 'Redemption reported'
        : row.expiryStatus === 'expired' ||
            row.failure?.reason === 'expired-status'
          ? 'Expired status reported'
          : recovery
            ? 'Reported expiry passed'
            : row.failure
              ? 'Renewal problem reported'
              : row.date < today
                ? 'Renewal deadline passed'
                : row.date === today
                  ? 'Due today'
                  : 'Upcoming';
  const dates = [
    `${row.dateKind === 'renewal' ? 'Renewal deadline' : row.dateKind === 'expiry' ? 'Expiry' : 'Review date'}: ${row.date}`,
    row.expiryDate && row.dateKind !== 'expiry' && row.expiryDate !== row.date
      ? `Expiry: ${row.expiryDate}`
      : null,
  ].filter((v): v is string => v !== null);
  const setup =
    row.autoRenew === null
      ? 'Auto-renew: unknown'
      : row.autoRenew
        ? 'Auto-renew: on'
        : 'Auto-renew: off';
  const nextStep =
    row.stale || row.imported
      ? 'Verify dates and renewal options with the registrar.'
      : row.expiryStatus === 'pendingdelete'
        ? 'Contact the registrar immediately; restoration may no longer be possible.'
        : recovery
          ? 'Check renewal or recovery now. If unavailable, contact registrar support.'
          : row.failure
            ? 'Check the recorded renewal problem with the registrar now.'
            : row.autoRenew
              ? 'Verify auto-renew and billing with the registrar.'
              : 'Sign in and renew before the deadline.';
  return {
    recovery,
    registrar,
    status,
    dates,
    setup,
    nextStep,
    estimate: recovery
      ? 'Recovery fee: confirm with registrar'
      : row.price
        ? `Est. renewal: ${row.price}`
        : 'Renewal estimate unavailable',
    observed: row.observedAt
      ? new Date(row.observedAt).toISOString().slice(0, 16).replace('T', ' ') +
        ' UTC'
      : 'Not recorded',
    link: provider
      ? {
          label: recovery
            ? `Check recovery at ${registrar}`
            : row.autoRenew || row.stale || row.imported || row.failure
              ? `Open ${registrar}`
              : `Renew at ${registrar}`,
          url: `https://${provider.website}/`,
        }
      : null,
  };
}
