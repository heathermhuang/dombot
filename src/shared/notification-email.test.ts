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
    expect(mail.text).toContain('Auto-renew: on');
    expect(mail.text).toContain(
      'Confirm recovery options and fees with your registrar.',
    );
    expect(mail.text).not.toContain('1 domain to review');
    expect(mail.text).not.toContain('Last checked:');
    expect(mail.text).not.toContain('provider-private-correlation');
    expect(mail.text).not.toContain('payment failed');
    expect(mail.html).toContain('synthetic-reference');
  });
  it('renders mobile-first records with recovery first and a consistent reading order', () => {
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
    expect(mail.html).toContain('scope="row"');
    expect(mail.html).not.toContain('<thead>');
    const ordered = [
      'recover.example',
      '>Registrar</th>',
      '>Expiry date</th>',
      '>2026-11-01</td>',
      '>Next step</p>',
      'Check recovery at Dynadot',
      'upcoming.example',
      'Open Renewals',
      'Dates in UTC.',
      'Email preferences and unsubscribe',
    ];
    const positions = ordered.map((part) => mail.html.indexOf(part));
    expect(
      positions.every((position, i) => position > (positions[i - 1] ?? -1)),
    ).toBe(true);
    expect(mail.html).not.toContain('If the button does not work');
    expect(mail.text).toContain(
      'Open Renewals: https://domains.domains/w/synthetic/#/renewals',
    );
    expect(mail.text).toContain('Dynadot');
    expect(mail.html).toContain('&lt;Main&gt;');
    expect(mail.text.indexOf('recover.example')).toBeLessThan(
      mail.text.indexOf('upcoming.example'),
    );
    expect(mail.text).toContain('Reported expiry passed');
    expect(mail.text).toContain('Check renewal or recovery now');
    expect(mail.text).toContain('Expiry date: 2026-11-01');
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
    expect(mail.text).toContain('Expiry date: Not recorded');
    expect(mail.text).toContain('Review date: 2026-11-09');
  });
  it('shows the full count and keeps the complete list accessible when rows are capped', () => {
    const mail = renderRenewalEmail(
      notificationEnvelopeSchema.parse({
        ...envelope,
        count: 22,
        rows: Array.from({ length: 20 }, (_, i) => ({
          ...envelope.rows[0],
          domain: `sample-${i + 1}.example`,
          registrar: 'Name.com',
          dateKind: 'renewal',
          expiryDate: '2026-11-25',
          failure: null,
          stale: true,
        })),
      }),
      'https://domains.domains',
      'synthetic',
      'https://domains.domains/preferences',
    );
    expect(mail.text).toContain('Showing 20 of 22 domains.');
    expect(mail.text).toContain('Date needs a fresh registrar check');
    expect(mail.text).toContain('Last checked: 2026-11-09 09:55 UTC');
    expect(mail.text).toContain(
      'Verify dates and renewal options with the registrar.',
    );
    expect(mail.html).toContain('sample-20.example');
    expect(mail.html.indexOf('Open Renewals')).toBeLessThan(
      mail.html.indexOf('sample-1.example'),
    );
    expect(mail.text.indexOf('Open Renewals')).toBeLessThan(
      mail.text.indexOf('sample-1.example'),
    );
    expect(mail.html).toContain(
      'href="https://domains.domains/w/synthetic/#/renewals"',
    );
    expect(mail.html).toContain('href="https://domains.domains/preferences"');
  });
  it('rejects contradictory summary counts', () => {
    expect(
      notificationEnvelopeSchema.safeParse({ ...envelope, attentionCount: 2 })
        .success,
    ).toBe(false);
  });
});
