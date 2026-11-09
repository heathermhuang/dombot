import { useCallback, useEffect, useRef, useState } from 'react';
import type { ParkioSourceView } from '../../shared/parkio';
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
  account_mismatch:
    'This is a different Park.io account. Add it as a separate connection.',
  sign_in_required: 'Park.io needs a new sign-in. Your saved domains are kept.',
  session_outcome_unknown:
    'The sign-in outcome is uncertain. Reconnect to continue safely.',
  check_outcome_unknown:
    'The last check was interrupted. Reconnect to continue safely.',
  schema_changed:
    'Park.io changed its export format. Your saved domains are kept.',
  request_limit: 'Too many connection requests. Please try again later.',
  browser_capacity:
    'Sign-in is temporarily at capacity. Please try again shortly.',
  review_expired:
    'This review expired. Keep the saved inventory, then check again.',
};
async function request<T>(
  path: string,
  body?: unknown,
  gateway = false,
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
    signal: AbortSignal.timeout(45000),
  });
  if (response.status === 303 || response.type === 'opaqueredirect') {
    window.location.assign('/login');
    throw Error('Sign in to Domains.Domains to continue.');
  }
  const value = (await response.json()) as T & {
    error?: string;
    reauth?: string;
  };
  if (response.status === 428 && value.reauth?.startsWith('/account/reauth')) {
    window.location.assign(value.reauth);
    throw Error('Confirm your identity to continue.');
  }
  if (!response.ok)
    throw Error(
      value.error && messages[value.error]
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
export function ParkioSources() {
  const [state, setState] = useState<{
    enabled: boolean;
    automaticUpdates?: boolean;
    sources: ParkioSourceView[];
  }>({ enabled: false, sources: [] });
  const [canConnect, setCanConnect] = useState(false);
  const [saved, setSaved] = useState<{ available: boolean; count?: number }>({
    available: false,
  });
  const [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null),
    [review, setReview] = useState<{ sourceId: string; data: Review } | null>(
      null,
    );
  const [initialKey] = useState(() => crypto.randomUUID());
  const key = useRef(initialKey);
  const [now, setNow] = useState(() => Date.now());
  const polls = useRef({ key: '', count: 0 });
  const loadPortfolio = useAppStore((s) => s.loadPortfolio);
  const load = useCallback(async () => {
    const next = await request<typeof state>(root);
    setNow(Date.now());
    setState(next);
    const gate = await request<{ enabled: boolean }>(
      root + '/availability',
      undefined,
      true,
    );
    setCanConnect(gate.enabled);
    if (gate.enabled)
      setSaved(
        await request<typeof saved>(root + '/saved-session', undefined, true),
      );
  }, []);
  useEffect(() => {
    if (webAuthMode() !== 'gateway') return;
    let alive = true;
    void request<typeof state>(root)
      .then(async (next) => {
        if (!alive) return;
        setNow(Date.now());
        setState(next);
        const gate = await request<{ enabled: boolean }>(
          root + '/availability',
          undefined,
          true,
        );
        if (alive) setCanConnect(gate.enabled);
        if (gate.enabled) {
          const existing = await request<typeof saved>(
            root + '/saved-session',
            undefined,
            true,
          );
          if (alive) setSaved(existing);
        }
      })
      .catch(() => {
        /* Older engines do not expose this connector. */
      });
    return () => {
      alive = false;
    };
  }, []);
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
      void load().catch(() => {});
    }, 1500);
    return () => clearTimeout(timer);
  }, [state.sources, load]);
  if (
    (!state.enabled && !state.sources.length) ||
    (!canConnect && !state.sources.length)
  )
    return null;
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
      const value = await request<{ url: string }>(
        root + '/start',
        {
          intentKey: key.current,
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
      key.current = crypto.randomUUID();
      window.location.assign(value.url);
    });
  const action = (source: ParkioSourceView, kind: string) =>
    run(source.id, async () => {
      await request(root + '/' + source.id + '/' + kind, {
        revision: source.revision,
      });
      setReview(null);
      await load();
      await loadPortfolio();
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
  return (
    <section aria-label="Park.io inventory" className="flex flex-col gap-4">
      <div>
        <h3 className="text-lg font-semibold">Park.io</h3>
        <p className="text-sm text-muted-foreground">
          Active domains and expiry dates, updated about once a day. Manage
          domain settings in Park.io.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
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
            disabled={!!busy}
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
                await loadPortfolio();
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
        const pending = source.sync === 'running',
          needsSignIn = source.connection !== 'connected';
        return (
          <Card key={source.id} className="flex flex-col gap-3 p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-medium">
                {source.label}
                {state.sources.length > 1 ? ` · ${source.id.slice(0, 4)}` : ''}
              </h4>
              <span className="text-sm text-muted-foreground">
                {needsSignIn
                  ? source.connection === 'disconnected'
                    ? 'Disconnected'
                    : 'Sign in again'
                  : source.paused
                    ? 'Updates paused'
                    : source.sync === 'review_required'
                      ? 'Review changes'
                      : pending
                        ? 'Checking Park.io…'
                        : source.error
                          ? 'Needs attention'
                          : 'Connected'}
              </span>
            </div>
            <p className="text-sm">
              {source.count.toLocaleString()} saved domain
              {source.count === 1 ? '' : 's'} · Last updated{' '}
              {when(source.lastSuccessfulCheckAt)}
            </p>
            <p className="text-sm text-muted-foreground">
              {state.automaticUpdates === false
                ? 'Automatic sync is off in Settings. Manual updates remain available.'
                : source.nextAttemptAt
                  ? `Next update ${when(source.nextAttemptAt)}`
                  : needsSignIn
                    ? 'Your last saved inventory is kept.'
                    : source.paused
                      ? 'Resume when you want automatic updates.'
                      : source.pending
                        ? 'Review the new export before changing your saved inventory.'
                        : 'No update is scheduled.'}
            </p>
            {source.error && (
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
                  variant="outline"
                  className="min-h-11"
                  disabled={!!busy}
                  onClick={() => void showReview(source.id)}
                >
                  Review domain changes
                </Button>
                <Button
                  variant="outline"
                  className="min-h-11"
                  disabled={!!busy}
                  onClick={() => void action(source, 'reject_review')}
                >
                  Keep the saved inventory
                </Button>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {needsSignIn ? (
                <Button
                  className="min-h-11"
                  disabled={!!busy || !canConnect}
                  onClick={() => void connect(source)}
                >
                  Sign in again
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={
                      !!busy ||
                      pending ||
                      !!source.pending ||
                      (source.lastAttemptAt !== null &&
                        now - source.lastAttemptAt < 3600000)
                    }
                    onClick={() => void action(source, 'refresh')}
                  >
                    Update now
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={!!busy || pending || !!source.pending}
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
              <Button
                variant="ghost"
                className="min-h-11"
                disabled={!!busy}
                onClick={() => void run('status', load)}
              >
                Refresh status
              </Button>
              <a
                href="https://park.io/orders/index/active"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center px-3 text-sm underline"
              >
                Open Park.io ↗
              </a>
            </div>
            {source.lastAttemptAt !== null &&
              now - source.lastAttemptAt < 3600000 && (
                <p className="text-xs text-muted-foreground">
                  Manual updates are available once an hour. Refreshing status
                  does not request another export.
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
      {!saved.available && canConnect && (
        <Button
          variant="outline"
          className="min-h-11 w-full sm:w-auto sm:self-start"
          disabled={!!busy}
          onClick={() => void connect()}
        >
          {state.sources.length
            ? 'Add another Park.io account'
            : 'Connect Park.io →'}
        </Button>
      )}
    </section>
  );
}
