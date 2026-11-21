import { useCallback, useEffect, useRef, useState } from 'react';
import type { ParkioSourceView } from '../../shared/parkio';
import { PARKIO_STATUS, parkioStatus } from '../../shared/parkio-status';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { hostPath, webAuthMode } from '../lib/platform';
import { useAppStore } from '../store/app';
import { toast } from 'sonner';
const root = '/connectors/parkio';
const when = (time: number | null) =>
  time === null ? 'Not checked yet' : new Date(time).toLocaleString();
const messages: Record<string, string> = {
  conflict: 'The connection changed. Its latest status is loaded below.',
  check_cooldown:
    'Park.io can be refreshed once an hour. Your saved domains are available.',
  connection_not_ready:
    'Refresh the Park.io status to see what is needed before updating.',
  account_mismatch:
    'This is a different Park.io account. Add it as a separate connection.',
  sign_in_required:
    'Reconnect Park.io to resume updates. Your saved domains are still available.',
  session_outcome_unknown:
    'The sign-in outcome is uncertain. Reconnect to continue safely.',
  check_outcome_unknown:
    'The last check was interrupted. Reconnect to continue safely.',
  schema_changed:
    'Park.io changed its export format. Your saved domains are kept.',
  request_limit: 'Too many connection requests. Please try again later.',
  cleanup_required:
    'The previous Park.io sign-in browser is still closing. Try again in a few minutes. Your saved domains are still available.',
  browser_cleanup_failed:
    'The previous Park.io sign-in browser is still closing. Try again in a few minutes. Your saved domains are still available.',
  daily_browser_budget:
    'Park.io has reached today’s sign-in limit. Try again after the daily reset. Your saved domains are still available.',
  browser_capacity:
    'Sign-in is temporarily at capacity. Please try again shortly.',
  review_expired:
    'This review expired. Keep the saved inventory, then check again.',
};
async function request<T>(
  path: string,
  body?: unknown,
  gateway = false,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(gateway ? path : hostPath(path), {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    redirect: 'manual',
    headers: {
      Accept: 'application/json',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(45000)])
      : AbortSignal.timeout(45000),
  });
  if (response.status === 303 || response.type === 'opaqueredirect') {
    window.location.assign('/login');
    throw Error('Sign in to Domains.Domains to continue.');
  }
  const value = (await response.json().catch(() => null)) as
    | (T & {
        error?: string;
        reauth?: string;
        retryAt?: number;
      })
    | null;
  if (response.status === 428 && value?.reauth?.startsWith('/account/reauth')) {
    window.location.assign(value.reauth);
    throw Error('Confirm your identity to continue.');
  }
  if (
    value?.error === 'daily_browser_budget' &&
    typeof value.retryAt === 'number' &&
    Number.isFinite(value.retryAt) &&
    value.retryAt > 0 &&
    value.retryAt <= Date.now() + 2 * 86400_000
  ) {
    const next = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(value.retryAt);
    throw Error(
      `Park.io has reached today’s sign-in limit. Try again after ${next}. Your saved domains are still available.`,
    );
  }
  if (!response.ok || value === null)
    throw Error(
      value?.error && messages[value.error]
        ? messages[value.error]
        : 'Park.io could not complete this request. Your saved inventory is kept.',
    );
  return value;
}
type Review = {
  revision: string;
  total: number;
  offset: number;
  changes: {
    domain: string;
    kind: string;
    previousExpirationDate: string | null;
    expirationDate: string | null;
  }[];
};
export function ParkioSources({ focused }: { focused: boolean }) {
  const [state, setState] = useState<{
    enabled: boolean;
    automaticUpdates?: boolean;
    sources: ParkioSourceView[];
  }>({ enabled: false, sources: [] });
  const [canConnect, setCanConnect] = useState(false);
  const [loading, setLoading] = useState(true);
  const section = useRef<HTMLDetailsElement>(null);
  const sourceRequest = useRef(0);
  const [saved, setSaved] = useState<{ available: boolean; count?: number }>({
    available: false,
  });
  const [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null),
    [review, setReview] = useState<{ sourceId: string; data: Review } | null>(
      null,
    );
  const intent = useRef<{ target: string; key: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const polls = useRef({ key: '', count: 0 });
  const updatePortfolioCache = useAppStore((s) => s.applyPortfolioCacheUpdate);
  const knownSources = useAppStore((s) => s.parkioSources.length);
  const loadSources = useCallback(async (signal?: AbortSignal) => {
    const revision = ++sourceRequest.current;
    const next = await request<typeof state>(root, undefined, false, signal);
    if (!signal?.aborted && revision === sourceRequest.current) {
      setNow(Date.now());
      setState(next);
    }
    return next;
  }, []);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      const [inventory, availability] = await Promise.allSettled([
        loadSources(signal),
        request<{ enabled: boolean }>(
          root + '/availability',
          undefined,
          true,
          signal,
        ),
      ]);
      if (signal?.aborted) return;
      if (availability.status === 'fulfilled') {
        setCanConnect(availability.value.enabled);
        const nextSaved = availability.value.enabled
          ? await request<typeof saved>(
              root + '/saved-session',
              undefined,
              true,
              signal,
            )
          : { available: false };
        if (!signal?.aborted) setSaved(nextSaved);
      } else {
        throw availability.reason;
      }
      if (inventory.status === 'rejected' && availability.value.enabled)
        throw inventory.reason;
    },
    [loadSources],
  );
  const hosted = webAuthMode() === 'gateway';
  const visible =
    hosted &&
    (focused || canConnect || state.sources.length > 0 || knownSources > 0);
  useEffect(() => {
    if (!hosted) return;
    const controller = new AbortController();
    void load(controller.signal)
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : 'Could not load Park.io.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [hosted, load]);
  useEffect(() => {
    if (!focused || !visible) return;
    section.current?.scrollIntoView({ block: 'start' });
    section.current?.querySelector('summary')?.focus({ preventScroll: true });
  }, [focused, visible]);
  useEffect(() => {
    const next = state.sources
      .map((s) => (s.lastAttemptAt ?? 0) + 3600000)
      .filter((t) => t > now)
      .sort((a, b) => a - b)[0];
    if (!next) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(1000, next - Date.now() + 1),
    );
    return () => clearTimeout(timer);
  }, [state.sources, now]);
  useEffect(() => {
    const pending = state.sources
      .filter((s) => s.sync === 'running')
      .map((s) => `${s.id}/${s.lastAttemptAt}/${s.activationId}`)
      .join(',');
    if (!pending) {
      polls.current = { key: '', count: 0 };
      return;
    }
    if (polls.current.key !== pending)
      polls.current = { key: pending, count: 0 };
    if (polls.current.count++ >= 20) return;
    const timer = setTimeout(() => {
      void loadSources()
        .then((next) => {
          if (!next.sources.some((source) => source.sync === 'running'))
            return updatePortfolioCache();
        })
        .catch(() => {
          setError(
            'Could not load the latest Park.io status. Refresh status to retry.',
          );
        });
    }, 1500);
    return () => clearTimeout(timer);
  }, [state.sources, loadSources, updatePortfolioCache]);
  if (!visible) return null;
  const run = async (id: string, work: () => Promise<void>) => {
    if (busy) return;
    setBusy(id);
    setError(null);
    try {
      await work();
    } catch (e) {
      const message =
        e instanceof Error ? e.message : 'Could not update Park.io.';
      setError(message);
      toast.error(message);
      try {
        await load();
      } catch {
        /* Keep the visible last-good state. */
      }
    } finally {
      setBusy(null);
    }
  };
  const connect = (source?: ParkioSourceView) =>
    run(source?.id ?? 'connect', async () => {
      const target = source ? `${source.id}/${source.revision}` : 'new';
      if (intent.current?.target !== target)
        intent.current = { target, key: crypto.randomUUID() };
      const value = await request<{ url: string }>(
        root + '/start',
        {
          intentKey: intent.current.key,
          ...(source ? { sourceId: source.id, revision: source.revision } : {}),
        },
        true,
      );
      if (
        !new RegExp('^' + root + '/native\\?intent=[a-f0-9-]{36}$').test(
          value.url,
        )
      )
        throw Error('The sign-in could not be opened.');
      intent.current = null;
      window.location.assign(value.url);
    });
  const action = (source: ParkioSourceView, kind: string) =>
    run(source.id, async () => {
      await request(root + '/' + source.id + '/' + kind, {
        revision: source.revision,
      });
      setReview(null);
      await loadSources();
      await updatePortfolioCache();
    });
  const showReview = (sourceId: string, offset = 0) =>
    run('review', async () => {
      setReview({
        sourceId,
        data: await request<Review>(
          root + '/' + sourceId + '/review?offset=' + offset,
        ),
      });
    });
  const status =
    state.sources.length === 1
      ? PARKIO_STATUS[parkioStatus(state.sources[0])].label
      : state.sources.length > 1
        ? `${state.sources.length} accounts`
        : loading
          ? 'Loading…'
          : '';
  return (
    <details
      aria-label="Park.io inventory"
      className="space-y-4 rounded-md border bg-card p-4"
      open={focused || undefined}
      ref={section}
    >
      <summary className="min-h-11 cursor-pointer font-medium">
        Park.io
        {status && (
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            · {status}
          </span>
        )}
      </summary>
      <p className="text-sm text-muted-foreground">
        Read-only inventory of active domains and expiry dates. Automatic
        updates run about once a day.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {(error || state.sources.some((source) => source.sync === 'running')) && (
        <Button
          variant="outline"
          className="min-h-11 self-start"
          disabled={!!busy}
          onClick={() =>
            void run('status', async () => {
              await load();
              await updatePortfolioCache();
            })
          }
        >
          Refresh status
        </Button>
      )}
      {saved.available && (
        <Card className="flex flex-col gap-3 p-5">
          <h4 className="font-medium">Use your verified Park.io sign-in</h4>
          <p className="text-sm text-muted-foreground">
            Add your {saved.count ?? ''} verified domains without signing in
            again. Your encrypted session will be saved for up to 30 days, or
            until it expires or you disconnect.
          </p>
          <Button
            className="min-h-11 w-full sm:w-auto sm:self-start"
            disabled={!!busy || !state.enabled}
            onClick={() =>
              void run('saved', async () => {
                const result = await request<{ pending?: boolean }>(
                  root + '/owner-session',
                  { consent: 'save_parkio_session_30_days' },
                  true,
                );
                if (result.pending) {
                  setError(
                    'Your connection is still being saved. Refresh its status shortly.',
                  );
                  return;
                }
                await load();
                await updatePortfolioCache();
                toast.success('Park.io connected');
              })
            }
          >
            {busy === 'saved'
              ? 'Connecting…'
              : 'Add domains and enable updates →'}
          </Button>
        </Card>
      )}
      {state.sources.map((source) => {
        const status = parkioStatus(source);
        const pending = status === 'running';
        const needsSignIn = source.connection !== 'connected';
        return (
          <Card key={source.id} className="flex flex-col gap-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-medium">
                {source.label}
                {state.sources.length > 1 ? ` · ${source.id.slice(0, 4)}` : ''}
              </h4>
              <span className="text-sm text-muted-foreground">
                {PARKIO_STATUS[status].label}
              </span>
            </div>
            <p className="text-sm">
              {source.count.toLocaleString()} saved domain
              {source.count === 1 ? '' : 's'} · Last updated{' '}
              {when(source.lastSuccessfulCheckAt)}
            </p>
            <p className="text-sm text-muted-foreground">
              {pending
                ? 'Checking for changes to your Park.io domains.'
                : needsSignIn
                  ? canConnect
                    ? 'Your saved domains are still available.'
                    : 'Your saved domains are available. Reconnecting is currently unavailable.'
                  : source.pending
                    ? 'Review changes before updating your saved domains.'
                    : source.paused
                      ? 'Resume updates to check for changes again.'
                      : state.automaticUpdates === false
                        ? 'Automatic sync is off. You can still update manually.'
                        : source.nextAttemptAt
                          ? `Next update ${when(source.nextAttemptAt)}`
                          : 'No update is scheduled.'}
            </p>
            {source.error && !needsSignIn && !pending && (
              <p className="text-sm text-muted-foreground">
                {messages[source.error] ??
                  'The last check needs attention. Your saved inventory is kept.'}
              </p>
            )}
            {source.pending && (
              <div className="flex flex-col gap-2">
                <p className="text-sm">
                  {source.pending.summary.added} new ·{' '}
                  {source.pending.summary.updated} updated ·{' '}
                  {source.pending.summary.missing} missing from the latest
                  export. Missing names remain saved.
                </p>
                <Button
                  className="min-h-11 self-start"
                  disabled={!!busy}
                  onClick={() => void showReview(source.id)}
                >
                  Review Park.io changes
                </Button>
                <Button
                  variant="outline"
                  className="min-h-11"
                  disabled={!!busy}
                  onClick={() => void action(source, 'reject_review')}
                >
                  Keep saved domains
                </Button>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {needsSignIn ? (
                <Button
                  className="min-h-11"
                  disabled={!!busy || !canConnect || !state.enabled || pending}
                  onClick={() => void connect(source)}
                >
                  Reconnect Park.io
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={
                      !!busy ||
                      !state.enabled ||
                      source.paused ||
                      pending ||
                      !!source.pending ||
                      (source.lastAttemptAt !== null &&
                        now - source.lastAttemptAt < 3600000)
                    }
                    onClick={() => void action(source, 'refresh')}
                  >
                    Update Park.io
                  </Button>
                  <Button
                    variant={source.paused ? 'default' : 'outline'}
                    className="min-h-11"
                    disabled={
                      !!busy ||
                      pending ||
                      !!source.pending ||
                      (source.paused && !state.enabled)
                    }
                    onClick={() =>
                      void action(source, source.paused ? 'resume' : 'pause')
                    }
                  >
                    {source.paused ? 'Resume updates' : 'Pause updates'}
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={!!busy || pending}
                    onClick={() => void action(source, 'disconnect')}
                  >
                    Disconnect
                  </Button>
                </>
              )}
              <a
                href="https://park.io/orders/index/active"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center px-3 text-sm underline"
              >
                Open Park.io ↗
              </a>
            </div>
            {!needsSignIn &&
              !pending &&
              !source.paused &&
              !source.pending &&
              source.lastAttemptAt !== null &&
              now - source.lastAttemptAt < 3600000 && (
                <p className="text-xs text-muted-foreground">
                  Next manual update after{' '}
                  {when(source.lastAttemptAt + 3600000)}.
                </p>
              )}
            {review?.sourceId === source.id && (
              <div
                className="flex flex-col gap-3 border-t pt-4"
                aria-label="Review Park.io changes"
              >
                <h5 className="font-medium">Changes in the latest export</h5>
                <ul className="divide-y">
                  {review.data.changes.map((change) => (
                    <li key={change.domain} className="py-3 text-sm">
                      <strong className="break-all">{change.domain}</strong>
                      <p className="text-muted-foreground">
                        {change.kind === 'missing'
                          ? 'Missing from this export; the domain stays saved.'
                          : change.kind === 'added'
                            ? 'New domain'
                            : `Expiry: ${change.previousExpirationDate ?? 'unknown'} → ${change.expirationDate ?? 'unknown'}`}
                      </p>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  {review.data.offset > 0 && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        void showReview(
                          source.id,
                          Math.max(0, review.data.offset - 100),
                        )
                      }
                    >
                      Previous 100
                    </Button>
                  )}
                  {review.data.offset + review.data.changes.length <
                    review.data.total && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        void showReview(source.id, review.data.offset + 100)
                      }
                    >
                      Next 100
                    </Button>
                  )}
                  <Button
                    className="min-h-11"
                    disabled={
                      !!busy || review.data.revision !== source.revision
                    }
                    onClick={() => void action(source, 'accept_review')}
                  >
                    Apply these changes
                  </Button>
                </div>
              </div>
            )}
          </Card>
        );
      })}
      {!saved.available && canConnect && state.enabled && (
        <Button
          variant="outline"
          className="min-h-11 w-full sm:w-auto sm:self-start"
          disabled={!!busy}
          onClick={() => void connect()}
        >
          {state.sources.length
            ? 'Add another Park.io account'
            : 'Connect Park.io'}
        </Button>
      )}
    </details>
  );
}
