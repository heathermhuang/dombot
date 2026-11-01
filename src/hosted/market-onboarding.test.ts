import { describe, it, expect } from 'vitest';
import {
  validFirstMarketConnection,
  portfolioStart,
  onboardingScript,
} from './on-demand-views';
import { MARKET_CREDENTIAL_FIELDS } from '../shared/market-credentials';
import { marketCatalog } from '../core/services/markets/registry';
describe('hosted marketplace onboarding', () => {
  it('shares the upstream credential catalog instead of accepting arbitrary fields or providers', () => {
    for (const market of marketCatalog())
      expect(MARKET_CREDENTIAL_FIELDS[market.id]).toEqual(market.configFields);
  });
  it.each(['afternic', 'atom', 'sedo'] as const)(
    'accepts complete %s credentials and rejects incomplete or oversized requests',
    (market) => {
      const creds = Object.fromEntries(
        MARKET_CREDENTIAL_FIELDS[market].map((f) => [f.name, 'synthetic']),
      );
      expect(validFirstMarketConnection({ args: [market, creds] })).toBe(true);
      expect(validFirstMarketConnection({ args: [market, {}] })).toBe(false);
      expect(
        validFirstMarketConnection({
          args: [market, { ...creds, password: 'x'.repeat(4097) }],
        }),
      ).toBe(false);
      expect(
        validFirstMarketConnection({ args: [market, creds, 'x'.repeat(101)] }),
      ).toBe(false);
    },
  );
  it('rejects malformed input before allocating and exposes the credential-gated first connection', () => {
    for (const input of [
      null,
      {},
      { args: ['unknown', {}] },
      { args: ['atom', []] },
      { args: ['atom', { apiToken: 42, userId: 'x' }] },
    ])
      expect(validFirstMarketConnection(input)).toBe(false);
    const html = portfolioStart('11111111-1111-4111-8111-111111111111');
    expect(html).toContain('/api/connectMarketAccount');
    expect(html).toContain('data-first-market');
    expect(onboardingScript).toContain('form.reportValidity()');
  });
});
