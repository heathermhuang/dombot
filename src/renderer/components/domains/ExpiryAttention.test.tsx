import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Domain } from '../../../shared/ipc';
import { ExpiryAttention } from './ExpiryAttention';

const now = Date.parse('2026-11-04T07:00:00Z');
const past = {
  domainName: 'past.example',
  registrar: 'dynadot',
  source: 'registrar',
  expirationDate: new Date(now - 3 * 86400000),
  autoRenew: true,
} as Domain;
const render = (rows: Domain[], active = false) =>
  renderToStaticMarkup(
    createElement(ExpiryAttention, { rows, now, active, onToggle: () => {} }),
  );
describe('expiry verification attention', () => {
  it('shows held past dates without declaring expiry, loss or a provider action', () => {
    const html = render([
      past,
      { ...past, source: 'imported' },
      { ...past, departed: true },
    ]);
    expect(html).toContain('1 past reported expiry');
    expect(html).toContain('Review these domains');
    expect(html).toContain('date alone does not establish loss');
    expect(html).not.toContain('Expired');
  });
  it('keeps an empty active filter recoverable and hides an empty inactive notice', () => {
    expect(render([])).toBe('');
    expect(render([], true)).toContain('Show all domains');
  });
});
