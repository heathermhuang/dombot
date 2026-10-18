import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { SalesInboxItem, SalesPage } from '../../../shared/sales-api';
import { useSalesData } from '../../lib/sales-client';
import Conversation from './Conversation';
import { SalesShell, SalesFeedback, salePriceLabel } from './shared';

export default function Inbox() {
  const { id } = useParams(),
    [status, setStatus] = useState(''),
    [cursor, setCursor] = useState('');
  const data = useSalesData<SalesPage<SalesInboxItem>>(
    `/inbox?cursor=${cursor}&${status === 'pending' ? 'verification=pending' : `status=${status}`}`,
  );
  return (
    <SalesShell>
      <div className="sales-heading">
        <div>
          <p className="sales-kicker">SALES / INBOX</p>
          <h1>Inquiry inbox</h1>
          <p className="small">
            Email verification establishes access to the conversation, without
            verifying identity or funds.
          </p>
        </div>
      </div>
      <div className="sales-toolbar">
        <select
          aria-label="Filter inquiries"
          style={{ width: 240 }}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setCursor('');
          }}
        >
          {[
            ['', 'All inquiries'],
            ['new', 'New'],
            ['negotiating', 'Following up'],
            ['awaiting-buyer', 'Awaiting buyer'],
            ['closed', 'Closed'],
            ['pending', 'Pending verification'],
            ['reconfirm', 'Needs reconfirmation'],
            ['spam', 'Spam'],
          ].map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <SalesFeedback
        error={data.error}
        loading={data.loading}
        retry={() => void data.reload()}
      />
      <div className={`sales-inbox ${id ? 'has-thread' : ''}`}>
        <aside className="sales-inbox-list" aria-label="Inquiry list">
          {data.data?.items.map((r) => (
            <Link
              key={r.id}
              to={`/sales/inbox/${r.id}`}
              className={id === r.id ? 'active' : ''}
            >
              <strong>{r.domain}</strong>
              <p>{r.name}</p>
              <p className="small">
                {r.offer ? salePriceLabel(r.offer) : 'Question'} ·{' '}
                {r.verification === 'verified'
                  ? 'Email confirmed'
                  : 'Pending verification'}
              </p>
              <p className="small">
                {r.status} · {new Date(r.updatedAt).toLocaleString()}
              </p>
            </Link>
          ))}
          {!data.data?.items.length && !data.loading && (
            <p className="sales-empty">
              No inquiries in this view. A published lander gives buyers a
              direct way to contact you.
            </p>
          )}
          <div className="sales-toolbar">
            <button disabled={!cursor} onClick={() => setCursor('')}>
              First
            </button>
            <button
              disabled={!data.data?.cursor}
              onClick={() => setCursor(data.data!.cursor!)}
            >
              Next
            </button>
          </div>
        </aside>
        {id ? (
          <Conversation key={id} id={id} onChange={() => void data.reload()} />
        ) : (
          <section>
            <h2>Select an inquiry</h2>
            <p>
              Replies, delivery records, and private notes stay together here.
            </p>
          </section>
        )}
      </div>
    </SalesShell>
  );
}
