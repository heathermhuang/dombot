import { useCallback, useEffect, useRef, useState } from 'react';
import './sales.css';
import {
  salesRequest,
  useSalesAction,
  downloadSales,
} from '../../lib/sales-client';
import { landerSelectionSchema } from '../../../shared/lander-connection';
import type {
  LanderSelection,
  LanderJobView,
} from '../../../shared/lander-connection';
import {
  domainCount,
  landerItemLabel,
  landerJobLabel,
  landerRoutingChanges,
  savedLanderReview,
  landerReviewPath,
  landerReviewFromLocation,
  landerIssue,
  landerPreviewOnly,
  landerHostStatus,
} from '../../lib/lander-presentation';

export default function UseLander({
  selection,
  matching,
  onChange,
}: {
  selection: LanderSelection | null;
  matching?: LanderSelection;
  onChange?: () => void;
}) {
  const [job, setJob] = useState<LanderJobView | null>(null),
    [open, setOpen] = useState(false),
    [recent, setRecent] = useState<
      { id: string; state: string; total: number; updated_at?: number }[]
    >([]),
    [cursor, setCursor] = useState(-1),
    [resumeError, setResumeError] = useState(''),
    [now, setNow] = useState(() => Date.now());
  const action = useSalesAction();
  const identityLink = useRef<HTMLAnchorElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const viewEpoch = useRef(0);
  const pendingKey = 'domains-lander-pending:' + location.pathname;
  const reviewKey = 'domains-lander-review:' + location.pathname;
  const [pending, setPending] = useState<{
    id: string;
    selection: LanderSelection;
  } | null>(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(pendingKey) ?? 'null');
      return value && typeof value.id === 'string'
        ? {
            id: value.id,
            selection: landerSelectionSchema.parse(value.selection),
          }
        : null;
    } catch {
      return null;
    }
  });
  const [enabled, setEnabled] = useState(false);
  const jobId = job?.id,
    jobState = job?.state,
    expiresAt = job?.expiresAt;
  useEffect(() => {
    if (action.reauth) identityLink.current?.focus();
  }, [action.reauth]);
  useEffect(() => {
    if (open && jobId) reviewHeading.current?.focus();
  }, [open, jobId]);
  const accept = useCallback((value: LanderJobView) => {
    setJob(value);
    setResumeError('');
    setRecent((rows) =>
      rows.some((r) => r.id === value.id)
        ? rows.map((r) =>
            r.id === value.id ? { ...r, state: value.state } : r,
          )
        : [
            { id: value.id, state: value.state, total: value.total },
            ...rows,
          ].slice(0, 20),
    );
  }, []);
  const read = async (id: string, after = -1) => {
    const epoch = ++viewEpoch.current;
    let v: LanderJobView;
    try {
      v = await salesRequest<LanderJobView>(
        `/lander/jobs/${id}?cursor=${after}`,
      );
    } catch (error) {
      if (epoch !== viewEpoch.current) return null;
      throw error;
    }
    if (epoch !== viewEpoch.current) return null;
    viewEpoch.current++;
    accept(v);
    setCursor(after);
    return v;
  };
  useEffect(() => {
    let saved: ReturnType<typeof savedLanderReview> = null;
    try {
      saved =
        landerReviewFromLocation(location) ??
        savedLanderReview(sessionStorage.getItem(reviewKey));
    } catch {
      /* Storage can be unavailable in private browsing. */
    }
    if (!saved) return;
    const epoch = ++viewEpoch.current;
    let stopped = false;
    // Reopen the saved GET view only. Approval and DNS actions are never replayed.
    void salesRequest<LanderJobView>(
      `/lander/jobs/${saved.id}?cursor=${saved.cursor}`,
    )
      .then((value) => {
        if (stopped || epoch !== viewEpoch.current) return;
        accept(value);
        setCursor(saved.cursor);
        setOpen(true);
        setResumeError('');
      })
      .catch(() => {
        if (!stopped && epoch === viewEpoch.current)
          setResumeError(
            'Your saved connection could not be reopened. Use recent connections to try again.',
          );
      });
    return () => {
      stopped = true;
    };
  }, [reviewKey, accept]);
  useEffect(() => {
    if (!open || !jobId) return;
    const view = { id: jobId, cursor };
    try {
      sessionStorage.setItem(reviewKey, JSON.stringify(view));
    } catch {
      /* The read-only return URL remains available. */
    }
    try {
      history.replaceState(history.state, '', landerReviewPath(location, view));
    } catch {
      /* Recent connections remain available. */
    }
  }, [open, jobId, cursor, reviewKey]);
  useEffect(() => {
    if (jobState !== 'awaiting-review' || expiresAt === undefined) return;
    setNow(Date.now());
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, expiresAt - Date.now() + 50),
    );
    return () => clearTimeout(timer);
  }, [jobState, expiresAt]);
  useEffect(() => {
    let stopped = false;
    void salesRequest<{ enabled: boolean }>('/lander/config')
      .then((v) => {
        if (!stopped) setEnabled(v.enabled);
      })
      .catch(() => {});
    void salesRequest<{ items: typeof recent }>('/lander/jobs')
      .then((v) => {
        if (!stopped) setRecent(v.items);
      })
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, []);
  useEffect(() => {
    if (
      !jobId ||
      !open ||
      action.busy ||
      !['preparing', 'running', 'restoring'].includes(jobState ?? '')
    )
      return;
    let stopped = false;
    let reading = false;
    const timer = setInterval(() => {
      if (reading) return;
      reading = true;
      const epoch = viewEpoch.current;
      void salesRequest<LanderJobView>(`/lander/jobs/${jobId}?cursor=${cursor}`)
        .then((v) => {
          if (!stopped && epoch === viewEpoch.current) accept(v);
        })
        .catch(() => {})
        .finally(() => {
          reading = false;
        });
    }, 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [jobId, jobState, open, cursor, accept, action.busy]);
  const clearSavedView = () => {
    viewEpoch.current++;
    try {
      sessionStorage.removeItem(reviewKey);
    } catch {
      /* Storage is optional. */
    }
    try {
      history.replaceState(history.state, '', landerReviewPath(location, null));
    } catch {
      /* The view can still close. */
    }
  };
  const prepare = (value: LanderSelection) =>
    void action.run(async () => {
      clearSavedView();
      setJob(null);
      const request =
        pending && JSON.stringify(pending.selection) === JSON.stringify(value)
          ? pending
          : { id: crypto.randomUUID(), selection: value };
      setPending(request);
      sessionStorage.setItem(pendingKey, JSON.stringify(request));
      const v = await salesRequest<LanderJobView>('/lander/jobs', 'POST', {
        ...request,
      });
      sessionStorage.removeItem(pendingKey);
      setPending(null);
      accept(v);
      setOpen(true);
      setCursor(-1);
    });
  const apply = (kind: 'approve' | 'cancel' | 'restore') =>
    void action.run(async () => {
      if (!job) return;
      viewEpoch.current++;
      const value = await salesRequest<LanderJobView>(
        `/lander/jobs/${job.id}/${kind}`,
        'POST',
        kind === 'approve' ? { digest: job.digest } : {},
      );
      viewEpoch.current++;
      accept(value);
      onChange?.();
    });
  const ready = job?.counts.find((c) => c.state === 'ready')?.count ?? 0;
  const expired =
    jobState === 'awaiting-review' &&
    expiresAt !== undefined &&
    expiresAt <= now;
  const previewOnly = landerPreviewOnly(job, cursor);
  const restored =
    !!job?.total &&
    job.counts.some((c) => c.state === 'restored' && c.count === job.total);
  const needsAttention =
    !!job &&
    ['finished', 'cancelled'].includes(job.state) &&
    job.counts.some((c) => ['held', 'conflict'].includes(c.state));
  if (!enabled && !recent.length && !open && !action.error && !resumeError)
    return null;
  return (
    <div className="sales sales-lander-action">
      {enabled && selection && (
        <button
          className="primary"
          disabled={action.busy}
          onClick={() => prepare(selection)}
        >
          Use our lander
        </button>
      )}
      {enabled && matching && (
        <button disabled={action.busy} onClick={() => prepare(matching)}>
          Use our lander for all matching
        </button>
      )}
      {enabled && pending && !job && (
        <button
          disabled={action.busy}
          onClick={() => prepare(pending.selection)}
        >
          Continue lander review
        </button>
      )}
      {!!recent.length && (
        <details>
          <summary>Recent lander connections</summary>
          <ul className="sales-lander-history">
            {recent.map((j) => (
              <li key={j.id}>
                <button
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      if (await read(j.id)) setOpen(true);
                    })
                  }
                >
                  <span>
                    {domainCount(j.total)} ·{' '}
                    {landerJobLabel({
                      state: j.state,
                      total: j.total,
                      counts: job?.id === j.id ? job.counts : [],
                    })}
                  </span>
                  {typeof j.updated_at === 'number' && j.updated_at > 0 && (
                    <time dateTime={new Date(j.updated_at).toISOString()}>
                      {new Date(j.updated_at).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </time>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {resumeError && <p role="alert">{resumeError}</p>}
      {action.error && !action.reauth && <p role="alert">{action.error}</p>}
      {action.reauth && (
        <div className="sales-lander-auth" role="alert">
          <strong>You’re signed in. Confirm this DNS change.</strong>
          <p>
            Identity confirmation lasts five minutes. Your{' '}
            {job ? 'connection details are' : 'domain selection is'} saved, and
            you’ll return here after confirming.
          </p>
          <a
            ref={identityLink}
            className="sales-button primary"
            href={
              action.reauth +
              '?reason=domain-setup&next=' +
              encodeURIComponent(
                landerReviewPath(location, job ? { id: job.id, cursor } : null),
              )
            }
          >
            Confirm identity
          </a>
        </div>
      )}
      {open && job && (
        <section
          className="sales-section sales-lander-panel"
          aria-label="Lander connection review"
        >
          <div className="sales-heading">
            <h2 ref={reviewHeading} tabIndex={-1}>
              {landerJobLabel(job)}
            </h2>
            <button
              aria-label="Close connection details"
              onClick={() => {
                clearSavedView();
                setOpen(false);
              }}
            >
              Close
            </button>
          </div>
          <p role="status">
            {domainCount(job.total)} ·{' '}
            {job.total === 1
              ? landerItemLabel(
                  job.items[0] ?? { state: job.counts[0]?.state ?? job.state },
                )
              : job.counts
                  .map(
                    (c) =>
                      `${c.count} ${landerItemLabel({ state: c.state }).toLowerCase()}`,
                  )
                  .join(' · ')}
          </p>
          {needsAttention && (
            <div className="sales-lander-auth">
              <p>
                {previewOnly
                  ? 'Remove this unused preview before preparing another connection.'
                  : 'Review the details below. Restore checks the saved DNS and preserves newer edits.'}
              </p>
              <button
                className="primary"
                disabled={action.busy}
                onClick={() => apply('restore')}
              >
                {previewOnly
                  ? 'Remove preview'
                  : `Restore previous DNS for ${domainCount(job.total)}`}
              </button>
            </div>
          )}
          {(['preparing', 'awaiting-review', 'running'].includes(job.state) ||
            landerJobLabel(job) === 'Connected') && (
            <ol className="sales-lander-steps" aria-label="Connection progress">
              {['Prepare', 'Review', 'Connect'].map((label, index) => {
                const stage =
                  job.state === 'preparing'
                    ? 0
                    : job.state === 'awaiting-review'
                      ? 1
                      : 2;
                const complete =
                  index < stage ||
                  (index === 2 &&
                    job.counts.some(
                      (c) => c.state === 'live' && c.count === job.total,
                    ));
                return (
                  <li
                    key={label}
                    data-complete={complete}
                    aria-current={
                      index === stage && !complete ? 'step' : undefined
                    }
                  >
                    <span aria-hidden="true">{complete ? '✓' : index + 1}</span>
                    {label}
                  </li>
                );
              })}
            </ol>
          )}
          {job.state === 'preparing' && (
            <p>
              Checking DNS and preparing root and www hosting. DNS and public
              pages stay unchanged until you confirm.
            </p>
          )}
          {job.state === 'awaiting-review' && !expired && (
            <>
              <p>
                Review the page and DNS changes below, then connect{' '}
                {domainCount(ready)}. Your nameservers stay in place.
              </p>
              <p>
                Existing published terms stay unchanged. Domains needing
                attention are left out.
              </p>
              <button
                className="primary"
                disabled={action.busy || !ready || !job.digest}
                onClick={() => apply('approve')}
              >
                Confirm and connect {domainCount(ready)}
              </button>
            </>
          )}
          {expired && (
            <div className="sales-lander-auth" role="status">
              <strong>This review has expired.</strong>
              <p>
                Remove this setup before preparing a fresh review. Recovery
                checks any DNS changes submitted since this review was opened.
              </p>
              <button disabled={action.busy} onClick={() => apply('restore')}>
                Remove expired preview
              </button>
            </div>
          )}
          {['running', 'restoring'].includes(job.state) && (
            <p>
              Work continues in the background when you close this tab. Each
              domain has its own result.
            </p>
          )}
          {job.items.map((item) => (
            <details
              key={item.ordinal}
              className="sales-section sales-lander-item"
              open={job.total === 1 || undefined}
            >
              <summary>
                <strong>{item.domain}</strong>
                {' · '}
                <span className="sales-lander-state">
                  {landerItemLabel(item)}
                </span>
              </summary>
              {item.reason && (
                <p className="sales-lander-reason">
                  {landerIssue(item.reason)}
                </p>
              )}
              {item.dnsProgress &&
                (() => {
                  const p = item.dnsProgress;
                  const recovery =
                    job.state === 'restoring' || item.state === 'restored';
                  const total = recovery ? p.tracked : p.total;
                  const done = recovery ? p.restored : p.verified;
                  return total > 0 ? (
                    <div className="sales-lander-progress">
                      <label>
                        {done} of {total} DNS changes{' '}
                        {recovery ? 'restored' : 'verified'}
                        <progress
                          max={total}
                          value={done}
                          aria-label={
                            recovery
                              ? 'DNS restoration'
                              : 'Verified DNS changes'
                          }
                        />
                      </label>
                      {!recovery && p.tracked > p.verified && (
                        <p className="small">
                          A DNS change is awaiting provider verification.
                        </p>
                      )}
                    </div>
                  ) : recovery ? (
                    <p>
                      {item.state === 'restored'
                        ? 'Connection removed.'
                        : 'Removing this connection.'}{' '}
                      There are no DNS changes to reverse.
                    </p>
                  ) : null;
                })()}
              <div className="sales-lander-hosts">
                {item.hosts?.map((host) => {
                  const status = landerHostStatus(item.state, host.receipt);
                  return (
                    <div
                      key={host.hostname}
                      className="sales-lander-host"
                      data-verified={status.verified}
                    >
                      <strong>{host.hostname}</strong>
                      <span>{status.label}</span>
                    </div>
                  );
                })}
              </div>
              {item.state === 'live' && (
                <a
                  className="sales-button primary"
                  href={`https://${item.domain}/`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open {item.domain}
                </a>
              )}
              {item.publication && (
                <div>
                  <p>
                    <strong>
                      {item.publishes
                        ? 'Publish this inquiry page'
                        : 'Keep the published page'}
                      : {item.publication.displayName}
                    </strong>
                  </p>
                  <p>{item.publication.description || 'Domain inquiry page'}</p>
                  <p>
                    {item.publication.publicPrice
                      ? `${item.publication.publicPrice.currency} ${item.publication.publicPrice.amount}`
                      : 'No public price'}{' '}
                    ·{' '}
                    {item.publication.mode === 'inquiry'
                      ? 'Open to inquiries'
                      : item.publication.mode}{' '}
                    ·{' '}
                    {item.publication.allowQuestions
                      ? 'Questions accepted'
                      : 'Questions off'}
                  </p>
                  {item.publication.sellerDisplayName && (
                    <p>Contact: {item.publication.sellerDisplayName}</p>
                  )}
                  <details>
                    <summary>Exact public content</summary>
                    <pre
                      style={{
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {JSON.stringify(item.publication, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
              {item.changes && (
                <div className="sales-lander-routing">
                  <h3>Reviewed web routing</h3>
                  {landerRoutingChanges(item.changes).map((row) => (
                    <div key={row.name}>
                      <strong>{row.name}</strong>
                      <span>
                        <code>{row.before ?? 'No web record'}</code>
                        <span aria-hidden="true"> → </span>
                        <span className="sr-only"> changes to </span>
                        <code>{row.after ?? 'No web record'}</code>
                      </span>
                    </div>
                  ))}
                  {!landerRoutingChanges(item.changes).length && (
                    <p>No web routing changes are needed.</p>
                  )}
                </div>
              )}
              {item.changes && (
                <details>
                  <summary>
                    All {item.changes.length} DNS record changes
                  </summary>
                  <pre
                    style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                  >
                    {JSON.stringify(item.changes, null, 2)}
                  </pre>
                  <p>
                    Only these records may change. Snapshots stay encrypted in
                    your portfolio. Provider APIs cannot make external edits
                    globally atomic; a conflict stops further writes.
                  </p>
                </details>
              )}
            </details>
          ))}
          <div className="sales-toolbar">
            {cursor >= 0 && (
              <button
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    await read(job.id);
                  })
                }
              >
                First results
              </button>
            )}
            {job.cursor !== null && (
              <button
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    await read(job.id, job.cursor!);
                  })
                }
              >
                Next results
              </button>
            )}
            {job.state === 'running' && (
              <button disabled={action.busy} onClick={() => apply('cancel')}>
                Stop further changes
              </button>
            )}
            {[
              'running',
              'cancelled',
              'finished',
              'preparing',
              'awaiting-review',
            ].includes(job.state) &&
              !restored &&
              !expired &&
              !needsAttention && (
                <button disabled={action.busy} onClick={() => apply('restore')}>
                  {previewOnly ? 'Remove preview' : 'Restore previous DNS'}
                </button>
              )}
            <button
              onClick={() =>
                downloadSales(`lander-${job.id}-results.json`, job)
              }
            >
              Export these results
            </button>
          </div>
          <p className="small">
            A domain is connected only after root and www pass DNS, certificate
            and public HTTPS checks. Recovery applies to all{' '}
            {domainCount(job.total)} in this connection and preserves newer DNS
            edits.
          </p>
          <details className="sales-lander-technical">
            <summary>Connection details</summary>
            <p className="small">Connection receipt: {job.id}</p>
          </details>
        </section>
      )}
    </div>
  );
}
