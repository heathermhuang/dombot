import { reserveAuthEmail } from './registration';
import { notificationFailure } from './notification-dispatch';
import { renderEmail } from '../shared/email-layout';
import { salesRecipient } from './sales-notifications';

export const SECURITY_NOTICE_LABELS: Record<string, string> = {
  'password-changed': 'Your password was changed',
  'password-reset': 'Your password was reset',
  'passkey-added': 'A passkey was added to your account',
  'passkey-removed': 'A passkey was removed from your account',
};

/** Local committed intents only; ambiguous provider calls never return to this queue. */
export async function drainSecurityNotifications(env: HostedEnv) {
  if (
    env.NOTIFICATION_SECURITY_ENABLED !== 'true' ||
    env.EMAIL_DELIVERY_VERIFIED !== 'true' ||
    !env.EMAIL ||
    env.EMAIL_FROM !== 'accounts@mail.domains.domains'
  )
    return;
  const now = Date.now();
  await env.CONTROL_DB.prepare(
    "UPDATE notification_security_outbox SET state='unknown' WHERE state='sending' AND updated_at<?",
  )
    .bind(now - 300_000)
    .run();
  const items = await env.CONTROL_DB.prepare(
    "UPDATE notification_security_outbox SET state='sending',attempts=attempts+1,updated_at=? WHERE id IN (SELECT id FROM notification_security_outbox WHERE state='queued' AND due_at<=? ORDER BY due_at,id LIMIT 5) AND state='queued' RETURNING id,user_id,kind,created_at,attempts",
  )
    .bind(now, now)
    .all<{
      id: string;
      user_id: string;
      kind: string;
      created_at: number;
      attempts: number;
    }>();
  for (const item of items.results) {
    const user = await env.CONTROL_DB.prepare(
      'SELECT u.email,u.workspace_id FROM users u JOIN workspaces w ON w.id=u.workspace_id WHERE u.id=? AND w.enabled=1 AND NOT EXISTS(SELECT 1 FROM closure_requests c WHERE c.workspace_id=w.id)',
    )
      .bind(item.user_id)
      .first<{ email: string; workspace_id: string }>();
    let state = 'suppressed',
      receipt: string | null = null;
    if (
      user &&
      SECURITY_NOTICE_LABELS[item.kind] &&
      (await salesRecipient(env, user.workspace_id, user.email)).verified
    ) {
      try {
        await reserveAuthEmail(env);
      } catch {
        await env.CONTROL_DB.prepare(
          "UPDATE notification_security_outbox SET state=?,due_at=? WHERE id=? AND state='sending'",
        )
          .bind(
            item.attempts >= 5 ? 'failed' : 'queued',
            now + 3600_000,
            item.id,
          )
          .run();
        continue;
      }
      try {
        const result = await env.EMAIL.send({
          from: { email: env.EMAIL_FROM, name: 'domains.domains' },
          to: user.email,
          ...renderEmail({
            subject: SECURITY_NOTICE_LABELS[item.kind] + ' · domains.domains',
            preheader: 'A security setting on your account changed.',
            heading: SECURITY_NOTICE_LABELS[item.kind],
            details: [
              [
                'Changed at',
                new Date(item.created_at)
                  .toISOString()
                  .slice(0, 16)
                  .replace('T', ' ') + ' UTC',
              ],
            ],
            action: {
              label: 'Review account security',
              url: `${env.CANONICAL_ORIGIN}/account`,
            },
            note: 'If you did not make this change, review your account security and contact domains@domains.domains. This email does not grant access to your account.',
            reference: item.id,
            reason:
              'This notice records a completed security change to your account.',
          }),
          headers: {
            'X-Notification-ID': item.id,
            'X-Auto-Response-Suppress': 'All',
          },
        });
        state = 'accepted';
        receipt = result.messageId;
      } catch (error) {
        const outcome = notificationFailure(error);
        state =
          outcome === 'retryable' && item.attempts < 5 ? 'queued' : outcome;
      }
    }
    await env.CONTROL_DB.prepare(
      'UPDATE notification_security_outbox SET state=?,provider_receipt=?,due_at=? WHERE id=?',
    )
      .bind(state, receipt, now + 3600_000, item.id)
      .run();
  }
}
