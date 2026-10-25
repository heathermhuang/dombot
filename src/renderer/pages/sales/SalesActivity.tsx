import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSalesData } from '../../lib/sales-client';
import { SalesFeedback } from './shared';
export default function SalesActivity() {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="sales sales-section"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Sales publications and delivery records</summary>
      {open && <SalesRecords />}
    </details>
  );
}

function SalesRecords() {
  const data = useSalesData<{
    items: {
      id: string;
      listingId: string | null;
      leadId: string | null;
      createdAt: number;
      summary: string;
    }[];
  }>('/activity');
  return (
    <div className="sales-records">
      <SalesFeedback
        error={data.error}
        loading={data.loading}
        retry={() => void data.reload()}
      />
      {data.data?.items.map((item) => (
        <p key={item.id} className="small">
          <time>{new Date(item.createdAt).toLocaleString()}</time> ·{' '}
          {item.summary} ·{' '}
          <Link
            className="link"
            to={
              item.leadId
                ? `/sales/inbox/${item.leadId}`
                : `/sales/listings/${item.listingId}`
            }
          >
            View record
          </Link>
        </p>
      ))}
      {data.data?.items.length === 0 && !data.loading && !data.error && (
        <p className="small">No sales activity yet.</p>
      )}
    </div>
  );
}
