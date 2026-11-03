import { describe, expect, it } from 'vitest';
import {
  emptySale,
  publishedSaleSchema,
  saleMoneySchema,
  saleMinorUnits,
  salePriceLabel,
} from './hosted-sales';
import {
  salesProjection,
  sourcePriceFingerprint,
} from '../core/publication/sales';

describe('exact public offer money v2', () => {
  it('validates minor units and bounds without rounding', () => {
    expect(saleMinorUnits({ amount: '1479.09', currency: 'USD' })).toBe(
      147909n,
    );
    expect(saleMinorUnits({ amount: '1.001', currency: 'KWD' })).toBe(1001n);
    for (const [amount, currency] of [
      ['1.01', 'JPY'],
      ['1.001', 'USD'],
      ['0', 'USD'],
      ['1e3', 'USD'],
      ['1000000000000', 'USD'],
    ])
      expect(saleMoneySchema.safeParse({ amount, currency }).success).toBe(
        false,
      );
    expect(salePriceLabel({ amount: '1479.09', currency: 'USD' })).toBe(
      'USD 1,479.09',
    );
  });
  it('retains old whole-amount snapshots and explicitly emits version 2 on projection', () => {
    const price = {
      amount: '1479.09',
      currency: 'USD',
      floor: null,
      updatedAt: 1,
    };
    const draft = emptySale('working.io', sourcePriceFingerprint(price));
    draft.mode = 'offer';
    draft.minimumOffer = { amount: '1479.08', currency: 'USD' };
    const snapshot = salesProjection(draft, price, null, crypto.randomUUID());
    expect(snapshot.version).toBe(2);
    expect(snapshot.publicPrice?.amount).toBe('1479.09');
    expect(
      publishedSaleSchema.parse({
        ...snapshot,
        version: 1,
        publicPrice: { amount: '1479', currency: 'USD' },
      }).publicPrice?.amount,
    ).toBe('1479');
    expect(() =>
      salesProjection(
        { ...draft, minimumOffer: { amount: '1479.10', currency: 'USD' } },
        price,
        null,
        crypto.randomUUID(),
      ),
    ).toThrow(/Minimum/);
  });
});
