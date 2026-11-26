import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { SalesInboxItem, SalesPage } from '../../../shared/sales-api';
import { useSalesData } from '../../lib/sales-client';
import { navigateInboxPage } from '../../lib/inbox-pagination';
import Conversation from './Conversation';
import {
  SalesShell,
  SalesFeedback,
  salePriceLabel,
  conversationStatusLabel,
} from './shared';

export default function Inbox() {
  const { id } = useParams(),
    [status, setStatus] = useState(''),
    [cursors, setCursors] = useState<string[]>(['']);
  const cursor = cursors.at(-1) ?? '';
  const data = useSalesData<SalesPage<SalesInboxItem>>(
    `/inbox?cursor=${cursor}&${status === 'pending' ? 'verification=pending' : `status=${status}`}`,
  );
  const navigatePage = (direction: 'first' | 'previous' | 'next') => {
    if (data.loading) return;
    setCursors((history) =>
      navigateInboxPage(
        history,
        cursor,
        direction,
        data.data?.cursor,
        data.loading,
      ),
    );
  };
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
            setCursors(['']);
          }}
        >
          {[
            ['', 'All inquiries'],
            ['new', 'New'],
            ['negotiating', 'Negotiating'],
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
                {r.kind === 'unlisted-domain'
                  ? 'Unlisted-domain inquiry'
                  : r.offer
                    ? salePriceLabel(r.offer)
                    : 'Question'}{' '}
                ·{' '}
                {r.verification === 'verified'
                  ? 'Email confirmed'
                  : 'Pending verification'}
              </p>
              <p className="small">
                {conversationStatusLabel(r.status)} ·{' '}
                {new Date(r.updatedAt).toLocaleString()}
              </p>
            </Link>
          ))}
          {!data.data?.items.length && !data.loading && !data.error && (
            <p className="sales-empty">
              No inquiries in this view. A published lander gives buyers a
              direct way to contact you.
            </p>
          )}
          <div className="sales-toolbar">
            <button
              disabled={data.loading || !cursor}
              onClick={() => navigatePage('first')}
            >
              First
            </button>
            <button
              disabled={data.loading || cursors.length === 1}
              onClick={() => navigatePage('previous')}
            >
              Previous
            </button>
            <span>Page {cursors.length}</span>
            <button
              disabled={data.loading || !data.data?.cursor}
              onClick={() => navigatePage('next')}
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
