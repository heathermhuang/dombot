import { expect, it } from 'vitest';
import { salesDestinationLabel } from './sales-destination-label';

it('keeps distinct domain identities visible without long tracking parameters', () => {
  expect(
    salesDestinationLabel(
      'https://www.afternic.com/domain/one.example?utm_campaign=' +
        'x'.repeat(500),
    ),
  ).toBe('one.example · afternic.com');
  expect(
    salesDestinationLabel('https://www.afternic.com/domain/two.example'),
  ).toBe('two.example · afternic.com');
});
it('recognizes domain query parameters and safely bounds non-domain paths', () => {
  expect(
    salesDestinationLabel(
      'https://sedo.com/search/details/?domain=one.example',
    ),
  ).toBe('one.example · sedo.com');
  expect(
    salesDestinationLabel('https://market.example/' + 'x'.repeat(200)).length,
  ).toBeLessThan(80);
  expect(salesDestinationLabel('not a URL')).toBe('Destination unavailable');
});
