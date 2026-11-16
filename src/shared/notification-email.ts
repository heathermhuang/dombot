import { z } from 'zod';
import { registrars } from '@aoxborrow/registrar-client';
import {
  renewalNoticeRowSchema,
  type RenewalNoticeRow,
} from './notification-policy';
import { renderEmail, type EmailTable } from './email-layout';

export const notificationEnvelopeSchema = z
  .object({
    kind: z.enum(['weekly', 'urgent', 'overview']),
    count: z.number().int().positive(),
    attentionCount: z.number().int().nonnegative().optional(),
    rows: z.array(renewalNoticeRowSchema).max(20),
    at: z.number(),
  })
  .strict()
  .refine(
    (v) => v.attentionCount === undefined || v.attentionCount <= v.count,
    'Attention count exceeds the affected names.',
  );
export type NotificationEnvelope = z.infer<typeof notificationEnvelopeSchema>;

function recovery(row: RenewalNoticeRow, at: number) {
  return (
    row.expiryStatus !== undefined ||
    row.failure?.reason === 'expired-status' ||
    (!!row.expiryDate &&
      row.expiryDate < new Date(at).toISOString().slice(0, 10))
  );
}

function renewalTable(
  rows: RenewalNoticeRow[],
  at: number,
  recover: boolean,
): EmailTable {
  return {
    caption: recover
      ? 'Check expired or past-expiry domains first'
      : 'Upcoming renewals',
    columns: [
      'Domain / estimate',
      'Registrar / account',
      'Date / status',
      'Next step',
    ],
    rows: rows.map((row) => {
      const registrar = row.registrar || 'Registrar not recorded';
      const provider = Object.entries(registrars).find(
        ([id, info]) =>
          id === row.registrarId || info.displayName === row.registrar,
      )?.[1];
      const state =
        row.expiryStatus === 'pendingdelete'
          ? 'Pending deletion reported'
          : row.expiryStatus === 'redemptionperiod'
            ? 'Redemption reported'
            : row.expiryStatus === 'expired' ||
                row.failure?.reason === 'expired-status'
              ? 'Expired status reported'
              : recover
                ? 'Reported expiry passed'
                : row.failure
                  ? 'Renewal problem reported'
                  : row.date < new Date(at).toISOString().slice(0, 10)
                    ? 'Renewal deadline passed'
                    : row.date === new Date(at).toISOString().slice(0, 10)
                      ? 'Due today'
                      : 'Upcoming';
      const dates = [
        `${row.dateKind === 'renewal' ? 'Renewal deadline' : row.dateKind === 'expiry' ? 'Expiry' : 'Review date'}: ${row.date}`,
        row.expiryDate &&
        row.dateKind !== 'expiry' &&
        row.expiryDate !== row.date
          ? `Expiry: ${row.expiryDate}`
          : null,
      ]
        .filter(Boolean)
        .join('\n');
      const setup =
        row.autoRenew === null
          ? 'Auto-renew: unknown'
          : row.autoRenew
            ? 'Auto-renew: on'
            : 'Auto-renew: off';
      const next =
        row.stale || row.imported
          ? 'Verify dates and renewal options with the registrar.'
          : row.expiryStatus === 'pendingdelete'
            ? 'Contact the registrar immediately; restoration may no longer be possible.'
            : recover
              ? 'Check renewal or recovery now. If unavailable, contact registrar support.'
              : row.failure
                ? 'Check the recorded renewal problem with the registrar now.'
                : row.autoRenew
                  ? 'Verify auto-renew and billing with the registrar.'
                  : 'Sign in and renew before the deadline.';
      return [
        {
          text: `${row.domain}\n${recover ? 'Recovery fee: confirm with registrar' : row.price ? `Est. renewal: ${row.price}` : 'Renewal estimate unavailable'}`,
        },
        { text: `${registrar}\nAccount: ${row.account || 'Not recorded'}` },
        {
          text: `${state}\n${dates}\n${setup}${row.stale ? '\nNeeds refresh: previous observation' : ''}${row.imported ? '\nUser-supplied date; unverified' : ''}${row.observedAt ? `\nObserved: ${new Date(row.observedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC` : ''}`,
        },
        {
          text: next,
          ...(provider
            ? {
                link: {
                  label: recover
                    ? `Check recovery at ${registrar}`
                    : row.autoRenew || row.stale || row.imported || row.failure
                      ? `Open ${registrar}`
                      : `Renew at ${registrar}`,
                  url: `https://${provider.website}/`,
                },
              }
            : {}),
        },
      ];
    }),
  };
}

export function renderRenewalEmail(
  mail: NotificationEnvelope,
  origin: string,
  workspace: string,
  unsubscribe: string,
  reference?: string,
) {
  const attention =
    mail.attentionCount ?? (mail.kind === 'urgent' ? mail.count : 0);
  const past = mail.rows.filter((row) => recovery(row, mail.at));
  const upcoming = mail.rows.filter((row) => !recovery(row, mail.at));
  const label = past.length
    ? 'Check domain renewal and recovery'
    : attention > 0
      ? 'Renewals need attention'
      : mail.kind === 'overview'
        ? 'Your renewal outlook'
        : 'Renewals to review';
  return renderEmail({
    subject: `${label} · ${mail.count} ${mail.count === 1 ? 'domain' : 'domains'}`,
    preheader: past.length
      ? 'Past-expiry domains need checking first. Renewal or recovery may still be possible.'
      : `${mail.count} ${mail.count === 1 ? 'domain' : 'domains'} to review, with registrar details and next steps.`,
    heading: label,
    intro: past.length
      ? 'Some domains have passed their reported expiry date or have an expired registrar status. Check them now: renewal or recovery may still be possible, but the registrar must confirm availability, fees and the final deadline.'
      : 'Use the registrar and account below to check each domain and complete any renewal. Dates are shown in UTC.',
    tables: [
      ...(past.length ? [renewalTable(past, mail.at, true)] : []),
      ...(upcoming.length ? [renewalTable(upcoming, mail.at, false)] : []),
    ],
    note: `${mail.count > mail.rows.length ? `Showing ${mail.rows.length} of ${mail.count} affected names, with recovery checks first. ` : ''}As of ${new Date(mail.at).toISOString().slice(0, 16).replace('T', ' ')} UTC. Dates are UTC. Auto-renew enabled is not confirmation of renewal. Estimates are not checkout prices; recovery eligibility, fees and deadlines must be confirmed by the registrar. Registrar links open its website; sign in to the named account and find the domain. The portfolio link shows current information, which may have changed. Names with missing or conflicting dates need checking in the app. No domain has been renewed by this email.`,
    action: {
      label: 'View all renewals and recovery checks',
      url: `${origin}/w/${workspace}/#/renewals`,
    },
    reason: 'You enabled portfolio emails in your notification settings.',
    preferencesUrl: unsubscribe,
    reference,
  });
}
