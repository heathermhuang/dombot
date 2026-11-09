import { useCallback, useEffect, useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { hostPath, supportsNotifications } from '../lib/platform';
import { notificationRequest } from '../lib/notification-client';

interface Item {
  key: string;
  cycle: string;
  domain: string;
  date: string;
  stage: string;
  stale: boolean;
  decision: { value: 'expire' | 'handled'; revision: string } | null;
}
export default function RenewalReminderControls() {
  const [items, setItems] = useState<Item[]>([]),
    [open, setOpen] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [offset, setOffset] = useState(0),
    [count, setCount] = useState(0);
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
    const result = await notificationRequest(
      hostPath(
        '/notifications/decisions?timeZone=' +
          encodeURIComponent(zone) +
          '&offset=' +
          offset,
      ),
    );
    if (seq !== latest.current) return;
    setItems(result.items);
    setCount(result.count);
  }, [offset, zone]);
  useEffect(() => {
    if (open && supportsNotifications())
      void load().catch((e) => setError(e.message));
    return invalidate;
  }, [open, load, invalidate]);
  if (!supportsNotifications()) return null;
  const decide = async (item: Item, value: 'expire' | 'handled' | null) => {
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
    <section className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="ghost"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          Renewal reminder choices
        </Button>
        <Link className="text-sm underline" to="/settings?tab=notifications">
          Email preferences
        </Link>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {open && (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            These choices change reminders only. Mark handled dismisses the
            current reminder; it does not renew a name. Let expire stops
            ordinary deadline reminders for this cycle.
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              {count === 0
                ? 'No affected names'
                : offset +
                  1 +
                  '–' +
                  Math.min(offset + 20, count) +
                  ' of ' +
                  count}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy || offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 20))}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || offset + 20 >= count}
                onClick={() => setOffset(offset + 20)}
              >
                Next
              </Button>
            </div>
          </div>
          {items.length === 0 ? (
            <p className="mt-3 text-sm">
              No names are currently in the renewal review window.
            </p>
          ) : (
            <ul className="mt-3 divide-y">
              {items.map((item) => (
                <li
                  key={item.key}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="break-all font-medium">{item.domain}</p>
                    <p className="text-sm text-muted-foreground">
                      {item.date}
                      {item.stale ? ' · Needs refresh' : ''}
                      {item.decision
                        ? ' · ' +
                          (item.decision.value === 'expire'
                            ? 'Let expire'
                            : 'Current reminder handled')
                        : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {item.decision ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => void decide(item, null)}
                      >
                        Resume reminders
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => void decide(item, 'handled')}
                        >
                          Mark handled
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => void decide(item, 'expire')}
                        >
                          Let expire
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
