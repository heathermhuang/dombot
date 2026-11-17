import { useCallback, useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { hostPath, supportsNotifications } from '../lib/platform';
import { notificationRequest } from '../lib/notification-client';
import type { RenewalNoticeRow } from '../../shared/notification-policy';
import { renewalReview } from '../../shared/renewal-review';

export interface RenewalReviewItem extends RenewalNoticeRow {
  key: string;
  cycle: string;
  stage: string;
  decision: { value: 'expire' | 'handled'; revision: string } | null;
}
type Decision = 'expire' | 'handled' | null;

export function RenewalReviewTable({
  items,
  at,
  busy,
  onDecide,
}: {
  items: RenewalReviewItem[];
  at: number;
  busy: boolean;
  onDecide: (item: RenewalReviewItem, value: Decision) => void;
}) {
  const cell = 'block border-t px-3 py-3 align-top lg:table-cell';
  const label = (text: string) => (
    <span className="mb-1 block font-medium text-muted-foreground lg:hidden">
      {text}
    </span>
  );
  return (
    <table
      className="block w-full text-left text-sm lg:table"
      aria-label="Renewal and recovery actions"
    >
      <thead className="hidden lg:table-header-group">
        <tr>
          {[
            'Domain',
            'Registrar / account',
            'Date / status',
            'Next step',
            'Reminder choice',
          ].map((text) => (
            <th
              key={text}
              scope="col"
              className="px-3 py-3 font-medium text-muted-foreground"
            >
              {text}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="block lg:table-row-group">
        {items.map((item) => {
          const review = renewalReview(item, at);
          return (
            <tr
              key={item.key}
              className="mb-4 block rounded-lg border lg:mb-0 lg:table-row lg:rounded-none lg:border-0"
            >
              <td className={cell}>
                {label('Domain')}
                <p className="break-all font-semibold">{item.domain}</p>
                <p className="mt-1 text-muted-foreground">{review.estimate}</p>
                <p className="mt-1 text-muted-foreground">{review.setup}</p>
              </td>
              <td className={cell}>
                {label('Registrar / account')}
                <p className="font-medium">{review.registrar}</p>
                <p className="break-words text-muted-foreground">
                  Account: {item.account || 'Not recorded'}
                </p>
              </td>
              <td className={cell}>
                {label('Date / status')}
                <p
                  className={
                    review.recovery
                      ? 'font-medium text-amber-700 dark:text-amber-300'
                      : 'font-medium'
                  }
                >
                  {review.status}
                </p>
                {review.dates.map((date) => (
                  <p className="whitespace-nowrap" key={date}>
                    {date}
                  </p>
                ))}
                <p className="mt-1 text-muted-foreground">
                  Observed: {review.observed}
                </p>
                {item.stale && (
                  <p className="text-amber-700 dark:text-amber-300">
                    Needs refresh: previous observation
                  </p>
                )}
                {item.imported && (
                  <p className="text-muted-foreground">
                    User-supplied date; unverified
                  </p>
                )}
              </td>
              <td className={cell}>
                {label('Next step')}
                <p>{review.nextStep}</p>
                {review.link && (
                  <a
                    href={review.link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex min-h-11 items-center font-medium underline underline-offset-4"
                  >
                    {review.link.label}
                  </a>
                )}
              </td>
              <td className={cell}>
                {label('Reminder choice')}
                <div className="flex flex-wrap gap-2">
                  {item.decision ? (
                    <>
                      <p className="w-full text-muted-foreground">
                        {item.decision.value === 'expire'
                          ? 'Let expire'
                          : 'Current reminder handled'}
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => onDecide(item, null)}
                      >
                        Resume reminders
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => onDecide(item, 'handled')}
                      >
                        Mark handled
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => onDecide(item, 'expire')}
                      >
                        Let expire
                      </Button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function RenewalReminderControls() {
  const [items, setItems] = useState<RenewalReviewItem[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [offset, setOffset] = useState(0),
    [count, setCount] = useState(0),
    [at, setAt] = useState(() => Date.now());
  const [zone, setZone] = useState('UTC');
  const latest = useRef(0);
  useEffect(() => {
    if (supportsNotifications())
      void notificationRequest('/account/notifications')
        .then((r) => setZone(r.preferences.timeZone))
        .catch((e) => setError(e.message));
  }, []);
  const invalidate = useCallback(() => {
    latest.current++;
  }, []);
  const load = useCallback(async () => {
    const seq = ++latest.current;
    setLoading(true);
    try {
      const result = await notificationRequest(
        hostPath(
          '/notifications/decisions?timeZone=' +
            encodeURIComponent(zone) +
            '&offset=' +
            offset,
        ),
      );
      if (seq !== latest.current) return;
      if (offset > 0 && result.items.length === 0) {
        setOffset(Math.max(0, Math.ceil(result.count / 20) * 20 - 20));
        return;
      }
      setItems(result.items);
      setCount(result.count);
      setAt(result.at ?? Date.now());
      setError('');
    } finally {
      if (seq === latest.current) setLoading(false);
    }
  }, [offset, zone]);
  useEffect(() => {
    if (supportsNotifications()) void load().catch((e) => setError(e.message));
    return invalidate;
  }, [load, invalidate]);
  if (!supportsNotifications()) return null;
  const decide = async (item: RenewalReviewItem, value: Decision) => {
    setBusy(true);
    setError('');
    try {
      await notificationRequest(hostPath('/notifications/decisions'), 'POST', {
        key:
          value === 'expire' || item.decision?.value === 'expire'
            ? item.cycle
            : item.key,
        value,
        revision: item.decision?.revision ?? null,
        timeZone: zone,
      });
      await load();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not save this reminder choice.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      id="renewal-actions"
      className="rounded-xl border bg-card p-4"
      aria-labelledby="renewal-actions-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="renewal-actions-heading" className="text-lg font-semibold">
            Renewal and recovery actions
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Check past-expiry domains first. Use the named registrar account to
            renew or ask about recovery.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={busy || loading}
            onClick={() => void load().catch((e) => setError(e.message))}
          >
            Refresh review
          </Button>
          <Link className="text-sm underline" to="/settings?tab=notifications">
            Email preferences
          </Link>
        </div>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        Dates are UTC. Confirm renewal or recovery availability, fees and final
        deadlines in the named registrar account. Mark handled and Let expire
        change reminders only. After renewing, sync Domains to confirm the
        updated expiry.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        This review uses cached inventory.{' '}
        <Link className="underline" to="/">
          Open Domains to sync registrar data
        </Link>
        .
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {loading && (
        <p role="status" className="mt-3 text-sm">
          Loading renewal review…
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">
          {count === 0
            ? 'No affected names'
            : `${offset + 1}–${Math.min(offset + 20, count)} of ${count}`}{' '}
          · Review as of{' '}
          {new Date(at).toISOString().slice(0, 16).replace('T', ' ')} UTC
        </span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy || loading || offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 20))}
          >
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || loading || offset + 20 >= count}
            onClick={() => setOffset(offset + 20)}
          >
            Next
          </Button>
        </div>
      </div>
      {items.length ? (
        <RenewalReviewTable
          items={items}
          at={at}
          busy={busy || loading}
          onDecide={(item, value) => void decide(item, value)}
        />
      ) : (
        !loading &&
        !error && (
          <p className="mt-3 text-sm">
            No domains currently need a renewal or recovery review.
          </p>
        )
      )}
    </section>
  );
}
