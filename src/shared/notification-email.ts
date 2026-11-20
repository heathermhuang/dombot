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
      ...(row.account ? [`Account: ${row.account}`] : []),
      review.setup,
      ...(!review.recovery && row.price ? [review.estimate] : []),
      ...(row.stale ? ['Date needs a fresh registrar check'] : []),
      ...(row.imported ? ['User-supplied date (unverified)'] : []),
      ...(row.stale && row.observedAt
        ? [`Last checked: ${review.observed}`]
        : []),
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
    : mail.count > 1
      ? `${countLabel} to review`
      : undefined;
  const mixed = past.length > 0 && upcoming.length > 0;
  return renderEmail({
    subject: `${label} · ${countLabel}`,
    preheader: past.length
      ? 'Check recovery options with your registrar.'
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
    note: past.length
      ? 'Dates in UTC. Confirm recovery options and fees with your registrar.'
      : 'Dates in UTC. Open Renewals for current status.',
    actionBeforeRecords: truncated,
    action: {
      label: 'Open Renewals',
      url: `${origin}/w/${workspace}/#/renewals`,
    },
    reason: 'You opted in to portfolio emails.',
    preferencesUrl: unsubscribe,
    reference,
  });
}
