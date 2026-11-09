import { withParkioProjection } from './parkio-projection';
import { PARKIO_INTERVAL } from '../../shared/parkio';
import { marketSales } from './markets/sync';
import { currencyInfo } from '../../shared/money';
import {
  getCachedPortfolio,
  getPortfolioPricing,
  getRegistrarMetadata,
} from './registrars';
import { getImportedDomains } from './imported-domains';
import { listEvents } from './domain-events';
import { getSettings } from './settings';
import { importedRows } from '../../shared/imported-domains';
import { ownedAndRenewing } from '../../shared/ownership';
import { qualifyRenewalDate } from '../../shared/renewal-date';
import { domainKey } from '../../shared/account-key';
import { toAscii } from '../../shared/domain-name';
import {
  type RenewalNoticeRow,
  renewalCandidates,
} from '../../shared/notification-policy';

export {
  renewalDecisions,
  decideRenewal,
  decisionRecords,
} from './renewal-decisions';

/** Cached reads only. A source's status and freshness are never inferred from send time. */
export function renewalNotificationRows(now = Date.now()): RenewalNoticeRow[] {
  const cached = withParkioProjection(
    getCachedPortfolio() ?? {
      domains: [],
      fetchedAt: null,
      registrars: [],
      registrarLabels: {},
      errors: [],
    },
  ).domains;
  const input = [...cached, ...importedRows(getImportedDomains(), cached)];
  const metadata = new Map(
    getRegistrarMetadata().map((a) => [a.accountId ?? a.name, a]),
  );
  const pricing = getPortfolioPricing();
  const interval = getSettings().autoSyncIntervalMinutes * 60_000;
  return ownedAndRenewing(
    input,
    listEvents(),
    {},
    now,
    marketSales(),
  ).renewing.flatMap((original) => {
    const d = qualifyRenewalDate(original);
    if (d.parkio?.missingSince != null) return [];
    const raw = d.renewalDate ?? d.expirationDate;
    if (!raw) return [];
    const parsed = new Date(raw);
    if (!Number.isFinite(parsed.getTime())) return [];
    const account = metadata.get(d.accountId ?? d.registrar);
    const at =
      d.parkio?.lastSuccessfulCheckAt ?? account?.sync.lastSyncedAt ?? null;
    const imported = d.source === 'imported' && !d.parkio;
    const stale = d.parkio
      ? at === null ||
        at > now + 5000 ||
        now - at > 2 * PARKIO_INTERVAL ||
        d.parkio.connection !== 'connected' ||
        d.parkio.paused ||
        !!d.parkio.error
      : !imported &&
        (at === null ||
          at > now + 5000 ||
          interval <= 0 ||
          now - at > Math.max(interval * 2, 86400_000) ||
          !!account?.sync.lastError);
    const price = pricing[domainKey(d)];
    const currency = price ? currencyInfo(price.currency) : null;
    const knownPrice =
      price &&
      currency &&
      price.source !== 'unavailable' &&
      price.renewal !== null &&
      Number.isFinite(price.renewal) &&
      price.renewal >= 0 &&
      price.renewal <= 1e12;
    const expiry = d.expirationDate
      ? new Date(d.expirationDate).getTime()
      : NaN;
    const expiredStatus =
      !imported &&
      !stale &&
      ['expired', 'redemptionperiod', 'pendingdelete'].includes(
        String(d.status).toLowerCase(),
      );
    return [
      {
        domain: toAscii(d.domainName),
        account:
          (d.parkio ? 'Park.io · ' + d.parkio.label : account?.accountLabel) ||
          d.importedRegistrarLabel ||
          d.registrar ||
          'Imported',
        date: parsed.toISOString().slice(0, 10),
        autoRenew: d.autoRenewUnknown ? null : d.autoRenew,
        observedAt: at,
        stale,
        imported,
        price: knownPrice
          ? `${price.currency} ${price.renewal!.toFixed(currency!.decimals)}${['tld', 'base'].includes(price.source) ? ' (TLD estimate; premium renewals may differ)' : price.source === 'manual' ? ' (manual estimate)' : ' (last known quote)'}`
          : null,
        failure:
          expiredStatus && Number.isFinite(expiry)
            ? {
                id: `status:${String(d.status).toLowerCase()}:${expiry}`,
                at: at!,
                deadlineAt: expiry,
                reason: 'expired-status' as const,
              }
            : null,
      },
    ];
  });
}

export function currentRenewalCandidates(timeZone: string, now = Date.now()) {
  return renewalCandidates(renewalNotificationRows(now), now, timeZone);
}
