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
    expect(mail.subject).toContain('renewal and recovery');
    expect(mail.text).toContain('Expired status reported');
    expect(mail.text).toContain('not confirmation of renewal');
    expect(mail.text).not.toContain('provider-private-correlation');
    expect(mail.text).not.toContain('payment failed');
    expect(mail.html).toContain('synthetic-reference');
  });
  it('renders actionable tables with registrar, account, date meaning and recovery first', () => {
    const mail = renderRenewalEmail(
      notificationEnvelopeSchema.parse({
        ...envelope,
        count: 2,
        at: Date.parse('2026-11-16T01:00:00Z'),
        rows: [
          {
            ...envelope.rows[0],
            domain: 'upcoming.example',
            registrar: 'Name.com',
            account: 'Main',
            date: '2026-11-17',
            dateKind: 'expiry',
            autoRenew: false,
            failure: null,
          },
          {
            ...envelope.rows[0],
            domain: 'recover.example',
            registrar: 'Dynadot',
            account: '<Main>',
            date: '2026-12-01',
            expiryDate: '2026-11-01',
            dateKind: 'renewal',
            failure: null,
          },
        ],
      }),
      'https://domains.domains',
      'synthetic',
      'https://domains.domains/preferences',
    );
    expect(mail.html).toContain('<th');
    expect(mail.html).toContain('Registrar / account');
    expect(mail.text).toContain('Dynadot');
    expect(mail.html).toContain('&lt;Main&gt;');
    expect(mail.text.indexOf('recover.example')).toBeLessThan(
      mail.text.indexOf('upcoming.example'),
    );
    expect(mail.text).toContain('Reported expiry passed');
    expect(mail.text).toContain('Check renewal or recovery now');
    expect(mail.text).toContain('Expiry: 2026-11-01');
    expect(mail.text).toContain('Renewal deadline: 2026-12-01');
    expect(mail.text).toContain('Renew at Name.com');
    expect(mail.html).toContain('https://name.com/');
    expect(mail.text).not.toContain('Recorded review date');
    expect(mail.text).not.toContain('recovery guaranteed');
  });
  it('keeps old queued envelopes readable without inventing a registrar or expiry', () => {
    const mail = renderRenewalEmail(
      notificationEnvelopeSchema.parse({
        ...envelope,
        rows: [{ ...envelope.rows[0], failure: null }],
      }),
      'https://domains.domains',
      'synthetic',
      'https://domains.domains/preferences',
    );
    expect(mail.text).toContain('Registrar not recorded');
    expect(mail.text).toContain('Review date');
  });
  it('rejects contradictory summary counts', () => {
    expect(
      notificationEnvelopeSchema.safeParse({ ...envelope, attentionCount: 2 })
        .success,
    ).toBe(false);
  });
});
