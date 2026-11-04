import { domainKey } from './account-key';
import type { Domain, RenewalPriceAge, RenewalPricing } from './ipc';
import { currencyInfo } from './money';
import { renewalPriceAge } from './renewal-price-age';

export interface RenewalCoverageGroup {
  age: RenewalPriceAge;
  source: RenewalPricing['source'];
  count: number;
  totals: { currency: string; amount: string }[];
}

/** Account-scoped holding records, no FX conversion or provider requests. */
export function renewalCoverage(
  rows: readonly Domain[],
  pricing: Record<string, RenewalPricing>,
  now = Date.now(),
): RenewalCoverageGroup[] {
  const groups = new Map<
    string,
    {
      age: RenewalPriceAge;
      source: RenewalPricing['source'];
      count: number;
      money: Map<string, bigint>;
    }
  >();
  for (const row of rows) {
    const price = pricing[domainKey(row)];
    const age = renewalPriceAge(price, now);
    const source = age === 'unavailable' ? 'unavailable' : price.source;
    const key = `${age}:${source}`;
    const group = groups.get(key) ?? {
      age,
      source,
      count: 0,
      money: new Map<string, bigint>(),
    };
    group.count++;
    if (age !== 'unavailable') {
      const places = currencyInfo(price.currency)!.decimals;
      const minor = BigInt(price.renewal!.toFixed(places).replace('.', ''));
      group.money.set(
        price.currency,
        (group.money.get(price.currency) ?? 0n) + minor,
      );
    }
    groups.set(key, group);
  }
  const order: RenewalPriceAge[] = [
    'stale',
    'unknown',
    'estimate',
    'manual',
    'current',
    'unavailable',
  ];
  return [...groups.values()]
    .sort(
      (a, b) =>
        order.indexOf(a.age) - order.indexOf(b.age) ||
        a.source.localeCompare(b.source),
    )
    .map(({ age, source, count, money }) => ({
      age,
      source,
      count,
      totals: [...money]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, minor]) => {
          const places = currencyInfo(currency)!.decimals;
          const value = minor.toString().padStart(places + 1, '0');
          return {
            currency,
            amount: places
              ? value.slice(0, -places) + '.' + value.slice(-places)
              : value,
          };
        }),
    }));
}
