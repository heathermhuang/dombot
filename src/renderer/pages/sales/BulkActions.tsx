import { useState, useRef } from 'react';
import type { SalesListing } from '../../../shared/sales-api';
import type { SaleDestination } from '../../../shared/sales';
import {
  salesRequest,
  useSalesAction,
  useSalesData,
  downloadSales,
} from '../../lib/sales-client';
import { SalesFeedback } from './shared';

interface Job {
  id: string;
  status: string;
  counts: { state: string; count: number }[];
  items: { listing_id: string; state: string; result: unknown }[];
  cursor: number | null;
}
export default function BulkActions({
  items,
  onChange,
}: {
  items: SalesListing[];
  onChange: () => void;
}) {
  const [kind, setKind] = useState('portfolio-price'),
    [mode, setMode] = useState('inquiry'),
    [destinationId, setDestinationId] = useState(''),
    [job, setJob] = useState<Job | null>(null),
    [jobId, setJobId] = useState('');
  const requestKey = useRef(crypto.randomUUID());
  const destinations = useSalesData<{ items: SaleDestination[] }>(
      '/destinations',
    ),
    action = useSalesAction();
  const advance = async (id: string) => {
    let result: Job | null = null;
    for (let n = 0; n < 5; n++) {
      result = await salesRequest<Job>(`/jobs/${id}/step`, 'POST', {});
      setJob(result);
      if (result.status === 'finished') break;
    }
    onChange();
  };
  return (
    <details className="sales-section">
      <summary>
        Bulk draft changes · {items.length} exact selected names
      </summary>
      <p className="small">{items.map((r) => r.draft.domain).join(', ')}</p>
      <p className="small">
        These actions save private drafts. Review and publish the resulting
        terms separately. Completed items are not replayed on resume.
      </p>
      <div className="sales-toolbar">
        <select
          aria-label="Bulk draft action"
          style={{ width: 230 }}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="portfolio-price">Copy portfolio price defaults</option>
          <option value="mode">Set sale mode</option>
          <option value="destination">Set provider destination</option>
          <option value="shop-include">Stage shop inclusion</option>
          <option value="shop-exclude">Stage shop exclusion</option>
        </select>
        {kind === 'mode' && (
          <select
            aria-label="Bulk sale mode"
            style={{ width: 160 }}
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            {['inquiry', 'offer', 'buy-now', 'external'].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        )}
        {kind === 'destination' && (
          <select
            aria-label="Bulk destination"
            style={{ width: 250 }}
            value={destinationId}
            onChange={(e) => setDestinationId(e.target.value)}
          >
            <option value="">Direct inquiry</option>
            {destinations.data?.items.map((v) => (
              <option key={v.id} value={v.id}>
                {v.provider} · {v.url}
              </option>
            ))}
          </select>
        )}
        <button
          disabled={!items.length || action.busy}
          onClick={() =>
            void action.run(async () => {
              const actionValue =
                kind === 'mode'
                  ? { kind, mode }
                  : kind === 'destination'
                    ? { kind, destinationId: destinationId || null }
                    : kind.startsWith('shop-')
                      ? { kind: 'shop', include: kind === 'shop-include' }
                      : { kind: 'portfolio-price' };
              setJobId(requestKey.current);
              const r = await salesRequest<{ id: string }>('/jobs', 'POST', {
                items: items.map((v) => ({
                  id: v.draft.id,
                  revision: v.revision,
                })),
                action: actionValue,
                requestKey: requestKey.current,
              });
              setJobId(r.id);
              await advance(r.id);
            })
          }
        >
          Save these {items.length} private draft changes
        </button>
      </div>
      <SalesFeedback
        error={action.error || destinations.error}
        loading={action.busy}
      />
      {jobId && <p className="small">Job receipt: {jobId}</p>}
      {job && (
        <>
          <p role="status">
            {job.counts.map((c) => `${c.count} ${c.state}`).join(' · ')}
          </p>
          <button
            disabled={action.busy || job.status === 'finished'}
            onClick={() => void action.run(() => advance(jobId))}
          >
            Resume pending items
          </button>{' '}
          <button onClick={() => downloadSales(`sales-job-${jobId}.json`, job)}>
            Export this receipt page
          </button>
        </>
      )}
      {jobId && !job && (
        <button
          disabled={action.busy}
          onClick={() => void action.run(() => advance(jobId))}
        >
          Recover job result
        </button>
      )}
    </details>
  );
}
