import { z } from 'zod';
import { needsRecoveryCheck, renewalReview } from './renewal-review';
import {
  renewalNoticeRowSchema,
  type RenewalNoticeRow,
} from './notification-policy';
import { renderEmail, type EmailRecord } from './email-layout';

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

function renewalRecord(row: RenewalNoticeRow, at: number): EmailRecord {
  const review = renewalReview(row, at);
  const expiry = row.dateKind === 'expiry' ? row.date : row.expiryDate;
  const facts: EmailRecord['facts'] = [
    ['Registrar', review.registrar],
    ['Expiry date', expiry ?? 'Not recorded'],
  ];
  if (row.dateKind !== 'expiry')
    facts.push([
      row.dateKind === 'renewal' ? 'Renewal deadline' : 'Review date',
      row.date,
    ]);

  return {
    title: row.domain,
    status: review.status,
    facts,
    nextStep: review.nextStep,
    link: review.link ?? undefined,
    notes: [
      `Registrar account: ${row.account || 'Not recorded'}`,
      review.setup,
      review.estimate,
      ...(row.stale ? ['Date needs a fresh registrar check'] : []),
      ...(row.imported ? ['User-supplied date (unverified)'] : []),
      ...(row.observedAt ? [`Observed: ${review.observed}`] : []),
    ],
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
  const past = mail.rows.filter((row) => needsRecoveryCheck(row, mail.at));
  const upcoming = mail.rows.filter((row) => !needsRecoveryCheck(row, mail.at));
  const label = past.length
    ? 'Check domain renewal and recovery'
    : attention > 0
      ? 'Renewals need attention'
      : mail.kind === 'overview'
        ? 'Your renewal outlook'
        : 'Renewals to review';
  const countLabel = `${mail.count} ${mail.count === 1 ? 'domain' : 'domains'}`;
  const truncated = mail.count > mail.rows.length;
  const summary = truncated
    ? `Showing ${mail.rows.length} of ${countLabel}.`
    : past.length
      ? `${countLabel} to review. Check recovery options with the registrar.`
      : `${countLabel} to review. Dates are shown in UTC.`;
  const mixed = past.length > 0 && upcoming.length > 0;
  const asOf = new Date(mail.at).toISOString().slice(0, 16).replace('T', ' ');
  return renderEmail({
    subject: `${label} · ${countLabel}`,
    preheader: past.length
      ? 'Past-expiry domains need checking first. Renewal or recovery may still be possible.'
      : `${countLabel} to review, with registrar details and next steps.`,
    heading: past.length ? 'Check renewal or recovery' : label,
    intro: summary,
    recordGroups: [
      ...(past.length
        ? [
            {
              heading: mixed ? 'Check first' : undefined,
              priority: true,
              records: past.map((row) => renewalRecord(row, mail.at)),
            },
          ]
        : []),
      ...(upcoming.length
        ? [
            {
              heading: mixed ? 'Other renewals to review' : undefined,
              records: upcoming.map((row) => renewalRecord(row, mail.at)),
            },
          ]
        : []),
    ],
    note: `As of ${asOf} UTC. Dates are UTC and may change. Sign in to the named registrar account to act and confirm availability, fees, and deadlines. Renewal prices are estimates. Auto-renew enabled is not confirmation of renewal.`,
    actionBeforeRecords: truncated,
    action: {
      label: 'Open Renewals',
      url: `${origin}/w/${workspace}/#/renewals`,
    },
    reason: 'You enabled portfolio emails in your notification settings.',
    preferencesUrl: unsubscribe,
    reference,
  });
}
