import { describe, expect, it } from 'vitest';
import { STALE_AFTER_MS, type Domain, type RenewalPricing } from './ipc';
import {
  observedPricing,
  renewalPriceAge,
  renewalProgressText,
} from './renewal-price-age';
import { renewalCoverage } from './renewal-coverage';

const now = Date.parse('2026-11-04T08:00:00Z');
const price = (patch: Partial<RenewalPricing> = {}): RenewalPricing => ({
  domain: 'a.example',
  registrar: 'dynadot',
  renewal: 0.1,
  currency: 'USD',
  source: 'api',
  observedAt: now,
  ...patch,
});
describe('renewal observation age', () => {
  it('shows simultaneous pending, blocked and failed work without changing the queue', () => {
    const progress = {
      remaining: 1,
      blocked: 2,
      failed: 3,
      nextAt: now + 600000,
    };
    const before = structuredClone(progress);
    const text = renewalProgressText(progress, 0, now);
    expect(text).toContain('1 renewal prices pending');
    expect(text).toContain('2 renewal prices waiting for inventory recovery');
    expect(text).toContain('3 renewal prices could not update');
    expect(progress).toEqual(before);
    expect(renewalProgressText({ remaining: 0, failed: 0 }, 0, now)).toBeNull();
  });
  it('keeps independent inventory and quote observations, with a strict 24-hour boundary', () => {
    expect(
      observedPricing(price(), now - STALE_AFTER_MS, now, now),
    ).toMatchObject({
      observedAt: now - STALE_AFTER_MS,
      inventoryAt: now,
      priceAge: 'stale',
      renewal: 0.1,
    });
    expect(
      renewalPriceAge(price({ observedAt: now - STALE_AFTER_MS + 1 }), now),
    ).toBe('current');
  });
  it.each([undefined, 0, -1, NaN, Infinity, now + 1, 1.5])(
    'keeps malformed/missing/future quote time %s unknown',
    (observedAt) => {
      expect(observedPricing(price(), observedAt, now, now)).toMatchObject({
        observedAt: undefined,
        priceAge: 'unknown',
        inventoryAt: now,
      });
    },
  );
  it('does not treat manual/TLD/base rates as dated per-name quotes', () => {
    for (const source of ['tld', 'base', 'manual'] as const) {
      expect(observedPricing(price({ source }), now, now, now)).toMatchObject({
        observedAt: undefined,
        priceAge: source === 'manual' ? 'manual' : 'estimate',
      });
    }
    expect(
      observedPricing(
        price({ source: 'portal', observedAt: now - STALE_AFTER_MS }),
        now,
        now,
        now,
      ).priceAge,
    ).toBe('stale');
  });
  it('does not label invalid prices or unknown currencies current', () => {
    for (const p of [
      price({ renewal: null }),
      price({ renewal: -1 }),
      price({ renewal: NaN }),
      price({ renewal: 1e15 }),
      price({ currency: 'XYZ' }),
    ])
      expect(renewalPriceAge(p, now)).toBe('unavailable');
    expect(observedPricing(price(), now, now + 1, now).inventoryAt).toBeNull();
  });
});

it('reconciles source/age subtotals exactly per currency and preserves separate accounts', () => {
  const row = (accountId: string): Domain =>
    ({ domainName: 'a.example', registrar: 'dynadot', accountId }) as Domain;
  const rows = [
    row('one'),
    row('two'),
    row('three'),
    row('four'),
    row('missing'),
  ];
  const pricing = {
    'one:a.example': price(),
    'two:a.example': price({ renewal: 0.2 }),
    'three:a.example': price({ renewal: 1.234, currency: 'KWD' }),
    'four:a.example': price({ renewal: 5, source: 'tld' }),
  };
  const before = structuredClone(pricing);
  const groups = renewalCoverage(rows, pricing, now);
  expect(groups.reduce((sum, g) => sum + g.count, 0)).toBe(5);
  expect(groups.find((g) => g.age === 'current')?.totals).toEqual([
    { currency: 'KWD', amount: '1.234' },
    { currency: 'USD', amount: '0.30' },
  ]);
  expect(groups.find((g) => g.age === 'unavailable')).toMatchObject({
    count: 1,
    totals: [],
  });
  expect(pricing).toEqual(before);
});
