import { describe, expect, it } from 'vitest';
import {
  notificationEnvelopeSchema,
  renderRenewalEmail,
} from './notification-email';
const envelope = {
  kind: 'urgent',
  count: 1,
  attentionCount: 1,
  at: Date.parse('2026-11-09T10:00:00Z'),
  rows: [
    {
      domain: 'sample.example',
      account: 'Sample registrar',
      date: '2026-11-09',
      autoRenew: true,
      stale: false,
      imported: false,
      observedAt: Date.parse('2026-11-09T09:55:00Z'),
      price: null,
      attention: true,
      failure: {
        id: 'provider-private-correlation',
        at: Date.parse('2026-11-09T09:55:00Z'),
        deadlineAt: Date.parse('2026-11-09'),
        reason: 'expired-status',
      },
    },
  ],
};
describe('renewal message projection', () => {
  it('explains the actual reason an auto-renew name needs attention without claiming a payment failure', () => {
    const mail = renderRenewalEmail(
      notificationEnvelopeSchema.parse(envelope),
      'https://domains.domains',
      '11111111-1111-4111-8111-111111111111',
      'https://domains.domains/email/unsubscribe/synthetic',
      'synthetic-reference',
    );
    expect(mail.subject).toContain('need attention');
    expect(mail.text).toContain('registrar record reports an expiry status');
    expect(mail.text).toContain('not confirmation of renewal');
    expect(mail.text).not.toContain('provider-private-correlation');
    expect(mail.text).not.toContain('payment failed');
    expect(mail.html).toContain('synthetic-reference');
  });
  it('rejects contradictory summary counts', () => {
    expect(
      notificationEnvelopeSchema.safeParse({ ...envelope, attentionCount: 2 })
        .success,
    ).toBe(false);
  });
});
