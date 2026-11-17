import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  RenewalReviewTable,
  type RenewalReviewItem,
} from './RenewalReminderControls';
import { renewalReview } from '../../shared/renewal-review';
const at = Date.parse('2026-11-17T01:00:00Z');
const item: RenewalReviewItem = {
  key: 'recovery.example|2026-11-01|past-expiry',
  cycle: 'recovery.example|2026-11-01',
  stage: 'past-expiry',
  domain: 'recovery.example',
  registrar: 'Dynadot',
  registrarId: 'dynadot',
  account: 'Primary',
  date: '2026-11-01',
  dateKind: 'expiry',
  expiryDate: '2026-11-01',
  autoRenew: true,
  stale: false,
  imported: false,
  observedAt: at - 60000,
  price: 'USD 16.98 (last known quote)',
  failure: null,
  decision: null,
};
const render = (row: RenewalReviewItem, busy = false) =>
  renderToStaticMarkup(
    createElement(RenewalReviewTable, {
      items: [row],
      at,
      busy,
      onDecide: () => {},
    }),
  );
describe('renewal review actions', () => {
  it('shows actionable account and expiry facts without claiming that recovery is available or costs the ordinary renewal price', () => {
    const html = render(item);
    for (const value of [
      'Dynadot',
      'Primary',
      'Reported expiry passed',
      'Expiry: 2026-11-01',
      'Check renewal or recovery now',
      'https://dynadot.com/',
      'Mark handled',
      'Let expire',
    ])
      expect(html).toContain(value);
    expect(html).toContain('scope="col"');
    expect(html).not.toContain('USD 16.98');
    expect(html).not.toContain('recovery guaranteed');
  });
  it('renders handled choices and disables writes while a request is pending', () => {
    const html = render(
      { ...item, decision: { value: 'handled', revision: 'synthetic' } },
      true,
    );
    expect(html).toContain('Current reminder handled');
    expect(html).toContain('Resume reminders');
    expect(html).toContain('disabled');
    expect(html).not.toContain('>Let expire<');
  });
  it('preserves date meaning and uncertainty and escapes names and account labels', () => {
    const html = render({
      ...item,
      domain: '<script>unsafe</script>',
      account: '<Primary>',
      registrar: undefined,
      registrarId: undefined,
      stale: true,
      date: '2026-12-01',
      dateKind: 'renewal',
    });
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('Registrar not recorded');
    expect(html).toContain('Needs refresh');
    expect(html).toContain('Renewal deadline: 2026-12-01');
    expect(html).toContain('Expiry: 2026-11-01');
    expect(html).not.toContain('href=');
  });
  it('uses distinct pending-delete, redemption and upcoming next steps in both renderers', () => {
    expect(
      renewalReview({ ...item, expiryStatus: 'pendingdelete' }, at).nextStep,
    ).toContain('restoration may no longer be possible');
    expect(
      renewalReview({ ...item, expiryStatus: 'redemptionperiod' }, at).status,
    ).toBe('Redemption reported');
    const r = renewalReview(
      {
        ...item,
        expiryDate: '2026-12-01',
        date: '2026-12-01',
        autoRenew: false,
      },
      at,
    );
    expect(r.recovery).toBe(false);
    expect(r.link?.label).toBe('Renew at Dynadot');
    expect(r.estimate).toContain('USD 16.98');
  });
});
