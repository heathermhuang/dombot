import { z } from 'zod';
import { renewalNoticeRowSchema } from './notification-policy';
import { renderEmail } from './email-layout';

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
export function renderRenewalEmail(
  mail: NotificationEnvelope,
  origin: string,
  workspace: string,
  unsubscribe: string,
  reference?: string,
) {
  const attention =
    mail.attentionCount ?? (mail.kind === 'urgent' ? mail.count : 0);
  const label =
    attention > 0
      ? 'Renewals need attention'
      : mail.kind === 'overview'
        ? 'Your renewal outlook'
        : 'Renewals to review';
  return renderEmail({
    subject: `${label} · ${mail.count} ${mail.count === 1 ? 'domain' : 'domains'}`,
    preheader: `${mail.count} ${mail.count === 1 ? 'name' : 'names'} in your portfolio to review.`,
    heading: label,
    intro:
      attention > 0
        ? 'These recorded deadlines or registrar statuses need attention before the next weekly review.'
        : 'Here are the names in your current renewal review window.',
    sections: mail.rows.map((row) => ({
      label: row.domain,
      body: `${row.account}${row.failure ? (row.failure.reason === 'expired-status' ? '\nThe registrar record reports an expiry status. Check it with the registrar.' : '\nA recorded renewal problem needs review.') : row.attention ? '\nThis deadline cannot wait for the next weekly review.' : ''}\nRecorded review date: ${row.date}\n${row.autoRenew === null ? 'Check renewal setup' : row.autoRenew ? 'Auto-renew enabled (not confirmation of renewal)' : 'Manual renewal'}${row.stale ? '\nNeeds refresh: based on a previous observation.' : ''}${row.imported ? '\nDate supplied by you; not verified with a registrar.' : ''}\n${row.price ? `Estimated renewal: ${row.price}` : 'Renewal estimate unavailable'}${row.observedAt ? `\nInventory last observed: ${new Date(row.observedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC` : ''}`,
    })),
    note: `${mail.count > mail.rows.length ? `Showing ${mail.rows.length} of ${mail.count} affected names. ` : ''}As of ${new Date(mail.at).toISOString().slice(0, 16).replace('T', ' ')} UTC. The linked view shows current information, which may have changed. Names with missing or conflicting dates need checking in the app. No domain has been renewed by this email.`,
    action: {
      label: 'Review renewals',
      url: `${origin}/w/${workspace}/#/renewals`,
    },
    reason: 'You enabled portfolio emails in your notification settings.',
    preferencesUrl: unsubscribe,
    reference,
  });
}
