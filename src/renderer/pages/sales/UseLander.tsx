import { useEffect, useState } from 'react';
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
      { id: string; state: string; total: number }[]
    >([]),
    [cursor, setCursor] = useState(-1);
  const action = useSalesAction();
  const pendingKey = 'domains-lander-pending:' + location.pathname;
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
    jobState = job?.state;
  const read = async (id: string, after = -1) => {
    const v = await salesRequest<LanderJobView>(
      `/lander/jobs/${id}?cursor=${after}`,
    );
    setJob(v);
    setCursor(after);
    return v;
  };
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
      !['preparing', 'running', 'restoring'].includes(jobState ?? '')
    )
      return;
    let stopped = false;
    const timer = setInterval(() => {
      void salesRequest<LanderJobView>(`/lander/jobs/${jobId}?cursor=${cursor}`)
        .then((v) => {
          if (!stopped) setJob(v);
        })
        .catch(() => {});
    }, 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [jobId, jobState, open, cursor]);
  const prepare = (value: LanderSelection) =>
    void action.run(async () => {
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
      setJob(v);
      setRecent((rows) =>
        [
          { id: v.id, state: v.state, total: v.total },
          ...rows.filter((r) => r.id !== v.id),
        ].slice(0, 20),
      );
      setOpen(true);
      setCursor(-1);
    });
  const apply = (kind: 'approve' | 'cancel' | 'restore') =>
    void action.run(async () => {
      if (!job) return;
      setJob(
        await salesRequest<LanderJobView>(
          `/lander/jobs/${job.id}/${kind}`,
          'POST',
          kind === 'approve' ? { digest: job.digest } : {},
        ),
      );
      onChange?.();
    });
  const ready = job?.counts.find((c) => c.state === 'ready')?.count ?? 0;
  if (!enabled && !recent.length && !open && !action.error) return null;
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
          {recent.map((j) => (
            <p key={j.id}>
              <button
                onClick={() =>
                  void action.run(async () => {
                    await read(j.id);
                    setOpen(true);
                  })
                }
              >
                {j.total} domains · {j.state}
              </button>
            </p>
          ))}
        </details>
      )}
      {action.error && <p role="alert">{action.error}</p>}
      {action.reauth && (
        <p>
          <a
            href={
              action.reauth +
              '?next=' +
              encodeURIComponent(
                location.pathname + location.search + location.hash,
              )
            }
          >
            Confirm your identity, then return to this selection
          </a>
        </p>
      )}
      {open && job && (
        <section
          className="sales-section"
          aria-label="Lander connection review"
        >
          <div className="sales-heading">
            <h2>
              {job.state === 'awaiting-review'
                ? 'Connect your domains'
                : job.state === 'preparing'
                  ? 'Preparing your review'
                  : 'Lander connections'}
            </h2>
            <button
              aria-label="Close connection details"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
          <p role="status">
            {job.total} exact selected domains ·{' '}
            {job.counts.map((c) => `${c.count} ${c.state}`).join(' · ')}
          </p>
          {job.state === 'preparing' && (
            <p>
              Checking DNS and preparing root and www hosting. DNS and public
              pages stay unchanged until you confirm.
            </p>
          )}
          {job.state === 'awaiting-review' && (
            <>
              <p>
                Confirm once to connect the {ready} eligible domains at their
                current DNS provider. Existing nameservers stay in place. New
                pages publish the exact content shown below; existing public
                terms stay unchanged.
              </p>
              <p>
                Standard pages show the domain and a neutral inquiry action,
                with no inferred price. Held domains remain unchanged.
              </p>
            </>
          )}
          {['running', 'restoring'].includes(job.state) && (
            <p>
              Work continues in the background when you close this tab. Each
              domain has its own result.
            </p>
          )}
          {job.items.map((item) => (
            <details key={item.ordinal} className="sales-section">
              <summary>
                {item.domain} · {item.state}
              </summary>
              {item.reason && <p>{item.reason}</p>}
              {item.hosts?.map((host) => (
                <p key={host.hostname}>
                  {host.hostname} ·{' '}
                  {host.receipt?.ordinaryHttpsAt
                    ? 'Public HTTPS verified'
                    : host.receipt?.sslStatus === 'active'
                      ? 'HTTPS ready; checking public page'
                      : 'Preparing DNS and HTTPS'}
                </p>
              ))}
              {item.publication && (
                <div>
                  <p>
                    <strong>
                      {item.publishes
                        ? 'Approve publication'
                        : 'Keep existing publication'}
                      : {item.publication.displayName}
                    </strong>
                  </p>
                  <p>{item.publication.description || 'Domain inquiry page'}</p>
                  <p>
                    {item.publication.publicPrice
                      ? `${item.publication.publicPrice.currency} ${item.publication.publicPrice.amount}`
                      : 'No public price'}{' '}
                    · {item.publication.mode} · questions{' '}
                    {item.publication.allowQuestions ? 'enabled' : 'disabled'}
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
                <details>
                  <summary>Exact DNS changes · {item.changes.length}</summary>
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
            {job.state === 'awaiting-review' && (
              <button
                className="primary"
                disabled={action.busy || !ready}
                onClick={() => apply('approve')}
              >
                Confirm publication and DNS for {ready} domains
              </button>
            )}
            {['preparing', 'awaiting-review', 'running'].includes(
              job.state,
            ) && (
              <button disabled={action.busy} onClick={() => apply('cancel')}>
                Cancel future work
              </button>
            )}
            {['running', 'cancelled', 'finished'].includes(job.state) && (
              <button disabled={action.busy} onClick={() => apply('restore')}>
                Restore previous web routing
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
            Connection receipt: {job.id}. Root and www must each pass public
            DNS, certificate and ordinary HTTPS checks before a domain is live.
            Restore preserves later DNS edits and reports conflicts.
          </p>
        </section>
      )}
    </div>
  );
}
