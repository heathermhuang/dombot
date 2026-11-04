import { useEffect, useState } from 'react';
import type { Domain, RenewalPriceAge, RenewalPricing } from '../../shared/ipc';
import { domainKey } from '../../shared/account-key';
import { renewalCoverage } from '../../shared/renewal-coverage';
import {
  observationLabel,
  renewalPriceAge,
  RENEWAL_AGE_LABEL,
  RENEWAL_SOURCE_LABEL,
} from '../../shared/renewal-price-age';
import { PricingStatus } from './StatusBar';
import { Button } from './ui/button';

/** All inputs are existing owner cache projections. No API or scheduler work. */
export function RenewalCoverage({
  rows,
  pricing,
}: {
  rows: readonly Domain[];
  pricing: Record<string, RenewalPricing>;
}) {
  const [selected, setSelected] = useState<RenewalPriceAge | 'all'>('all');
  const [page, setPage] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Display-only clock. This never polls an API or advances pricing work.
    const update = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      clearTimeout(update);
      clearInterval(timer);
    };
  }, [pricing]);
  const groups = renewalCoverage(rows, pricing, now);
  const shown = rows.filter(
    (d) =>
      selected === 'all' ||
      renewalPriceAge(pricing[domainKey(d)], now) === selected,
  );
  const pages = Math.max(1, Math.ceil(shown.length / 20));
  const currentPage = Math.min(page, pages - 1);
  const duplicateNames =
    new Set(rows.map((d) => d.domainName)).size !== rows.length;
  return (
    <section
      aria-label="Renewal price coverage"
      className="rounded-md border p-3 text-sm"
    >
      <h2 className="font-semibold">Renewal price coverage</h2>
      <p className="text-muted-foreground">
        Quote age is separate from inventory sync. Current means observed within
        24 hours. Saved estimates remain visible while prices update.
      </p>
      <PricingStatus />
      <div className="my-3 overflow-x-auto">
        <table
          className="w-full text-left"
          aria-label="Renewal estimate subtotals"
        >
          <thead>
            <tr>
              <th className="p-2">Age</th>
              <th className="p-2">Source</th>
              <th className="p-2">Records</th>
              <th className="p-2">Annual estimate</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={`${group.age}:${group.source}`}>
                <td className="p-2">{RENEWAL_AGE_LABEL[group.age]}</td>
                <td className="p-2">{RENEWAL_SOURCE_LABEL[group.source]}</td>
                <td className="p-2 tabular-nums">{group.count}</td>
                <td className="p-2 tabular-nums">
                  {group.totals
                    .map((t) => `${t.currency} ${t.amount}`)
                    .join(' · ') || 'Unknown'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted-foreground">
        Each currency is subtotalled separately without conversion. Unavailable
        values are excluded, not treated as zero.
        {duplicateNames &&
          ' The same name is reported in multiple accounts; these totals count each account record and need reconciliation.'}
      </p>
      <details className="mt-3">
        <summary className="cursor-pointer font-medium">
          Inspect quote observations
        </summary>
        <label className="my-3 flex items-center gap-2">
          Price age
          <select
            aria-label="Price age"
            className="rounded border bg-background p-2"
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value as RenewalPriceAge | 'all');
              setPage(0);
            }}
          >
            <option value="all">All</option>
            {(
              [
                'stale',
                'unknown',
                'estimate',
                'manual',
                'current',
                'unavailable',
              ] as const
            ).map((age) => (
              <option key={age} value={age}>
                {RENEWAL_AGE_LABEL[age]}
              </option>
            ))}
          </select>
        </label>
        <div className="overflow-x-auto">
          <table
            className="w-full text-left"
            aria-label="Quote and inventory observations"
          >
            <thead>
              <tr>
                <th className="p-2">Domain / account</th>
                <th className="p-2">Source / age</th>
                <th className="p-2">Quote observed</th>
                <th className="p-2">Inventory observed</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(currentPage * 20, currentPage * 20 + 20).map((d) => {
                const p = pricing[domainKey(d)];
                return (
                  <tr key={domainKey(d)}>
                    <td className="p-2">
                      {d.domainName}
                      <span className="block text-muted-foreground">
                        {d.registrar} · {d.accountLabel || 'Default'}
                      </span>
                    </td>
                    <td className="p-2">
                      {RENEWAL_SOURCE_LABEL[p?.source ?? 'unavailable']}
                      <span className="block text-muted-foreground">
                        {RENEWAL_AGE_LABEL[renewalPriceAge(p, now)]}
                      </span>
                    </td>
                    <td className="p-2">{observationLabel(p?.observedAt)}</td>
                    <td className="p-2">{observationLabel(p?.inventoryAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {shown.length === 0 && <p>No records match this age.</p>}
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span>
            {shown.length} records · page {currentPage + 1} of {pages}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            Previous observations
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={currentPage + 1 >= pages}
            onClick={() => setPage(currentPage + 1)}
          >
            Next observations
          </Button>
        </div>
      </details>
    </section>
  );
}
