import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { SalesThread } from '../../../shared/sales-api';
import {
  salesRequest,
  useSalesData,
  useSalesAction,
  downloadSales,
} from '../../lib/sales-client';
import { SalesFeedback, Field, salePriceLabel } from './shared';

const deliveryLabel: Record<string, string> = {
  queued: 'Saved · queued for email',
  leased: 'Sending',
  accepted: 'Accepted by email service',
  unknown: 'Delivery unknown · review before resending',
  retryable: 'Waiting to retry',
  failed: 'Failed',
  suppressed: 'Sending suppressed',
  delivered: 'Delivered',
  bounced: 'Bounced',
};
export default function Conversation({
  id,
  onChange,
}: {
  id: string;
  onChange: () => void;
}) {
  const remote = useSalesData<SalesThread>(`/inbox/${id}`),
    action = useSalesAction(),
    navigate = useNavigate();
  const [body, setBody] = useState(''),
    [direction, setDirection] = useState('reply'),
    [followup, setFollowup] = useState(''),
    [deleting, setDeleting] = useState(false),
    [outcome, setOutcome] = useState('handed-off'),
    [evidence, setEvidence] = useState(''),
    [outcomeAmount, setOutcomeAmount] = useState(''),
    [outcomeCurrency, setOutcomeCurrency] = useState(''),
    [older, setOlder] = useState<SalesThread['messages']>([]),
    [olderCursor, setOlderCursor] = useState<string | null | undefined>(
      undefined,
    );
  const key = useRef(crypto.randomUUID());
  const thread = remote.data;
  useEffect(() => {
    setOlder([]);
    setOlderCursor(undefined);
  }, [thread?.revision]);
  const messageCursor =
    olderCursor === undefined ? thread?.cursor : olderCursor;
  return (
    <section className="sales-thread">
      <Link className="link" to="/sales/inbox">
        ← Back to inquiries
      </Link>
      <SalesFeedback
        error={remote.error || action.error}
        notice={action.notice}
        loading={action.busy}
        retry={() => void remote.reload()}
      />
      {thread && (
        <>
          <h2>{thread.original.snapshot.domain}</h2>
          <p>
            {thread.original.name} · {thread.email}
          </p>
          <p className="small">
            Original public terms:{' '}
            {salePriceLabel(thread.original.snapshot.publicPrice)} ·{' '}
            {thread.original.snapshot.mode}
            {thread.original.offer &&
              ` · Buyer offer ${salePriceLabel(thread.original.offer)}`}
          </p>
          <div className="sales-toolbar">
            <span className="badge">{thread.verification}</span>
            <select
              aria-label="Conversation status"
              style={{ width: 180 }}
              value={thread.status}
              disabled={action.busy}
              onChange={(e) =>
                void action.run(async () => {
                  await salesRequest(`/inbox/${id}`, 'PATCH', {
                    revision: thread.revision,
                    status: e.target.value,
                    followUpAt: thread.followUpAt,
                  });
                  await remote.reload();
                  onChange();
                })
              }
            >
              {[
                'new',
                'negotiating',
                'awaiting-buyer',
                'agreed',
                'closed',
                'spam',
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <button onClick={() => downloadSales(`inquiry-${id}.json`, thread)}>
              Export loaded thread page
            </button>
          </div>
          <div className="message">
            <p className="small">
              Buyer inquiry · snapshot {thread.original.snapshot.revision}
            </p>
            <p>
              {thread.original.message ||
                'Monetary offer submitted without a message.'}
            </p>
          </div>
          {[...older, ...thread.messages].map((m) => (
            <div
              key={m.id}
              className={`message ${m.direction === 'private-note' ? 'private-note' : ''}`}
            >
              <p className="small">
                {m.direction === 'private-note'
                  ? 'Private note · visible only to you'
                  : m.direction === 'reply'
                    ? 'Seller reply'
                    : 'Buyer message'}{' '}
                · {new Date(m.createdAt).toLocaleString()}
              </p>
              <p>{m.body}</p>
            </div>
          ))}
          {messageCursor && (
            <button
              onClick={() =>
                void action.run(async () => {
                  const next = await salesRequest<SalesThread>(
                    `/inbox/${id}?cursor=${encodeURIComponent(messageCursor!)}`,
                  );
                  setOlder((previous) => [...next.messages, ...previous]);
                  setOlderCursor(next.cursor);
                })
              }
            >
              Load older messages
            </button>
          )}
          {thread.verification === 'expired' && (
            <p className="sales-error">
              This restored conversation needs a fresh buyer email confirmation
              before another reply. Use Email recovery to send a confirmation
              link.
            </p>
          )}
          <h2>Sale observations</h2>
          {thread.outcomes?.map((o) => (
            <p key={o.id} className="small">
              {o.state} · seller-entered · {o.provider} ·{' '}
              {new Date(o.createdAt).toLocaleString()}
              <br />
              {o.evidence}
            </p>
          ))}
          <h2>Delivery records</h2>
          {thread.deliveries.map((r) => (
            <p key={r.id} className="small">
              {r.kind} · {deliveryLabel[r.state] ?? r.state} · {r.attempts}{' '}
              attempts · {new Date(r.updated_at).toLocaleString()}
            </p>
          ))}
          <details>
            <summary>Email recovery</summary>
            <p className="small">
              If delivery is unknown, the previous email may have arrived.
              Sending a fresh link may send a duplicate notification. It revokes
              previous conversation links and retains the delivery history.
            </p>
            <button
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await salesRequest(`/inbox/${id}/fresh-link`, 'POST', {});
                  await remote.reload();
                  action.setNotice(
                    'A fresh inquiry link is queued. Earlier delivery receipts are preserved.',
                  );
                })
              }
            >
              Email a fresh link to this buyer
            </button>
          </details>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void action.run(async () => {
                await salesRequest(`/inbox/${id}/messages`, 'POST', {
                  body,
                  direction,
                  revision: thread.revision,
                  idempotencyKey: key.current,
                });
                setBody('');
                key.current = crypto.randomUUID();
                await remote.reload();
                onChange();
                action.setNotice(
                  direction === 'reply'
                    ? 'Reply saved and queued. See delivery records for email status.'
                    : 'Private note saved.',
                );
              });
            }}
          >
            <Field label="Compose">
              <select
                value={direction}
                onChange={(e) => {
                  setDirection(e.target.value);
                  key.current = crypto.randomUUID();
                }}
              >
                <option value="reply">Reply to buyer</option>
                <option value="private-note">
                  Private note · never sent to the buyer
                </option>
              </select>
            </Field>
            <p className="small">
              {direction === 'reply'
                ? `Recipient: ${thread.email}. Only the verified inquiry address can receive this reply.`
                : 'This note stays private in your inbox.'}
            </p>
            <Field label={direction === 'reply' ? 'Reply' : 'Private note'}>
              <textarea
                required
                value={body}
                maxLength={4000}
                onChange={(e) => {
                  setBody(e.target.value);
                  key.current = crypto.randomUUID();
                }}
              />
            </Field>
            <button
              className="primary"
              disabled={
                action.busy ||
                !body.trim() ||
                (direction === 'reply' && thread.verification !== 'verified')
              }
            >
              {direction === 'reply'
                ? 'Queue email reply'
                : 'Save private note'}
            </button>
          </form>
          <section className="sales-section">
            <h2>Follow up</h2>
            <Field label="Follow-up date">
              <input
                type="datetime-local"
                value={followup}
                onChange={(e) => setFollowup(e.target.value)}
              />
            </Field>
            {thread.followUpAt && (
              <p className="small">
                Current reminder: {new Date(thread.followUpAt).toLocaleString()}
              </p>
            )}
            <button
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await salesRequest(`/inbox/${id}`, 'PATCH', {
                    revision: thread.revision,
                    status: thread.status,
                    followUpAt: followup ? new Date(followup).getTime() : null,
                  });
                  await remote.reload();
                  action.setNotice('Follow-up date saved.');
                })
              }
            >
              Save follow-up
            </button>
          </section>
          <details className="sales-section">
            <summary>
              Record a provider handoff or seller-entered outcome
            </summary>
            <p className="small">
              Price agreed does not mean paid. A checkout click never marks a
              sale paid automatically.
            </p>
            <Field label="Observed outcome">
              <select
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
              >
                {[
                  'handed-off',
                  'payment-reported',
                  'transfer-reported',
                  'completed',
                  'canceled',
                  'unknown',
                ].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <div className="grid-two">
              <Field label="Reported price (optional)">
                <input
                  inputMode="numeric"
                  value={outcomeAmount}
                  onChange={(e) => setOutcomeAmount(e.target.value)}
                />
              </Field>
              <Field label="Currency">
                <input
                  maxLength={3}
                  value={outcomeCurrency}
                  placeholder={
                    thread.original.snapshot.publicPrice?.currency ?? 'USD'
                  }
                  onChange={(e) =>
                    setOutcomeCurrency(e.target.value.toUpperCase())
                  }
                />
              </Field>
            </div>
            <Field label="Evidence / provider reference (private)">
              <textarea
                value={evidence}
                maxLength={1000}
                onChange={(e) => setEvidence(e.target.value)}
              />
            </Field>
            <p className="small">
              Reporting payment or transfer pauses all public sales controls for
              this domain.
            </p>
            <button
              disabled={!evidence.trim() || action.busy}
              onClick={() =>
                void action.run(async () => {
                  await salesRequest(`/inbox/${id}`, 'PATCH', {
                    revision: thread.revision,
                    status: thread.status,
                    followUpAt: thread.followUpAt,
                    outcome: {
                      state: outcome,
                      source: 'seller-entered',
                      evidence,
                      price: outcomeAmount
                        ? { amount: outcomeAmount, currency: outcomeCurrency }
                        : null,
                      provider:
                        thread.original.snapshot.destination?.provider ??
                        'Manual handoff',
                    },
                  });
                  await remote.reload();
                  action.setNotice('Seller-entered outcome recorded.');
                })
              }
            >
              Record outcome
            </button>
          </details>
          <section className="sales-section">
            <button onClick={() => setDeleting(!deleting)}>
              Delete inquiry…
            </button>
            {deleting && (
              <div>
                <p>
                  This removes the buyer record, messages, links and pending
                  email work.
                </p>
                <button
                  disabled={action.busy}
                  onClick={() =>
                    void action.run(async () => {
                      await salesRequest(`/inbox/${id}`, 'DELETE', {
                        revision: thread.revision,
                      });
                      onChange();
                      navigate('/sales/inbox');
                    })
                  }
                >
                  Delete this inquiry and its messages
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
