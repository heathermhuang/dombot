import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import type { Domain, RenewalPricing } from '../../shared/ipc';
import { RenewalCoverage } from './RenewalCoverage';

afterEach(() => vi.unstubAllGlobals());
it('renders source/age coverage and separate observations from cached inputs only', () => {
  const now = Date.now();
  const rows = Array.from(
    { length: 25 },
    (_, i) =>
      ({
        domainName: `name${i}.example`,
        registrar: 'dynadot',
        accountId: 'one',
        accountLabel: 'Primary',
      }) as Domain,
  );
  const pricing: Record<string, RenewalPricing> = Object.fromEntries(
    rows.map((d, i) => [
      `one:${d.domainName}`,
      {
        domain: d.domainName,
        registrar: 'dynadot',
        renewal: i === 0 ? null : 10,
        currency: 'USD',
        source: i === 0 ? 'unavailable' : i === 1 ? 'tld' : 'api',
        observedAt: i === 1 ? undefined : now - 2 * 86400000,
        inventoryAt: now,
      },
    ]),
  );
  const before = structuredClone(pricing);
  const network = vi.fn(() => {
    throw Error('No network permitted');
  });
  vi.stubGlobal('fetch', network);
  const html = renderToStaticMarkup(
    createElement(RenewalCoverage, { rows, pricing }),
  );
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  expect(text).toContain('Stale quote');
  expect(text).toContain('Account TLD rate');
  expect(text).toContain('Quote observed');
  expect(text).toContain('Inventory observed');
  expect(text).toContain('USD 230.00');
  expect(text).toContain('USD 10.00');
  expect(text).toContain('page 1 of 2');
  expect(text).not.toContain('name24.example');
  expect(network).not.toHaveBeenCalled();
  expect(pricing).toEqual(before);
});
