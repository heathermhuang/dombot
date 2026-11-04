import type { Domain } from '../../../shared/ipc';
import { hasPastReportedExpiry } from '../../../shared/ownership';
import { Button } from '../ui/button';

/** Read-only attention over the table's current slice; never a status mutation. */
export function ExpiryAttention({
  rows,
  now,
  active,
  onToggle,
}: {
  rows: readonly Domain[];
  now: number;
  active: boolean;
  onToggle: () => void;
}) {
  const count = rows.filter((d) => hasPastReportedExpiry(d, now)).length;
  if (!count && !active) return null;
  return (
    <section
      aria-label="Past reported expiry"
      className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/40 p-3 text-sm"
    >
      <div>
        <strong>
          {count} past reported expir{count === 1 ? 'y' : 'ies'} — verify
        </strong>
        <p className="text-muted-foreground">
          Still reported by the registrar. Check current status; the date alone
          does not establish loss or renewal eligibility.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onToggle}>
        {active ? 'Show all domains' : 'Review these domains'}
      </Button>
    </section>
  );
}
