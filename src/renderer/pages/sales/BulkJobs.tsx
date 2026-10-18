import { Link } from 'react-router-dom';
import {
  salesRequest,
  useSalesData,
  useSalesAction,
  downloadSales,
} from '../../lib/sales-client';
import { SalesFeedback } from './shared';
interface Job {
  id: string;
  status: string;
  counts: { state: string; count: number }[];
  items: unknown[];
  cursor: number | null;
}
export default function BulkJobs({ onChange }: { onChange: () => void }) {
  const remote = useSalesData<{
      items: { id: string; status: string; updated_at: number }[];
    }>('/jobs'),
    action = useSalesAction();
  if (!remote.data?.items.length) return null;
  return (
    <details className="sales-section">
      <summary>Recent bulk jobs · recovery and receipts</summary>
      <SalesFeedback
        error={action.error || remote.error}
        loading={action.busy}
        notice={action.notice}
      />
      {remote.data.items.map((job) => (
        <div key={job.id} className="sales-toolbar">
          <span className="small">
            {job.id} · {job.status} ·{' '}
            {new Date(job.updated_at).toLocaleString()}
          </span>
          {job.status === 'awaiting-review' && (
            <Link className="sales-button" to={`/sales/bulk-review/${job.id}`}>
              Review publication
            </Link>
          )}
          {job.status !== 'finished' && job.status !== 'awaiting-review' && (
            <button
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  let result: Job | null = null;
                  for (let n = 0; n < 5; n++) {
                    result = await salesRequest<Job>(
                      `/jobs/${job.id}/step`,
                      'POST',
                      {},
                    );
                    if (result.status === 'finished') break;
                  }
                  await remote.reload();
                  onChange();
                  action.setNotice(
                    result?.counts
                      .map((c) => `${c.count} ${c.state}`)
                      .join(' · ') ?? 'No changes.',
                  );
                })
              }
            >
              Resume up to 100 pending items
            </button>
          )}
          <button
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                const pages = [];
                let cursor: number | null = -1;
                for (let n = 0; n < 5 && cursor !== null; n++) {
                  const result: Job = await salesRequest(
                    `/jobs/${job.id}?cursor=${cursor}`,
                  );
                  pages.push(result);
                  cursor = result.cursor;
                }
                downloadSales(`sales-job-${job.id}.json`, pages);
              })
            }
          >
            Export exact receipts
          </button>
        </div>
      ))}
    </details>
  );
}
